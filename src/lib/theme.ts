"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function read(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // storage unavailable (private mode): the choice lasts for this page only
  }
  listeners.forEach((listener) => listener());
}

/**
 * Current theme and a toggle. The initial value is set before hydration by the
 * inline script in the root layout, so there is no flash.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore<Theme>(subscribe, read, () => "light");
  const toggle = useCallback(() => setTheme(read() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}
