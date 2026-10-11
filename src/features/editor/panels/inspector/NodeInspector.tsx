"use client";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Italic,
  Lock,
  LockOpen,
  Underline,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { resolveNodeStyle } from "@/core/model/defaults";
import { PALETTE, type PaletteName } from "@/core/model/palette";
import type { DNode, FontFamily, HAlign, NodeStyle, VAlign } from "@/core/model/types";
import { ICON_NAMES } from "@/core/shapes/icons";
import { getShape, libraryOfShape, searchShapes } from "@/core/shapes/registry";
import { FONT_FAMILIES, FONT_FAMILY_KEYS } from "@/core/text/fonts";
import { IconButton } from "@/components/ui/button";
import { Popover } from "@/components/ui/dialog";
import { NumberField, Segmented, Select, TextInput, Toggle } from "@/components/ui/fields";
import { cn } from "@/lib/cn";

import { changeShape, styleNodes, toggleLock, updateNodes } from "../../actions/elements";
import { useEditorStore } from "../../store/context";
import { ShapeThumb } from "../ShapeThumb";
import { ColorField, common, PaletteRow, Row, Section } from "./controls";

function ShapePicker({ nodes }: { nodes: DNode[] }) {
  const store = useEditorStore();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const shapeId = common(nodes, (n) => n.shape);
  const def = shapeId ? getShape(shapeId) : null;
  const results = useMemo(() => {
    if (deferred.trim()) return searchShapes(deferred, 32);
    // Without a query, offer siblings from the same library.
    return (shapeId ? libraryOfShape(shapeId)?.shapes : undefined)?.slice(0, 32) ?? searchShapes("", 32);
  }, [deferred, shapeId]);

  return (
    <Popover
      className="w-[244px]"
      trigger={
        <button type="button" className="flex h-9 w-full items-center gap-2 rounded-lg border border-line-strong bg-raised px-2 text-left hover:border-ink-3">
          {shapeId ? <ShapeThumb shapeId={shapeId} size={22} /> : <span className="size-[22px]" />}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{def ? def.name : "Mixed shapes"}</span>
          <span className="text-[11px] text-ink-3">Change</span>
        </button>
      }
    >
      <TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shapes" aria-label="Search shapes" />
      <div className="mt-2 grid max-h-56 grid-cols-5 gap-1 overflow-y-auto">
        {results.map((shape) => (
          <button
            key={shape.id}
            type="button"
            title={shape.name}
            aria-label={shape.name}
            onClick={() => changeShape(store, nodes.map((n) => n.id), shape.id)}
            className={cn("flex aspect-square items-center justify-center rounded-md border hover:bg-sunken", shape.id === shapeId ? "border-accent bg-accent-soft" : "border-transparent")}
          >
            <ShapeThumb shapeId={shape.id} size={30} />
          </button>
        ))}
      </div>
    </Popover>
  );
}

function IconPicker({ nodes }: { nodes: DNode[] }) {
  const store = useEditorStore();
  const [query, setQuery] = useState("");
  const current = common(nodes, (n) => (n.data?.icon as string | undefined) ?? (getShape(n.shape).data?.icon as string | undefined));
  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? ICON_NAMES.filter((name) => name.includes(q)) : ICON_NAMES).slice(0, 90);
  }, [query]);
  const pick = (icon: string) => updateNodes(store, nodes.map((n) => n.id), (node) => ({ ...node, data: { ...node.data, icon } }));

  return (
    <Popover
      className="w-[252px]"
      trigger={
        <button type="button" className="flex h-8 w-full items-center gap-2 rounded-lg border border-line-strong bg-raised px-2 text-left hover:border-ink-3">
          <ShapeThumb shapeId="icons/icon" size={18} />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">{current ?? "mixed"}</span>
        </button>
      }
    >
      <TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search 300+ icons" aria-label="Search icons" />
      <div className="mt-2 grid max-h-56 grid-cols-3 gap-1 overflow-y-auto">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => pick(name)}
            className={cn("truncate rounded-md px-1.5 py-1 text-left font-mono text-[11px] hover:bg-sunken", name === current ? "bg-accent-soft text-ink" : "text-ink-2")}
          >
            {name}
          </button>
        ))}
      </div>
    </Popover>
  );
}

