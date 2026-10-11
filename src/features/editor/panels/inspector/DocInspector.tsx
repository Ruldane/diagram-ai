"use client";

import { getDiagramType } from "@/core/catalog";
import type { DocSettings, EdgeRouting } from "@/core/model/types";
import { Button } from "@/components/ui/button";
import { NumberField, Segmented, Toggle } from "@/components/ui/fields";

import { useDoc, useEditorStore } from "../../store/context";
import { ColorField, Row, Section } from "./controls";

const GRIDS: { value: DocSettings["grid"]; label: string }[] = [
  { value: "dots", label: "Dots" },
  { value: "lines", label: "Lines" },
  { value: "none", label: "None" },
];
const ROUTING: { value: EdgeRouting; label: string }[] = [
  { value: "orthogonal", label: "Elbow" },
  { value: "curved", label: "Curved" },
  { value: "straight", label: "Straight" },
];

/** Shown when nothing is selected: what this diagram is and how its canvas behaves. */
export function DocInspector() {
  const store = useEditorStore();
  const doc = useDoc();
  const type = getDiagramType(doc.type);
  const setSettings = (settings: Partial<DocSettings>) => store.getState().apply({ doc: { settings } });
  const counts = `${Object.keys(doc.nodes).length} shapes · ${Object.keys(doc.edges).length} connectors`;

  return (
    <>
      <Section title="Diagram">
        <div>
          <p className="font-display text-[19px] leading-tight text-ink">{type.name}</p>
          <p className="mt-1 text-[12px] leading-snug text-ink-3">{type.description}</p>
        </div>
        <textarea
          key={doc.id}
          defaultValue={doc.description ?? ""}
          rows={3}
          placeholder="Describe what this diagram shows. Agents read this for context."
          aria-label="Description"
          onBlur={(event) => {
            const description = event.target.value.trim();
            if (description !== (doc.description ?? "")) store.getState().apply({ doc: { description } });
          }}
          className="w-full resize-none rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-4 focus:border-accent"
        />
        <p className="font-mono text-[10.5px] text-ink-4 select-text">
          {counts} · id: {doc.id}
        </p>
      </Section>

      <Section title="Canvas">
        <Row label="Paper">
          <ColorField label="Background" value={doc.settings.background} onChange={(background) => background !== "none" && setSettings({ background })} />
        </Row>
        <Segmented label="Grid" value={doc.settings.grid} options={GRIDS} onChange={(grid) => setSettings({ grid })} />
        <div className="grid grid-cols-2 items-center gap-1.5">
          <NumberField label="Grid" suffix="px" value={doc.settings.gridSize} min={4} max={100} step={2} onCommit={(gridSize) => setSettings({ gridSize })} />
          <Toggle label="Snap" checked={doc.settings.snap} onChange={(snap) => setSettings({ snap })} />
        </div>
      </Section>

      <Section title="New connectors">
        <Segmented label="Default routing" value={doc.settings.routing} options={ROUTING} onChange={(routing) => setSettings({ routing })} />
      </Section>

      <Section title="Working with an agent">
        <p className="text-[12px] leading-relaxed text-ink-3">
          Select shapes and tell your agent to change <em>the selection</em>, or leave a comment on a shape — agents can read comments and reply.
        </p>
        <Button size="sm" onClick={() => store.setState({ dialog: "agent" })}>
          Connect Claude Code or Codex
        </Button>
      </Section>
    </>
  );
}
