"use client";

import { useCallback, useEffect, useState } from "react";

import type { ChatStatusResponse } from "@/core/protocol";

/** Remembered across panel visits so switching tabs does not flash a loading state. */
let cached: ChatStatusResponse | null = null;

async function fetchStatus(): Promise<ChatStatusResponse | null> {
  try {
    const response = await fetch("/api/chat/status", { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ChatStatusResponse>;
    if (!Array.isArray(body.engines)) return null;
    return { engines: body.engines, default: body.default ?? null };
  } catch {
    return null;
  }
}

/**
 * Which engines can answer. While none can, the panel shows setup guidance;
 * coming back to the window re-checks, since the usual next step is editing
 * `.env.local` or signing in from a terminal.
 */
export function useChatStatus(): { status: ChatStatusResponse | null; failed: boolean; checking: boolean; refresh: () => void } {
  const [status, setStatus] = useState<ChatStatusResponse | null>(cached);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  const settle = useCallback((next: ChatStatusResponse | null) => {
    if (next) cached = next;
    setStatus(next ?? cached);
    setFailed(next === null);
    setChecking(false);
  }, []);

  const refresh = useCallback(() => {
    setChecking(true);
    void fetchStatus().then(settle);
  }, [settle]);

  useEffect(() => {
    let live = true;
    void fetchStatus().then((next) => {
      if (live) settle(next);
    });
    return () => {
      live = false;
    };
  }, [settle]);

  const waiting = status !== null && status.default === null;
  useEffect(() => {
    if (!waiting) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [waiting, refresh]);

  return { status, failed, checking, refresh };
}
