"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DiagramSummary } from "@/core/model/types";

import { errorMessage, listDiagrams } from "./api";
import { useWorkspaceEvents } from "./use-workspace-events";

const REFETCH_DEBOUNCE_MS = 250;

export type DiagramsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; diagrams: DiagramSummary[] };

const byMostRecent = (a: DiagramSummary, b: DiagramSummary) => b.updatedAt.localeCompare(a.updatedAt);

/**
 * The diagram list, most recently updated first. Loads on mount (and again
 * whenever the route becomes visible), then refetches when the workspace
 * stream reports a change.
 */
export function useDiagrams(): { state: DiagramsState; retry: () => void; remove: (id: string) => void } {
  const [state, setState] = useState<DiagramsState>({ status: "loading" });
  const request = useRef<AbortController | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    // Only the latest request may write state.
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const diagrams = await listDiagrams(controller.signal);
      if (controller.signal.aborted) return;
      setState({ status: "ready", diagrams: [...diagrams].sort(byMostRecent) });
    } catch (error) {
      if (controller.signal.aborted) return;
      // A failed background refresh keeps the list that is already on screen.
      setState((previous) => (previous.status === "ready" ? previous : { status: "error", message: errorMessage(error) }));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      window.clearTimeout(timer.current);
      request.current?.abort();
    };
  }, [load]);

  // `hello` also arrives after a reconnect, when changes may have been missed.
  useWorkspaceEvents((event) => {
    if (event.type !== "diagrams" && event.type !== "hello") return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), REFETCH_DEBOUNCE_MS);
  });

  const retry = useCallback(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  /** Drops a diagram right away instead of waiting for the next refetch. */
  const remove = useCallback((id: string) => {
    setState((previous) => (previous.status === "ready" ? { ...previous, diagrams: previous.diagrams.filter((diagram) => diagram.id !== id) } : previous));
  }, []);

  return { state, retry, remove };
}
