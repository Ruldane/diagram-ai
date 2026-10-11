"use client";

import { FolderOpen, LoaderCircle, Package, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/fields";
import { importIconFilesAsync, type ImportReport } from "@/core/shapes/pack-import";
import { iconMarkup, packIdFromName, PACK_LIMITS, type PackIcon } from "@/core/shapes/packs";
import { getLibrary, isRuntimeLibrary } from "@/core/shapes/registry";
import { cn } from "@/lib/cn";

import { fromDataTransfer, fromFileList, readPicked, type PickedFile } from "./read-files";
import { installPack, packPreview, removePack, usePacks, useRegistryVersion } from "./use-packs";

/** Icons drawn in the preview grid; the pack always gets all of them. */
const PREVIEW_LIMIT = 240;

type Stage =
  | { kind: "idle" }
  | { kind: "working"; label: string; done: number; total: number }
  | { kind: "ready"; report: ImportReport; problems: string[] }
  | { kind: "failed"; message: string };

const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/* ---------------------------------------------------------------- installed */

function InstalledPack({ id, name, iconCount, categories }: { id: string; name: string; iconCount: number; categories: string[] }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const icons = packPreview(id);

  const remove = async () => {
    setBusy(true);
    try {
      await removePack(id);
      toast.success(`Removed “${name}”`);
    } catch (error) {
      toast.error(errorMessage(error, "The pack could not be removed."));
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2.5">
      <div aria-hidden className="flex h-9 shrink-0 items-center gap-1">
        {icons.length ? (
          icons.map((icon) => (
            <svg
              key={icon.id}
              viewBox={`0 0 ${icon.viewBox.w} ${icon.viewBox.h}`}
              width={30}
              height={30}
              className="rounded bg-white p-0.5 ring-1 ring-line"
              dangerouslySetInnerHTML={{ __html: iconMarkup(icon) }}
            />
          ))
        ) : (
          <Package className="size-6 text-ink-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink">{name}</p>
        <p className="truncate text-[11.5px] text-ink-3">
          {plural(iconCount, "icon")}
          {categories.length > 1 ? ` · ${categories.length} categories` : ""} ·{" "}
          <span className="font-mono">{id}</span>
        </p>
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[12px] text-ink-3">Diagrams keep their layout; the icons become boxes.</span>
          <Button variant="danger" size="sm" disabled={busy} onClick={remove}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            Remove
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <IconButton label={`Remove ${name}`} size="sm" onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ preview */

function groupByCategory(icons: PackIcon[]): [string, PackIcon[]][] {
  const groups = new Map<string, PackIcon[]>();
  for (const icon of icons) {
    const key = icon.category ?? "";
    const list = groups.get(key);
    if (list) list.push(icon);
    else groups.set(key, [icon]);
  }
  return [...groups.entries()];
}

function IconPreview({ icons }: { icons: PackIcon[] }) {
  const groups = useMemo(() => groupByCategory(icons.slice(0, PREVIEW_LIMIT)), [icons]);
  return (
    <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-sunken p-3">
      {groups.map(([category, list]) => (
        <section key={category || "_"} className="mb-3 last:mb-0">
          {category ? <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{category}</h4> : null}
          <ul className="flex flex-wrap gap-x-2 gap-y-2.5">
            {list.map((icon) => (
              <li key={icon.id} title={icon.name} className="flex w-[76px] flex-col items-center gap-1">
                <svg
                  aria-hidden
                  viewBox={`0 0 ${icon.viewBox.w} ${icon.viewBox.h}`}
                  width={40}
                  height={40}
                  className="rounded-md bg-white p-1 ring-1 ring-line"
                  dangerouslySetInnerHTML={{ __html: iconMarkup(icon) }}
                />
                <span className="line-clamp-2 text-center text-[10.5px] leading-tight text-ink-2">{icon.name}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {icons.length > PREVIEW_LIMIT ? <p className="mt-2 text-[11.5px] text-ink-3">…and {icons.length - PREVIEW_LIMIT} more.</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- dialog */

/**
 * Icon packs: what is installed, and an importer for official icon sets or
 * your own SVGs (zip, folder or loose files). Files are converted in the
 * browser, previewed, and only then uploaded as one ready pack.
 */
export function PacksDialog({ onClose }: { onClose: () => void }) {
  const { packs, ready, error } = usePacks();
  useRegistryVersion();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [installing, setInstalling] = useState(false);
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const ingest = async (picked: PickedFile[]) => {
    if (!picked.length) return;
    const mine = ++generation.current;
    const current = () => generation.current === mine;
    setStage({ kind: "working", label: "Reading files", done: 0, total: picked.length });
    try {
      const read = await readPicked(picked, (done, total) => current() && setStage({ kind: "working", label: "Reading files", done, total }));
      if (!current()) return;
      const report = await importIconFilesAsync(read.files, { name: read.suggestedName }, (done, total) => {
        if (current()) setStage({ kind: "working", label: "Converting icons", done, total });
      });
      if (!current()) return;
      setName(read.suggestedName);
      setStage(report.pack ? { kind: "ready", report, problems: read.problems } : { kind: "failed", message: [...read.problems, ...report.warnings].join(" ") });
    } catch (cause) {
      if (current()) setStage({ kind: "failed", message: errorMessage(cause, "The files could not be read.") });
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void fromDataTransfer(event.dataTransfer).then(ingest);
  };

  const packId = useMemo(() => packIdFromName(name), [name]);
  const reserved = getLibrary(packId) !== undefined && !isRuntimeLibrary(packId);
  const replaces = packs.some((pack) => pack.id === packId);
  const pack = stage.kind === "ready" ? stage.report.pack : null;

  const install = async () => {
    if (!pack || reserved || !name.trim()) return;
    setInstalling(true);
    try {
      const result = await installPack({ ...pack, id: packId, name: name.trim() });
      toast.success(`${result.replaced ? "Updated" : "Added"} “${result.pack.name}” with ${plural(result.pack.iconCount, "icon")}`);
      setStage({ kind: "idle" });
      setName("");
    } catch (cause) {
      toast.error(errorMessage(cause, "The pack could not be installed."));
    } finally {
      setInstalling(false);
    }
  };

  const folderAttributes = { webkitdirectory: "", directory: "" } as Record<string, string>;
  const working = stage.kind === "working";

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Icon packs"
      description="Icon sets such as the official AWS, Azure and Google Cloud architecture icons, or your own SVGs. Installed packs are shared by everyone on this server."
      width="max-w-3xl"
      footer={
        pack ? (
          <>
            <Button variant="ghost" disabled={installing} onClick={() => setStage({ kind: "idle" })}>
              Cancel
            </Button>
            <Button variant="primary" disabled={installing || reserved || !name.trim()} onClick={install}>
              {installing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {replaces ? "Replace pack" : `Add ${plural(pack.icons.length, "icon")}`}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <section aria-label="Installed packs">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Installed</h3>
          {packs.length ? (
            <ul className="flex flex-col gap-2">
              {packs.map((installed) => (
                <InstalledPack key={installed.id} id={installed.id} name={installed.name} iconCount={installed.iconCount} categories={installed.categories} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-ink-3">
              {!ready ? "Loading…" : error ? `Could not load the installed packs: ${error}` : "No icon packs installed yet. Import one below and it shows up in the shape library."}
            </p>
          )}
        </section>

        <section aria-label="Import a pack">
          <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Import</h3>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
              dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-raised",
            )}
          >
            <Upload aria-hidden className="size-6 text-ink-3" />
            <p className="text-[13px] text-ink-2">
              Drop a <strong className="font-semibold">.zip</strong>, a folder of <strong className="font-semibold">.svg</strong> files, or several SVGs here.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button disabled={working || installing} onClick={() => fileInput.current?.click()}>
                <Upload className="size-4" /> Choose .zip or .svg files…
              </Button>
              <Button disabled={working || installing} onClick={() => folderInput.current?.click()}>
                <FolderOpen className="size-4" /> Choose a folder…
              </Button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,.svg,image/svg+xml,application/zip"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) void ingest(fromFileList(event.target.files));
                event.target.value = "";
              }}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              {...folderAttributes}
              onChange={(event) => {
                if (event.target.files) void ingest(fromFileList(event.target.files));
                event.target.value = "";
              }}
            />
          </div>

          {stage.kind === "working" ? (
            <div role="status" className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
              <LoaderCircle className="size-4 animate-spin" />
              {stage.label}… {stage.done} of {stage.total}
            </div>
          ) : null}

          {stage.kind === "failed" ? (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {stage.message || "No icons could be read from these files."}
            </p>
          ) : null}

          {pack && stage.kind === "ready" ? (
            <div className="mt-4 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="Pack name">
                  <TextInput value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
                </Field>
                <p className="text-[12px] text-ink-3 sm:pb-2">
                  {plural(pack.icons.length, "icon")} · id <span className="font-mono">{packId}</span>
                </p>
              </div>
              {reserved ? (
                <p role="alert" className="text-[12.5px] text-danger">
                  “{packId}” is the id of a built-in library. Pick another name.
                </p>
              ) : replaces ? (
                <p className="text-[12.5px] text-warn">A pack with this id is installed already; importing replaces it.</p>
              ) : null}

              <IconPreview icons={pack.icons} />

              {stage.report.warnings.length || stage.problems.length || stage.report.skipped.length ? (
                <details className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-ink-2">
                  <summary className="cursor-pointer font-medium">
                    {stage.report.warnings.length + stage.problems.length} note{stage.report.warnings.length + stage.problems.length === 1 ? "" : "s"}
                    {stage.report.skipped.length ? `, ${plural(stage.report.skipped.length, "file")} skipped` : ""}
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {[...stage.problems, ...stage.report.warnings].map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                    {stage.report.skipped.slice(0, 12).map((file) => (
                      <li key={file.path} className="text-ink-3">
                        <span className="font-mono">{file.path}</span>: {file.reason}
                      </li>
                    ))}
                    {stage.report.skipped.length > 12 ? <li className="text-ink-3">…and {stage.report.skipped.length - 12} more skipped files.</li> : null}
                  </ul>
                </details>
              ) : null}

            </div>
          ) : null}
        </section>

        <section aria-label="Where to get icon sets" className="rounded-xl bg-sunken px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">Where to get the official sets</h3>
          <p>
            The cloud vendors publish their architecture icons as free downloads, but their terms do not allow bundling them inside another product, so Diagram
            AI does not ship them. Download a set once, import it here, and everyone on this server can use it:{" "}
            <a className="underline" href="https://aws.amazon.com/architecture/icons/" target="_blank" rel="noopener noreferrer">
              AWS Architecture Icons
            </a>
            ,{" "}
            <a className="underline" href="https://cloud.google.com/icons" target="_blank" rel="noopener noreferrer">
              Google Cloud icons
            </a>
            ,{" "}
            <a className="underline" href="https://learn.microsoft.com/azure/architecture/icons/" target="_blank" rel="noopener noreferrer">
              Azure Architecture Icons
            </a>
            .
          </p>
          <p className="mt-1.5 text-ink-3">
            Folders become categories, sizes of the same icon are merged, and up to {PACK_LIMITS.icons} icons fit in a pack. Gradients are flattened to one
            colour; text, images and filters are left out.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
