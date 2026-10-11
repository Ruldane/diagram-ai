"use client";

import { useEffect, useState } from "react";

/** Current time, refreshed while mounted so relative times ("3 min ago") stay true. */
export function useClock(intervalMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
