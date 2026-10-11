"use client";

import { Ban } from "lucide-react";
import type { ReactNode } from "react";

import { normalizeColor, PALETTE, type PaletteName } from "@/core/model/palette";
import type { Color } from "@/core/model/types";
import { Popover } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/** Titled group of controls in the inspector. */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-3 last:border-b-0">
      <header className="mb-2 flex h-5 items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
        {action}
      </header>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

/** Label on the left, control on the right. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-[62px] shrink-0 text-[12px] text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

const SWATCH_ORDER: PaletteName[] = ["default", "gray", "blue", "teal", "green", "yellow", "orange", "red", "pink", "purple", "dark"];

/** One-click themes: each sets fill, stroke and text colour together. */
export function PaletteRow({ onPick, activeFill }: { onPick: (name: PaletteName) => void; activeFill?: Color }) {
  return (
    <div role="group" aria-label="Colour theme" className="grid grid-cols-11 gap-1">
      {SWATCH_ORDER.map((name) => {
        const swatch = PALETTE[name];
        const active = activeFill === swatch.fill;
        return (
          <Tip key={name} label={name[0].toUpperCase() + name.slice(1)}>
            <button
              type="button"
              aria-label={`${name} colour theme`}
              aria-pressed={active}
              onClick={() => onPick(name)}
              className={cn("aspect-square rounded-md border-[1.5px] transition-transform hover:scale-110", active && "ring-2 ring-accent ring-offset-1 ring-offset-[var(--surface)]")}
              style={{ background: swatch.fill, borderColor: swatch.stroke }}
            />
          </Tip>
        );
      })}
    </div>
  );
}

const QUICK_COLORS: Color[] = [
  "#ffffff", "#f1f3f5", "#1c1f23", "#5c6670",
  ...SWATCH_ORDER.filter((n) => n !== "default" && n !== "gray" && n !== "dark").flatMap((n) => [PALETTE[n].fill, PALETTE[n].stroke]),
];

/**
 * Colour well with a popover: quick swatches, "none" when allowed, the native
 * picker and a hex field.
 */
export function ColorField({ label, value, onChange, allowNone, mixed }: {
  label: string;
  value: Color | undefined;
  onChange: (color: Color) => void;
  allowNone?: boolean;
  mixed?: boolean;
}) {
  const none = value === "none";
  return (
    <Popover
      className="w-[216px]"
      trigger={
        <button
          type="button"
          aria-label={`${label}: ${mixed ? "mixed" : (value ?? "default")}`}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-raised px-1.5 hover:border-ink-3"
        >
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded border border-line-strong"
            style={{ background: none || mixed || !value ? "transparent" : value }}
          >
            {none ? <Ban className="size-3.5 text-ink-3" /> : null}
          </span>
          <span className="truncate font-mono text-[11.5px] text-ink-2">{mixed ? "mixed" : none ? "none" : (value ?? "—")}</span>
        </button>
      }
    >
      <p className="mb-2 text-[12px] font-semibold text-ink-2">{label}</p>
      <div className="grid grid-cols-8 gap-1">
        {allowNone ? (
          <button
            type="button"
            aria-label="None"
            onClick={() => onChange("none")}
            className={cn("flex aspect-square items-center justify-center rounded border border-line-strong text-ink-3 hover:scale-110", none && "ring-2 ring-accent")}
          >
            <Ban className="size-3.5" />
          </button>
        ) : null}
        {QUICK_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            onClick={() => onChange(color)}
            className={cn("aspect-square rounded border border-line-strong transition-transform hover:scale-110", value === color && "ring-2 ring-accent")}
            style={{ background: color }}
          />
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} custom colour`}
          value={none || !value ? "#ffffff" : value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-line-strong bg-raised p-0.5"
        />
        <input
          key={value}
          defaultValue={none ? "" : (value ?? "")}
          placeholder="#rrggbb"
          aria-label={`${label} hex value`}
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const color = normalizeColor(event.currentTarget.value);
            if (color) onChange(color);
          }}
          onBlur={(event) => {
            const color = normalizeColor(event.currentTarget.value);
            if (color && color !== value) onChange(color);
          }}
          className="h-8 w-full min-w-0 rounded-lg border border-line-strong bg-raised px-2 font-mono text-[12px] text-ink outline-none focus:border-accent"
        />
      </div>
    </Popover>
  );
}

/** Value shared by every item, or undefined when they differ. */
export function common<T, V>(items: T[], read: (item: T) => V): V | undefined {
  if (!items.length) return undefined;
  const first = read(items[0]);
  return items.every((item) => read(item) === first) ? first : undefined;
}
