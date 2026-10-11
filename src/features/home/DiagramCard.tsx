"use client";

import { ArrowUpRight, Copy, MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { getDiagramType, hasDiagramType } from "@/core/catalog";
import type { DiagramSummary } from "@/core/model/types";
import { timeAgo } from "@/lib/agents";
import { cn } from "@/lib/cn";

import { diagramHref, duplicateDiagram, errorMessage, thumbnailUrl } from "./api";

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Preview on a "paper" tile. Thumbnails are drawn for a light background, so
 * the tile and everything on it use fixed light colours in both themes.
 */
function Thumbnail({ diagram }: { diagram: DiagramSummary }) {
  const src = thumbnailUrl(diagram);
  /** Last revision that finished loading; it stays up while a newer one is fetched. */
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const empty = diagram.nodeCount === 0;

  return (
    <div
      className="relative aspect-[16/10] overflow-hidden rounded-lg border border-black/10 bg-[#fbf9f3] dark:bg-[#e6e2d6]"
      style={{ backgroundImage: "radial-gradient(rgb(23 21 15 / 0.13) 1px, transparent 1px)", backgroundSize: "14px 14px" }}
    >
      {empty || (!shown && failed === src) ? (
        <p className="absolute inset-0 flex items-center justify-center font-mono text-[11px] text-[#8a8576]">{empty ? "Empty canvas" : "No preview"}</p>
      ) : null}
      {!empty && shown ? (
        // eslint-disable-next-line @next/next/no-img-element -- server-rendered PNG, already sized and cached per version
        <img src={shown} alt={`Preview of ${diagram.name || "the diagram"}`} decoding="async" className="absolute inset-0 size-full object-contain p-3" />
      ) : null}
      {!empty && src !== shown && src !== failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- off-screen preload of the next revision
        <img src={src} alt="" aria-hidden className="hidden" onLoad={() => setShown(src)} onError={() => setFailed(src)} />
      ) : null}
    </div>
  );
}

export interface DiagramCardProps {
  diagram: DiagramSummary;
  /** Current time, for the relative "updated" label. */
  now: number;
  onDelete: () => void;
}

/** A saved diagram. The whole card opens it; the "⋯" menu sits above the link. */
export function DiagramCard({ diagram, now, onDelete }: DiagramCardProps) {
  const router = useRouter();
  const [duplicating, setDuplicating] = useState(false);
  const href = diagramHref(diagram.id);
  const name = diagram.name || "Untitled";
  // `getDiagramType` falls back to the default type: never label an unknown type with its name.
  const typeName = hasDiagramType(diagram.type) ? getDiagramType(diagram.type).name : "Diagram";

  async function duplicate() {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const copy = await duplicateDiagram(diagram.id);
      toast.success(`Duplicated as “${copy.name}”.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDuplicating(false);
    }
  }

  return (
    <article
      aria-busy={duplicating}
      className={cn(
        "relative flex h-full flex-col rounded-xl border border-line bg-surface p-2 transition-[border-color,box-shadow,translate,opacity] duration-200",
        "hover:border-line-strong hover:shadow-[var(--shadow-md)] motion-safe:hover:-translate-y-0.5",
        duplicating && "opacity-60",
      )}
    >
      <Thumbnail diagram={diagram} />
      <div className="px-1.5 pt-2.5 pb-1">
        <div className="flex items-start gap-1">
          <h3 className="min-w-0 flex-1 truncate text-[14px] leading-6 font-semibold text-ink">
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-solid focus-visible:after:outline-accent"
            >
              {name}
            </Link>
          </h3>
          <div className="relative z-10 -my-0.5 -mr-1 shrink-0">
            <Menu
              align="end"
              trigger={
                <IconButton size="sm" label={`Actions for ${name}`} data-diagram-menu={diagram.id}>
                  <MoreHorizontal className="size-4" />
                </IconButton>
              }
            >
              <MenuItem icon={<ArrowUpRight />} onSelect={() => router.push(href)}>
                Open
              </MenuItem>
              <MenuItem icon={<Copy />} disabled={duplicating} onSelect={() => void duplicate()}>
                Duplicate
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>
                Delete…
              </MenuItem>
            </Menu>
          </div>
        </div>
        <p className="flex items-baseline justify-between gap-3 text-[12px] text-ink-3">
          <span className="truncate text-ink-2">{typeName}</span>
          <time dateTime={diagram.updatedAt} title={new Date(diagram.updatedAt).toLocaleString()} className="shrink-0">
            updated {timeAgo(diagram.updatedAt, now)}
          </time>
        </p>
        <p className="mt-1.5 flex min-h-5 items-center justify-between gap-3 font-mono text-[11px] text-ink-3">
          <span className="truncate">
            {plural(diagram.nodeCount, "node")} · {plural(diagram.edgeCount, "edge")}
          </span>
          {diagram.openComments > 0 ? (
            <span className="flex h-5 shrink-0 items-center gap-1 rounded-md bg-accent-soft px-1.5 text-accent">
              <MessageSquare aria-hidden className="size-3" />
              {diagram.openComments}
              <span className="sr-only">{diagram.openComments === 1 ? "open comment" : "open comments"}</span>
            </span>
          ) : null}
        </p>
      </div>
    </article>
  );
}
