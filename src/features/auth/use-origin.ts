"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/** This page's origin, for building links. A fixed fallback on the server keeps prerendering deterministic. */
export function useOrigin(): string {
  return useSyncExternalStore(subscribe, () => window.location.origin, () => "http://localhost:3000");
}
