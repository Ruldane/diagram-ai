"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

import { Tip } from "./tooltip";

const FIELD =
  "h-8 w-full rounded-lg border border-line-strong bg-raised px-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-4 hover:border-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20";

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD, "appearance-none bg-[length:10px] bg-[right_8px_center] bg-no-repeat pr-6", className)} {...props}>
      {children}
    </select>
  );
}

/** Small caption above or beside a control. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-medium text-ink-3">{label}</span>
      {children}
    </label>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number | undefined;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Shown when the selection has several different values. */
  mixed?: boolean;
  disabled?: boolean;
}

/**
 * Compact numeric input with an inline label. Commits on Enter / blur and
 * supports ↑/↓ (Shift for ×10) so values can be nudged without retyping.
 */
export function NumberField({ label, value, onCommit, min = -Infinity, max = Infinity, step = 1, suffix, mixed, disabled }: NumberFieldProps) {
  const id = useId();
  const shown = mixed || value === undefined ? "" : String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(shown);
  // Reset the draft when the value changes from outside (selection change, undo, an agent edit).
  const [synced, setSynced] = useState(shown);
  if (synced !== shown) {
    setSynced(shown);
    setDraft(shown);
  }

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(parsed)) return setDraft(shown);
    const next = Math.min(max, Math.max(min, parsed));
    if (next !== value) onCommit(next);
    setDraft(String(Math.round(next * 100) / 100));
  };

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-raised pr-2 pl-2 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 hover:border-ink-3",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="shrink-0 font-mono text-[11px] text-ink-3">{label}</span>
      <input
        id={id}
        inputMode="decimal"
        value={draft}
        placeholder={mixed ? "mixed" : undefined}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setDraft(shown);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            commit(String((Number.parseFloat(draft) || value || 0) + delta));
          }
        }}
        className="w-full min-w-0 bg-transparent text-right font-mono text-[12px] text-ink outline-none placeholder:text-ink-4"
      />
      {suffix ? <span className="shrink-0 font-mono text-[11px] text-ink-4">{suffix}</span> : null}
    </label>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** Single-choice button group. Icon-only when options have icons. */
export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T | undefined;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex h-8 rounded-lg border border-line-strong bg-sunken p-0.5", className)}>
      {options.map((option) => {
        const selected = option.value === value;
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors [&>svg]:size-4",
              selected ? "bg-raised text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink",
            )}
          >
            {option.icon ?? <span className="truncate">{option.label}</span>}
          </button>
        );
        return option.icon ? (
          <Tip key={option.value} label={option.label}>
            {button}
          </Tip>
        ) : (
          button
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex h-8 cursor-pointer items-center justify-between gap-3 text-[13px] text-ink-2">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative h-[18px] w-8 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-3.5 rounded-full bg-white shadow transition-transform", checked && "translate-x-3.5")} />
      </button>
    </label>
  );
}
