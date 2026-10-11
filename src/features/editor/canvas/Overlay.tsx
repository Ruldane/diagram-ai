"use client";

import { nodeBox } from "@/core/edges/geometry";
import { center, nodeMatrix } from "@/core/geometry/basics";
import { pathToSvg } from "@/core/geometry/path";
import type { DNode, Id } from "@/core/model/types";
import { getShape } from "@/core/shapes/registry";

import { useEditor } from "../store/context";
import type { useDisplay } from "./World";

const HANDLES = [
  ["nw", 0, 0, "nwse-resize"],
  ["n", 0.5, 0, "ns-resize"],
  ["ne", 1, 0, "nesw-resize"],
  ["e", 1, 0.5, "ew-resize"],
  ["se", 1, 1, "nwse-resize"],
  ["s", 0.5, 1, "ns-resize"],
  ["sw", 0, 1, "nesw-resize"],
  ["w", 0, 0.5, "ew-resize"],
] as const;

const PORTS = [
  ["top", 0.5, 0, 0, -1],
  ["right", 1, 0.5, 1, 0],
  ["bottom", 0.5, 1, 0, 1],
  ["left", 0, 0.5, -1, 0],
] as const;

const ACCENT = "var(--accent)";

/** Outline, resize handles and rotate handle of the single selected node. */
function NodeHandles({ node, zoom }: { node: DNode; zoom: number }) {
  const s = 8 / zoom;
  const def = getShape(node.shape);
  const corners = def.keepAspect ? HANDLES.filter(([name]) => name.length === 2) : HANDLES;
  const small = node.w * zoom < 36 || node.h * zoom < 36;
  const visible = small ? corners.filter(([name]) => name === "se") : corners;
  const rotateOffset = 24 / zoom;
  return (
    <g transform={`matrix(${nodeMatrix(node).join(" ")})`}>
      <rect width={node.w} height={node.h} fill="none" stroke={ACCENT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      {node.locked ? null : (
        <>
          <line x1={node.w / 2} y1={0} x2={node.w / 2} y2={-rotateOffset} stroke={ACCENT} strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          <circle
            data-handle="rotate"
            data-for={node.id}
            cx={node.w / 2}
            cy={-rotateOffset}
            r={s * 0.6}
            fill="var(--raised)"
            stroke={ACCENT}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: "grab" }}
          />
          {visible.map(([name, fx, fy, cursor]) => (
            <rect
              key={name}
              data-handle={name}
              data-for={node.id}
              x={node.w * fx - s / 2}
              y={node.h * fy - s / 2}
              width={s}
              height={s}
              rx={s * 0.22}
              fill="var(--raised)"
              stroke={ACCENT}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ cursor }}
            />
          ))}
        </>
      )}
    </g>
  );
}

/**
 * Connection ports around a node. Drag one to draw a connector; click it to
 * add a connected node in that direction.
 */
