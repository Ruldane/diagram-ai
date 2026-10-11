"use client";

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

import { Tip } from "./tooltip";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-ink-2 shadow-[var(--shadow-sm)]",
  secondary: "bg-raised text-ink border border-line-strong hover:border-ink-3 shadow-[var(--shadow-sm)]",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-md",
  md: "h-8 px-3 text-[13px] gap-2 rounded-lg",
  lg: "h-10 px-4 text-[14px] gap-2 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors select-none",
        "disabled:opacity-45 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: "sm" | "md";
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/** Square icon-only button with a tooltip that doubles as its accessible name. */
export function IconButton({ label, shortcut, active, size = "md", side, className, children, type = "button", ...props }: IconButtonProps) {
  return (
    <Tip label={label} shortcut={shortcut} side={side}>
      <button
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors select-none",
          "disabled:opacity-35 disabled:pointer-events-none",
          size === "sm" ? "size-7" : "size-8",
          active ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tip>
  );
}
