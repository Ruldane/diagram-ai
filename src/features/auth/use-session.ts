"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { PublicUser, SessionInfo } from "@/core/auth";

import { signOut as requestSignOut } from "./api";

/**
 * Who is signed in, fetched once per page load and shared by everything that
 * shows it (the account menu, the redirect gate, the share dialog). Pages are
 * static shells, so this is read in the browser, never on the server.
 */
type State = { status: "loading" } | { status: "ready"; info: SessionInfo } | { status: "error" };

const LOADING: State = { status: "loading" };
let state: State = LOADING;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Loads (or reloads) the session. Concurrent calls share one request. */
export function refreshSession(): Promise<void> {
  inflight ??= fetch("/api/auth/session", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      set({ status: "ready", info: (await response.json()) as SessionInfo });
    })
    .catch(() => set(state.status === "ready" ? state : { status: "error" }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Records a sign-in that just happened, without waiting for another round trip. */
export function setSignedIn(user: PublicUser): void {
  const signup = state.status === "ready" ? state.info.signup : "invite";
  set({ status: "ready", info: { authRequired: true, user, signup } });
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export interface Session {
  loading: boolean;
  /** Accounts are on for this server. Solo mode: `false`, and nobody ever signs in. */
  authRequired: boolean;
  user: PublicUser | null;
  signup: SessionInfo["signup"];
  signOut: () => Promise<void>;
}

export function useSession(): Session {
  const current = useSyncExternalStore(subscribe, () => state, () => LOADING);
  useEffect(() => {
    if (state.status === "loading") void refreshSession();
  }, []);

  const signOut = useCallback(async () => {
    await requestSignOut().catch(() => undefined);
    set({ status: "ready", info: { authRequired: true, user: null, signup: state.status === "ready" ? state.info.signup : "invite" } });
    // Everything on screen belongs to the person who just left: start over on the sign-in page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose: nothing from the previous account may survive in memory
    window.location.href = "/login";
  }, []);

  if (current.status !== "ready") return { loading: current.status === "loading", authRequired: false, user: null, signup: "closed", signOut };
  return { loading: false, authRequired: current.info.authRequired, user: current.info.user, signup: current.info.signup, signOut };
}
