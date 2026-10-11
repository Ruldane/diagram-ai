"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Fades its content up once. The class is dropped when the animation ends, so
 * it does not replay each time the route is shown again after a navigation.
 */
export function Reveal({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <div
      className={cn(!done && "motion-safe:animate-fade-up", className)}
      style={done ? undefined : { animationDelay: `${delay}ms` }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setDone(true);
      }}
    >
      {children}
    </div>
  );
}
