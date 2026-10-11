import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface SectionProps {
  id: string;
  /** Two-digit caption, e.g. "01". */
  index: string;
  title: string;
  lead?: string;
  /** Right-aligned slot in the heading row (counts, small actions). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Numbered page section with a hairline-ruled heading. */
export function Section({ id, index, title, lead, aside, className, children }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20", className)}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
        <div className="min-w-0">
          <p aria-hidden className="font-mono text-[11px] tracking-[0.1em] text-ink-3">
            {index}
          </p>
          <h2 id={`${id}-title`} className="mt-1 font-display text-[30px] leading-none tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {lead ? <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-3">{lead}</p> : null}
        </div>
        {aside}
      </header>
      <div className="pt-5">{children}</div>
    </section>
  );
}
