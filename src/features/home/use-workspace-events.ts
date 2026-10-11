"use client";

import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

import type { AgentInfo, WorkspaceEvent } from "@/core/protocol";

export interface WorkspaceState {
  /** `connecting` until the first `hello`; `offline` while the stream is reconnecting. */
  connection: "connecting" | "online" | "offline";
  agents: AgentInfo[];
}

const INITIAL: WorkspaceState = { connection: "connecting", agents: [] };

/**
 * One `/api/events` stream shared by every hook on the page. It opens with the
 * first subscriber and closes with the last, so a route hidden by `<Activity>`
 * (whose effects are cleaned up) holds no connection.
 */
let state = INITIAL;
let source: EventSource | null = null;
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(event: WorkspaceEvent) => void>();

function setState(next: WorkspaceState) {
  state = next;
  stateListeners.forEach((listener) => listener());
}

function handle(event: WorkspaceEvent) {
  if (event.type === "hello") setState({ connection: "online", agents: event.agents });
  else if (event.type === "agent") setState({ ...state, agents: [...state.agents.filter((agent) => agent.id !== event.agent.id), event.agent] });
  eventListeners.forEach((listener) => listener(event));
}

function open() {
  source = new EventSource("/api/events");
  source.onmessage = (message: MessageEvent<string>) => {
    let event: WorkspaceEvent;
    try {
      event = JSON.parse(message.data) as WorkspaceEvent;
    } catch {
      return;
    }
    handle(event);
  };
  // EventSource reconnects by itself; the next `hello` brings the state back.
  source.onerror = () => {
    if (state.connection !== "offline") setState({ ...state, connection: "offline" });
  };
}

function retain(): () => void {
  if (stateListeners.size + eventListeners.size === 0) open();
  return () => {
    if (stateListeners.size + eventListeners.size > 0) return;
    source?.close();
    source = null;
    state = INITIAL;
  };
}

function subscribeState(listener: () => void): () => void {
  const release = retain();
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
    release();
  };
}

const getState = () => state;
const getServerState = () => INITIAL;

/** Connection status and the agents seen recently, kept live. */
export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(subscribeState, getState, getServerState);
}

/** Calls `onEvent` for every workspace event while the component is visible. */
export function useWorkspaceEvents(onEvent: (event: WorkspaceEvent) => void): void {
  const handler = useEffectEvent(onEvent);
  useEffect(() => {
    const listener = (event: WorkspaceEvent) => handler(event);
    const release = retain();
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
      release();
    };
  }, []);
}
