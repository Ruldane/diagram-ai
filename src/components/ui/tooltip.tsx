"use client";

import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

import { Kbd } from "./kbd";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </Tooltip.Provider>
  );
}

export interface TipProps {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}

/** Tooltip around a single focusable child. Requires a `TooltipProvider` ancestor. */
export function Tip({ label, shortcut, side = "bottom", children }: TipProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-[80] flex items-center gap-2 rounded-md bg-ink px-2 py-1 text-[11.5px] font-medium text-bg shadow-[var(--shadow-md)] animate-pop"
        >
          {label}
          {shortcut ? <Kbd inverted>{shortcut}</Kbd> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