const H_ALIGN = [
  { value: "left" as const, label: "Align left", icon: <AlignLeft /> },
  { value: "center" as const, label: "Align centre", icon: <AlignCenter /> },
  { value: "right" as const, label: "Align right", icon: <AlignRight /> },
];
const V_ALIGN = [
  { value: "top" as const, label: "Top", icon: <AlignVerticalJustifyStart /> },
  { value: "middle" as const, label: "Middle", icon: <AlignVerticalJustifyCenter /> },
  { value: "bottom" as const, label: "Bottom", icon: <AlignVerticalJustifyEnd /> },
];
const DASHES = [
  { value: "solid" as const, label: "Solid" },
  { value: "dashed" as const, label: "Dashed" },
  { value: "dotted" as const, label: "Dotted" },
];

/** Shared by node and edge inspectors. */
export function TextControls<S extends NodeStyle>({ style, mixedSize, apply }: {
  style: { fontFamily: FontFamily; fontSize: number; bold: boolean; italic: boolean; underline: boolean; textColor: string; align?: HAlign; valign?: VAlign };
  mixedSize?: boolean;
  apply: (style: Partial<S>) => void;
}) {
  const set = (value: Partial<NodeStyle>) => apply(value as Partial<S>);
  return (
    <>
      <div className="flex gap-1.5">
        <Select aria-label="Font" value={style.fontFamily} onChange={(event) => set({ fontFamily: event.target.value as FontFamily })} className="flex-1">
          {FONT_FAMILY_KEYS.map((key) => (
            <option key={key} value={key}>
              {FONT_FAMILIES[key].label}
            </option>
          ))}
        </Select>
        <div className="w-[76px] shrink-0">
          <NumberField label="Aa" value={style.fontSize} mixed={mixedSize} min={6} max={120} onCommit={(fontSize) => set({ fontSize })} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex h-8 items-center gap-0.5 rounded-lg border border-line-strong bg-sunken px-0.5">
          <IconButton size="sm" label="Bold" active={style.bold} onClick={() => set({ bold: !style.bold })}>
            <Bold className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label="Italic" active={style.italic} onClick={() => set({ italic: !style.italic })}>
            <Italic className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label="Underline" active={style.underline} onClick={() => set({ underline: !style.underline })}>
            <Underline className="size-3.5" />
          </IconButton>
        </div>
        <ColorField label="Text colour" value={style.textColor} onChange={(textColor) => set({ textColor })} />
      </div>
      {style.align !== undefined && style.valign !== undefined ? (
        <div className="flex gap-1.5">
          <Segmented label="Horizontal alignment" className="flex-1" value={style.align} options={H_ALIGN} onChange={(align) => set({ align })} />
          <Segmented label="Vertical alignment" className="flex-1" value={style.valign} options={V_ALIGN} onChange={(valign) => set({ valign })} />
        </div>
      ) : null}
    </>
  );
}