function Ports({ node, zoom }: { node: DNode; zoom: number }) {
  if (node.locked || node.rotation) return null;
  const box = nodeBox(node);
  const offset = 16 / zoom;
  const r = 6.5 / zoom;
  return (
    <g>
      {PORTS.map(([side, fx, fy, nx, ny]) => {
        const cx = box.x + box.w * fx + nx * offset;
        const cy = box.y + box.h * fy + ny * offset;
        return (
          <g key={side} data-port={side} data-for={node.id} style={{ cursor: "crosshair" }}>
            {/* Larger invisible target so the small dot is easy to hit. */}
            <circle cx={cx} cy={cy} r={r * 1.9} fill="transparent" />
            <circle cx={cx} cy={cy} r={r} fill="var(--raised)" stroke={ACCENT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <path
              d={`M${cx - r * 0.45} ${cy}H${cx + r * 0.45}M${cx} ${cy - r * 0.45}V${cy + r * 0.45}`}
              stroke={ACCENT}
              strokeWidth={1.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        );
      })}
    </g>
  );
}

/** Screen-space decorations drawn above the diagram, in world coordinates. */
export function Overlay({ display }: { display: ReturnType<typeof useDisplay> }) {
  const zoom = useEditor((state) => state.viewport.zoom);
  const selection = useEditor((state) => state.selection);
  const hovered = useEditor((state) => state.hovered);
  const overlay = useEditor((state) => state.overlay);
  const highlight = useEditor((state) => state.highlight);
  const editing = useEditor((state) => state.editing);
  const tool = useEditor((state) => state.tool);
  const dragging = useEditor((state) => state.gestureBase !== null);

  const nodes = selection.map((id) => display.nodes[id]).filter(Boolean);
  const edges = selection.map((id) => ({ id, edge: display.edges[id], geometry: display.routes.get(id) })).filter((e) => e.edge && e.geometry);
  const single = nodes.length === 1 && edges.length === 0 ? nodes[0] : null;
  const interactive = (tool === "select" || tool === "connect") && !dragging && !editing;

  // Ports show on the hovered node, or on the single selected one.
  const portNode = interactive && !overlay.connect ? (hovered && display.nodes[hovered] ? display.nodes[hovered] : single) : null;
  const connectFrom = overlay.connect ? display.nodes[overlay.connect.from] : null;
  const connectTarget = overlay.connect?.target ? display.nodes[overlay.connect.target] : null;
  const handleRadius = 5.5 / zoom;

  return (
    <g>
      {/* Selected connectors */}
      {edges.map(({ id, geometry }) => (
        <g key={id}>
          <path d={pathToSvg(geometry!.path)} fill="none" stroke={ACCENT} strokeWidth={3} strokeOpacity={0.35} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          {edges.length === 1 && nodes.length === 0 && !editing
            ? (["from", "to"] as const).map((end) => {
                const p = end === "from" ? geometry!.start : geometry!.end;
                return (
                  <circle
                    key={end}
                    data-handle={`edge-${end}`}
                    data-for={id}
                    cx={p.x}
                    cy={p.y}
                    r={handleRadius}
                    fill="var(--raised)"
                    stroke={ACCENT}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                    style={{ cursor: "move" }}
                  />
                );
              })
            : null}
        </g>
      ))}

      {/* Selected nodes */}
      {single && !editing ? (
        <NodeHandles node={single} zoom={zoom} />
      ) : (
        nodes.map((node) => (
          <rect
            key={node.id}
            transform={`matrix(${nodeMatrix(node).join(" ")})`}
            width={node.w}
            height={node.h}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))
      )}

      {portNode && !getShape(portNode.shape).container ? <Ports node={portNode} zoom={zoom} /> : null}

      {/* Rubber-band connector */}
      {connectFrom && overlay.connect ? (
        <g pointerEvents="none">
          {connectTarget ? (
            <rect
              transform={`matrix(${nodeMatrix(connectTarget).join(" ")})`}
              x={-4 / zoom}
              y={-4 / zoom}
              width={connectTarget.w + 8 / zoom}
              height={connectTarget.h + 8 / zoom}
              rx={6 / zoom}
              fill={ACCENT}
              fillOpacity={0.08}
              stroke={ACCENT}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <line
            x1={center(nodeBox(connectFrom)).x}
            y1={center(nodeBox(connectFrom)).y}
            x2={connectTarget ? center(nodeBox(connectTarget)).x : overlay.connect.to.x}
            y2={connectTarget ? center(nodeBox(connectTarget)).y : overlay.connect.to.y}
            stroke={ACCENT}
            strokeWidth={1.75}
            strokeDasharray={`${5 / zoom} ${4 / zoom}`}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {overlay.guides?.map((guide, index) => (
        <line key={index} {...guide} stroke="#ff3d81" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      ))}

      {overlay.marquee ? (
        <rect
          x={overlay.marquee.x}
          y={overlay.marquee.y}
          width={overlay.marquee.w}
          height={overlay.marquee.h}
          fill={ACCENT}
          fillOpacity={0.08}
          stroke={ACCENT}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {overlay.draft ? (
        <rect
          x={overlay.draft.x}
          y={overlay.draft.y}
          width={overlay.draft.w}
          height={overlay.draft.h}
          fill={ACCENT}
          fillOpacity={0.06}
          stroke={ACCENT}
          strokeWidth={1.5}
          strokeDasharray={`${4 / zoom} ${3 / zoom}`}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}

      {/* Elements an agent is pointing at */}
      {highlight ? (
        <g key={highlight.key} pointerEvents="none">
          {highlight.ids.map((id: Id) => {
            const node = display.nodes[id];
            const geometry = display.routes.get(id);
            if (node) {
              const pad = 6 / zoom;
              return (
                <rect
                  key={id}
                  className="pulse-ring"
                  transform={`matrix(${nodeMatrix(node).join(" ")})`}
                  x={-pad}
                  y={-pad}
                  width={node.w + pad * 2}
                  height={node.h + pad * 2}
                  rx={8 / zoom}
                  fill="none"
                  stroke="var(--agent-claude)"
                  vectorEffect="non-scaling-stroke"
                />
              );
            }
            return geometry ? (
              <path key={id} className="pulse-ring" d={pathToSvg(geometry.path)} fill="none" stroke="var(--agent-claude)" vectorEffect="non-scaling-stroke" />
            ) : null;
          })}
        </g>
      ) : null}
    </g>
  );
}
