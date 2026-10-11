"use client";

import { useMemo } from "react";

import { nodeBox, routeEdges } from "@/core/edges/geometry";
import type { EdgeGeometry } from "@/core/edges/geometry";
import { center, dist, nodeMatrix } from "@/core/geometry/basics";
import { pathToSvg } from "@/core/geometry/path";
import { nodeLabel } from "@/core/model/queries";
import type { DNode, Id } from "@/core/model/types";

import type { useDisplay } from "../canvas/World";
import { useEditor } from "../store/context";
import { useReviewDiff, useReviewSync } from "./use-review";

type Display = ReturnType<typeof useDisplay>;

const ADDED = "var(--success)";
const MODIFIED = "var(--warn)";
const REMOVED = "var(--danger)";
const MOVED = "var(--ink-3)";

/** Ghosts of moved shapes are limited so a big re-layout stays readable. */
const MAX_MOVED_GHOSTS = 30;
const LABEL_CHARS = 28;

const matrix = (node: DNode): string => `matrix(${nodeMatrix(node).join(" ")})`;

function Outline({ node, zoom, color, dashed = false, pad = 3, tint = 0 }: { node: DNode; zoom: number; color: string; dashed?: boolean; pad?: number; tint?: number }) {
  const p = pad / zoom;
  return (
    <rect
      transform={matrix(node)}
      x={-p}
      y={-p}
      width={node.w + p * 2}
      height={node.h + p * 2}
      rx={4 / zoom}
      fill={tint ? color : "none"}
      fillOpacity={tint || undefined}
      stroke={color}
      strokeWidth={2 / zoom}
      strokeDasharray={dashed ? `${6 / zoom} ${4 / zoom}` : undefined}
      pointerEvents="none"
    />
  );
}

/** Small round "+" on the corner of something an agent added. */
function PlusBadge({ node, zoom }: { node: DNode; zoom: number }) {
  const r = 7 / zoom;
  const arm = 3.5 / zoom;
  return (
    <g transform={`${matrix(node)} translate(${node.w + 3 / zoom} ${-3 / zoom})`} pointerEvents="none">
      <circle r={r} fill={ADDED} />
      <path d={`M${-arm} 0H${arm}M0 ${-arm}V${arm}`} stroke="#fff" strokeWidth={1.8 / zoom} strokeLinecap="round" />
    </g>
  );
}

function EdgeTrace({ geometry, zoom, color, dashed = false }: { geometry: EdgeGeometry; zoom: number; color: string; dashed?: boolean }) {
  return (
    <path
      d={pathToSvg(geometry.path)}
      fill="none"
      stroke={color}
      strokeWidth={(dashed ? 2 : 5) / zoom}
      strokeOpacity={dashed ? 0.9 : 0.45}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dashed ? `${6 / zoom} ${4 / zoom}` : undefined}
      pointerEvents="none"
    />
  );
}

interface Moved {
  id: Id;
  from: DNode;
  to: DNode;
}

/**
 * What changed, drawn on the canvas: added things in green with a "+", changed
 * ones in amber, removed ones as dashed red ghosts where they used to be, and
 * a faint ghost with a thin connector for the shapes that moved furthest.
 * Visible while the Review tab is open or a checkpoint is being compared.
 * It also owns keeping `compare` in sync with the server (see `useReviewSync`).
 */
