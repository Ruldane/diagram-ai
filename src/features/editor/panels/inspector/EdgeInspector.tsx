"use client";

import { ArrowLeftRight } from "lucide-react";

import { EDGE_KINDS, EDGE_KIND_NAMES, matchEdgeKind, type EdgeKind } from "@/core/edges/kinds";
import { MARKER_KINDS, MARKER_LABELS } from "@/core/edges/markers";
import { resolveEdgeStyle } from "@/core/model/defaults";
import type { DEdge, EdgeRouting, EdgeStyle, MarkerKind } from "@/core/model/types";
import { IconButton } from "@/components/ui/button";
import { NumberField, Segmented, Select, TextInput, Toggle } from "@/components/ui/fields";

import { setEdgeKind, styleEdges, updateEdges } from "../../actions/elements";
import { useEditorStore } from "../../store/context";
import { ColorField, common, Row, Section } from "./controls";
import { TextControls } from "./NodeInspector";

const ROUTING: { value: EdgeRouting; label: string }[] = [
  { value: "orthogonal", label: "Elbow" },
  { value: "curved", label: "Curved" },
  { value: "straight", label: "Straight" },
];
const DASHES = [
  { value: "solid" as const, label: "Solid" },
  { value: "dashed" as const, label: "Dashed" },
  { value: "dotted" as const, label: "Dotted" },
];

function MarkerSelect({ label, value, onChange }: { label: string; value: MarkerKind | undefined; onChange: (marker: MarkerKind) => void }) {
  return (
    <Select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value as MarkerKind)}>
      {value === undefined ? <option value="">Mixed</option> : null}
      {MARKER_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {MARKER_LABELS[kind]}
        </option>
      ))}
    </Select>
  );
}

export function EdgeInspector({ edges }: { edges: DEdge[] }) {
  const store = useEditorStore();
  const ids = edges.map((e) => e.id);
  const resolved = edges.map((e) => resolveEdgeStyle(e.style));
  const first = resolved[0];
  const single = edges.length === 1 ? edges[0] : null;
  const apply = (style: EdgeStyle) => styleEdges(store, ids, style);
  const kind = common(resolved, (s) => matchEdgeKind(s));

  /** Changing the route discards bend points computed for the previous one. */
  const setRouting = (routing: EdgeRouting) =>
    updateEdges(store, ids, (edge) => {
      const next: DEdge = { ...edge, routing, from: { node: edge.from.node, point: edge.from.point }, to: { node: edge.to.node, point: edge.to.point } };
      delete next.waypoints;
      delete next.autoRoute;
      return next;
    });
  const reverse = () =>
    updateEdges(store, ids, (edge) => {
      const next: DEdge = { ...edge, from: edge.to, to: edge.from, startText: edge.endText, endText: edge.startText };
      if (edge.waypoints) next.waypoints = [...edge.waypoints].reverse();
      return next;
    });
  const setText = (field: "text" | "startText" | "endText", value: string) => {
    if (single && (single[field] ?? "") !== value) updateEdges(store, ids, (edge) => ({ ...edge, [field]: value || undefined }));
  };

  return (
    <>
      <Section
        title={edges.length > 1 ? `${edges.length} connectors` : "Connector"}
        action={
          <IconButton size="sm" label="Reverse direction" onClick={reverse}>
            <ArrowLeftRight className="size-3.5" />
          </IconButton>
        }
      >
        <Select aria-label="Relationship" value={kind ?? ""} onChange={(event) => setEdgeKind(store, ids, event.target.value as EdgeKind)}>
          {kind === undefined ? <option value="">Custom</option> : null}
          {EDGE_KIND_NAMES.map((name) => (
            <option key={name} value={name}>
              {EDGE_KINDS[name].label}
            </option>
          ))}
        </Select>
        <Segmented label="Routing" value={common(edges, (e) => e.routing)} options={ROUTING} onChange={setRouting} />
        <Row label="Start">
          <MarkerSelect label="Start marker" value={common(resolved, (s) => s.startMarker)} onChange={(startMarker) => apply({ startMarker })} />
        </Row>
        <Row label="End">
          <MarkerSelect label="End marker" value={common(resolved, (s) => s.endMarker)} onChange={(endMarker) => apply({ endMarker })} />
        </Row>
      </Section>

      <Section title="Line">
        <Row label="Colour">
          <ColorField label="Line colour" value={common(resolved, (s) => s.stroke)} mixed={common(resolved, (s) => s.stroke) === undefined} onChange={(stroke) => apply({ stroke })} />
          <div className="w-[72px] shrink-0">
            <NumberField label="W" value={common(resolved, (s) => s.strokeWidth)} mixed={common(resolved, (s) => s.strokeWidth) === undefined} min={0.5} max={12} step={0.5} onCommit={(strokeWidth) => apply({ strokeWidth })} />
          </div>
        </Row>
        <Segmented label="Line style" value={common(resolved, (s) => s.dash)} options={DASHES} onChange={(dash) => apply({ dash })} />
        <Toggle label="Animated flow" checked={resolved.every((s) => s.animated)} onChange={(animated) => apply({ animated })} />
      </Section>

      {single ? (
        <Section title="Labels">
          <TextInput key={`t:${single.id}`} defaultValue={single.text ?? ""} placeholder="Label" aria-label="Label" onBlur={(event) => setText("text", event.target.value.trim())} />
          <div className="grid grid-cols-2 gap-1.5">
            <TextInput key={`s:${single.id}`} defaultValue={single.startText ?? ""} placeholder="At start (1, 0..*)" aria-label="Start label" onBlur={(event) => setText("startText", event.target.value.trim())} />
            <TextInput key={`e:${single.id}`} defaultValue={single.endText ?? ""} placeholder="At end" aria-label="End label" onBlur={(event) => setText("endText", event.target.value.trim())} />
          </div>
        </Section>
      ) : null}

      <Section title="Text">
        <TextControls<EdgeStyle>
          style={{ fontFamily: first.fontFamily, fontSize: first.fontSize, bold: first.bold, italic: first.italic, underline: first.underline, textColor: first.textColor }}
          mixedSize={common(resolved, (s) => s.fontSize) === undefined}
          apply={apply}
        />
      </Section>
    </>
  );
}
