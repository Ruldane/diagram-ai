"use client";

import { FileText, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextInput } from "@/components/ui/fields";
import { cn } from "@/lib/cn";

import { diagramHref, errorMessage, importDiagram, type ImportResponse } from "./api";
import { baseName, detectFormat, FORMAT_LABEL, IMPORT_ACCEPT, IMPORT_MAX_CHARS, unwrapMermaid } from "./import-format";

interface PickedFile {
  name: string;
  size: number;
  content: string;
}

const LABEL = "text-[11px] font-medium text-ink-3";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Creates a diagram from a file or pasted text. Mount it to open it: all draft
 * state lives here, so closing (unmounting) starts the next import clean.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const formId = useId();
  const pasteId = useId();
  const nameId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  /** Token of the latest file read, so a slow earlier read cannot overwrite it. */
  const reading = useRef(0);

  const [file, setFile] = useState<PickedFile | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [, startNavigation] = useTransition();

  const content = file ? file.content : text;
  const format = content.trim() ? detectFormat(content, file?.name) : null;
  const tooLong = content.length > IMPORT_MAX_CHARS;
  // What the diagram is called when the field is left empty.
  const namePlaceholder = format === "json" ? "Keeps the name saved in the file" : file ? baseName(file.name) : "Imported diagram";

  async function pick(picked: File | undefined) {
    if (!picked || submitting) return;
    if (picked.size > IMPORT_MAX_CHARS) {
      toast.error(`“${picked.name}” is too large to import (the limit is 20 MB).`);
      return;
    }
    const token = ++reading.current;
    try {
      const read = await picked.text();
      if (token !== reading.current) return;
      if (!read.trim()) toast.error(`“${picked.name}” is empty.`);
      else setFile({ name: picked.name, size: picked.size, content: read });
    } catch {
      if (token === reading.current) toast.error(`Could not read “${picked.name}”.`);
    }
  }

  function open(id: string) {
    // Closing inside the transition keeps the dialog up until the editor is on screen.
    startNavigation(() => {
      router.push(diagramHref(id));
      onClose();
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!format || tooLong || submitting) return;
    setSubmitting(true);
    try {
      const response = await importDiagram({
        format,
        content: format === "mermaid" ? unwrapMermaid(content) : content,
        // A JSON export carries its own name; other files are named after the file.
        name: name.trim() || (file && format !== "json" ? baseName(file.name) : "") || undefined,
      });
      if (response.warnings.length > 0) {
        setResult(response);
        setSubmitting(false);
      } else {
        open(response.diagram.id);
      }
    } catch (error) {
      toast.error(errorMessage(error));
      setSubmitting(false);
    }
  }

  const drag = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void pick(event.dataTransfer.files[0]);
    },
  };

  if (result) {
    const count = result.warnings.length;
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && onClose()}
        title="Imported, with notes"
        description={`“${result.diagram.name}” was created. ${count === 1 ? "One thing" : `${count} things`} did not carry over exactly.`}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Stay here
            </Button>
            <Button variant="primary" autoFocus onClick={() => open(result.diagram.id)}>
              Open diagram
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-2">
          {result.warnings.map((warning, index) => (
            <li key={index} className="flex gap-2.5">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-warn" />
              <span className="min-w-0 break-words">{warning}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !submitting && onClose()}
      title="Import a diagram"
      description="Bring in a draw.io file, Mermaid text or a Diagram AI export. It opens as a new diagram."
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!format || tooLong || submitting} aria-busy={submitting}>
            {submitting ? "Importing…" : "Import"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4" {...drag}>
        <input
          ref={fileInput}
          type="file"
          accept={IMPORT_ACCEPT}
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = "";
          }}
        />

        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-line-strong bg-raised px-3 py-2.5">
            <FileText aria-hidden className="size-5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{file.name}</p>
              <p className="font-mono text-[11px] text-ink-3">
                {formatSize(file.size)}
                {format ? ` · ${FORMAT_LABEL[format]}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" disabled={submitting} onClick={() => setFile(null)}>
              <X aria-hidden className="size-3.5" />
              Remove
            </Button>
          </div>
        ) : (
          <>
            <div
              className={cn(
                "flex flex-col items-center gap-2.5 rounded-xl border border-dashed px-4 py-5 text-center transition-colors",
                dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-raised",
              )}
            >
              <p className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 text-[13px] text-ink-2">
                <Upload aria-hidden className="size-4 text-ink-3" />
                Drop a file here, or
                <Button size="sm" onClick={() => fileInput.current?.click()}>
                  Choose a file
                </Button>
              </p>
              <p className="font-mono text-[11px] text-ink-3">.drawio .xml .mmd .mermaid .md .txt .json</p>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={pasteId} className={LABEL}>
                  Or paste Mermaid text
                </label>
                {format ? <span className="font-mono text-[11px] text-ink-3">reads as {FORMAT_LABEL[format]}</span> : null}
              </div>
              <textarea
                id={pasteId}
                value={text}
                onChange={(event) => setText(event.target.value)}
                disabled={submitting}
                rows={4}
                spellCheck={false}
                placeholder={"flowchart LR\n  A[Request] --> B{Valid?}\n  B -- Yes --> C[Process]\n  B -- No --> D[Reject]"}
                className="w-full resize-y rounded-lg border border-line-strong bg-raised px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={nameId} className={LABEL}>
            Name <span className="font-normal text-ink-4">(optional)</span>
          </label>
          <TextInput
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={submitting}
            maxLength={200}
            autoComplete="off"
            placeholder={namePlaceholder}
          />
        </div>

        {tooLong ? <p className="text-[12px] text-danger">This is too large to import (the limit is 20 MB).</p> : null}

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-3 text-[12px] leading-relaxed text-ink-3">
          <dt className="font-mono text-[11px] text-ink-2">Mermaid</dt>
          <dd>Flowcharts and sequence diagrams are supported. Other Mermaid diagram types are not.</dd>
          <dt className="font-mono text-[11px] text-ink-2">draw.io</dt>
          <dd>Shapes, labels, positions and connectors are kept. Shapes without an equivalent become rectangles, and only the first page is read.</dd>
          <dt className="font-mono text-[11px] text-ink-2">JSON</dt>
          <dd>Restores a diagram exported from Diagram AI.</dd>
        </dl>
      </form>
    </Dialog>
  );
}
