import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Keyboard key cap. `inverted` is for dark surfaces such as tooltips. */
export function Kbd({ children, inverted, className }: { children: ReactNode; inverted?: boolean; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-mono text-[10.5px] leading-none",
        inverted ? "bg-white/15 text-bg" : "border border-line-strong bg-sunken text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