export function NodeInspector({ nodes }: { nodes: DNode[] }) {
  const store = useEditorStore();
  const ids = nodes.map((n) => n.id);
  const resolved = nodes.map((n) => resolveNodeStyle(getShape(n.shape).style, n.style));
  const first = resolved[0];
  const single = nodes.length === 1 ? nodes[0] : null;
  const apply = (style: NodeStyle) => styleNodes(store, ids, style);
  const move = (change: Partial<Pick<DNode, "x" | "y" | "w" | "h" | "rotation">>) =>
    updateNodes(store, ids, (node) => {
      const next = { ...node, ...change };
      if (!next.rotation) delete next.rotation;
      return next;
    });
  const usesIcon = nodes.every((n) => "icon" in (getShape(n.shape).data ?? {}));
  const locked = nodes.every((n) => n.locked);
  const theme = (name: PaletteName) => apply({ fill: PALETTE[name].fill, stroke: PALETTE[name].stroke, textColor: PALETTE[name].text });

  return (
    <>
      <Section
        title={nodes.length > 1 ? `${nodes.length} shapes` : "Shape"}
        action={
          <IconButton size="sm" label={locked ? "Unlock" : "Lock position"} active={locked} onClick={() => toggleLock(store)}>
            {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
          </IconButton>
        }
      >
        <ShapePicker nodes={nodes} />
        {usesIcon ? (
          <Row label="Icon">
            <IconPicker nodes={nodes} />
          </Row>
        ) : null}
      </Section>

      <Section title="Colour">
        <PaletteRow onPick={theme} activeFill={common(resolved, (s) => s.fill)} />
        <Row label="Fill">
          <ColorField label="Fill" allowNone value={common(resolved, (s) => s.fill)} mixed={common(resolved, (s) => s.fill) === undefined} onChange={(fill) => apply({ fill })} />
        </Row>
        <Row label="Border">
          <ColorField label="Border" allowNone value={common(resolved, (s) => s.stroke)} mixed={common(resolved, (s) => s.stroke) === undefined} onChange={(stroke) => apply({ stroke })} />
          <div className="w-[72px] shrink-0">
            <NumberField label="W" value={common(resolved, (s) => s.strokeWidth)} mixed={common(resolved, (s) => s.strokeWidth) === undefined} min={0} max={20} step={0.5} onCommit={(strokeWidth) => apply({ strokeWidth })} />
          </div>
        </Row>
        <Segmented label="Border style" value={common(resolved, (s) => s.dash)} options={DASHES} onChange={(dash) => apply({ dash })} />
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="Radius" value={common(resolved, (s) => s.radius)} mixed={common(resolved, (s) => s.radius) === undefined} min={0} max={200} onCommit={(radius) => apply({ radius })} />
          <NumberField
            label="Opacity"
            suffix="%"
            value={Math.round((common(resolved, (s) => s.opacity) ?? first.opacity) * 100)}
            min={5}
            max={100}
            step={5}
            onCommit={(value) => apply({ opacity: value / 100 })}
          />
        </div>
        <Toggle label="Drop shadow" checked={resolved.every((s) => s.shadow)} onChange={(shadow) => apply({ shadow })} />
      </Section>

      <Section title="Text">
        <TextControls<NodeStyle> style={first} mixedSize={common(resolved, (s) => s.fontSize) === undefined} apply={apply} />
      </Section>

      <Section title="Layout">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="X" value={common(nodes, (n) => n.x)} mixed={common(nodes, (n) => n.x) === undefined} onCommit={(x) => move({ x })} />
          <NumberField label="Y" value={common(nodes, (n) => n.y)} mixed={common(nodes, (n) => n.y) === undefined} onCommit={(y) => move({ y })} />
          <NumberField label="W" value={common(nodes, (n) => n.w)} mixed={common(nodes, (n) => n.w) === undefined} min={4} onCommit={(w) => move({ w })} />
          <NumberField label="H" value={common(nodes, (n) => n.h)} mixed={common(nodes, (n) => n.h) === undefined} min={4} onCommit={(h) => move({ h })} />
          <NumberField label="Rotate" suffix="°" value={common(nodes, (n) => n.rotation ?? 0)} mixed={common(nodes, (n) => n.rotation ?? 0) === undefined} min={-360} max={360} step={15} onCommit={(rotation) => move({ rotation })} />
        </div>
      </Section>

      {single ? (
        <Section title="Details">
          <TextInput
            key={`link:${single.id}`}
            defaultValue={single.link ?? ""}
            placeholder="Link (https://…)"
            aria-label="Link"
            onBlur={(event) => {
              const link = event.target.value.trim();
              if (link !== (single.link ?? "")) updateNodes(store, [single.id], (node) => ({ ...node, link: link || undefined }));
            }}
          />
          <textarea
            key={`note:${single.id}`}
            defaultValue={single.note ?? ""}
            rows={2}
            placeholder="Note for collaborators and agents (not shown on the canvas)"
            aria-label="Note"
            onBlur={(event) => {
              const note = event.target.value.trim();
              if (note !== (single.note ?? "")) updateNodes(store, [single.id], (node) => ({ ...node, note: note || undefined }));
            }}
            className="w-full resize-none rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-4 focus:border-accent"
          />
          <p className="font-mono text-[10.5px] text-ink-4 select-text">id: {single.id}</p>
        </Section>
      ) : null}
    </>
  );
}
