"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

let now = 0;
const listeners = new Set<() => void>();
let timer: number | undefined;

function tick() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    // Catch up after having been paused (route hidden, tab in the background).
    now = Date.now();
    timer = window.setInterval(tick, TICK_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.clearInterval(timer);
  };
}

const getSnapshot = () => (now ||= Date.now());
const getServerSnapshot = () => 0;

/**
 * The current time, refreshed every 30 s so relative labels ("3 min ago") stay
 * true. Returns 0 while prerendering and hydrating: only use it for content
 * that appears once data has loaded in the browser.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