export function DiffOverlay({ display }: { display: Display }) {
  useReviewSync();
  const visible = useEditor((state) => state.panel === "review" || state.compare?.source === "checkpoint");
  const zoom = useEditor((state) => state.viewport.zoom);
  const paper = useEditor((state) => state.doc?.settings.background ?? "#ffffff");
  const view = useReviewDiff();

  const base = view?.compare.base;
  const changes = view?.diff.changes;
  const needsBaseRoutes = Boolean(visible && changes?.some((change) => change.kind === "removed" && change.element === "edge"));
  const baseRoutes = useMemo(() => (needsBaseRoutes && base ? routeEdges(base) : null), [needsBaseRoutes, base]);

  const moved = useMemo<Moved[]>(() => {
    if (!visible || !base || !changes) return [];
    const list: (Moved & { score: number })[] = [];
    for (const change of changes) {
      if (change.kind !== "layout" || change.element !== "node") continue;
      const from = base.nodes[change.id];
      const to = display.nodes[change.id];
      if (!from || !to) continue;
      const travelled = dist(center(nodeBox(from)), center(nodeBox(to)));
      const resized = Math.abs(from.w - to.w) + Math.abs(from.h - to.h);
      if (travelled < 2 && resized < 2) continue;
      list.push({ id: change.id, from, to, score: travelled + resized * 0.25 });
    }
    return list.sort((a, b) => b.score - a.score).slice(0, MAX_MOVED_GHOSTS);
  }, [visible, base, changes, display.nodes]);

  if (!visible || !view || !base || !changes) return null;

  const ghostLabel = (node: DNode) => {
    const text = nodeLabel(node);
    return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;
  };

  return (
    <g data-review-overlay>
      {/* Moved shapes: where they were, and a thin line to where they are now. */}
      {moved.map(({ id, from, to }) => {
        const a = center(nodeBox(from));
        const b = center(nodeBox(to));
        return (
          <g key={`moved-${id}`} opacity={0.65} pointerEvents="none">
            <rect
              transform={matrix(from)}
              width={from.w}
              height={from.h}
              rx={3 / zoom}
              fill="none"
              stroke={MOVED}
              strokeWidth={1.25 / zoom}
              strokeDasharray={`${3 / zoom} ${3 / zoom}`}
            />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={MOVED} strokeWidth={1 / zoom} />
            <circle cx={b.x} cy={b.y} r={2.5 / zoom} fill={MOVED} />
          </g>
        );
      })}

      {/* Removed: dashed ghosts at the old position. */}
      {changes.map((change) => {
        if (change.kind !== "removed") return null;
        if (change.element === "node") {
          const node = base.nodes[change.id];
          if (!node) return null;
          return (
            <g key={`removed-${change.id}`} pointerEvents="none">
              <Outline node={node} zoom={zoom} color={REMOVED} dashed pad={0} tint={0.06} />
              <g transform={matrix(node)}>
                <text
                  x={node.w / 2}
                  y={node.h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12 / zoom}
                  fontWeight={600}
                  fill={REMOVED}
                  stroke={paper}
                  strokeWidth={3 / zoom}
                  paintOrder="stroke"
                  style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
                >
                  {ghostLabel(node)}
                </text>
              </g>
            </g>
          );
        }
        if (change.element === "edge") {
          const geometry = baseRoutes?.get(change.id);
          return geometry ? <EdgeTrace key={`removed-${change.id}`} geometry={geometry} zoom={zoom} color={REMOVED} dashed /> : null;
        }
        return null;
      })}

      {/* Added and changed elements, outlined where they are now. */}
      {changes.map((change) => {
        if (change.kind !== "added" && change.kind !== "modified") return null;
        const color = change.kind === "added" ? ADDED : MODIFIED;
        if (change.element === "node") {
          const node = display.nodes[change.id];
          if (!node) return null;
          return (
            <g key={`${change.kind}-${change.id}`}>
              <Outline node={node} zoom={zoom} color={color} tint={change.kind === "added" ? 0.07 : 0.05} />
              {change.kind === "added" ? <PlusBadge node={node} zoom={zoom} /> : null}
            </g>
          );
        }
        if (change.element === "edge") {
          const geometry = display.routes.get(change.id);
          return geometry ? <EdgeTrace key={`${change.kind}-${change.id}`} geometry={geometry} zoom={zoom} color={color} /> : null;
        }
        return null;
      })}
    </g>
  );
}
