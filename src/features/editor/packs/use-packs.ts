"use client";

import { useEffect, useSyncExternalStore } from "react";

import { packToLibrary, type IconPack, type PackIcon, type PackSummary } from "@/core/shapes/packs";
import { isRuntimeLibrary, listLibraries, registerLibrary, registryVersion, subscribeRegistry, unregisterLibrary } from "@/core/shapes/registry";

/**
 * Client side of the icon packs: keeps the browser's shape registry in step
 * with the packs installed on the server, and exposes the list for the dialog.
 * Plain module state (one registry per page), read through `useSyncExternalStore`.
 */

export interface PacksSnapshot {
  packs: PackSummary[];
  /** The first load has finished (successfully or not). */
  ready: boolean;
  error: string | null;
}

/** What the server answers after installing a pack. */
export interface InstallResult {
  pack: PackSummary;
  warnings: string[];
  skipped: { path: string; reason: string }[];
  replaced: boolean;
}

const INITIAL: PacksSnapshot = { packs: [], ready: false, error: null };
/** Do not ask again within this window when the tab regains focus. */
const REFRESH_MS = 3000;

let snapshot = INITIAL;
const listeners = new Set<() => void>();
/** Pack id → `updatedAt` of the version that is registered. */
const loaded = new Map<string, string>();
/** The first few icons of each loaded pack, for thumbnails in the manager. */
const previews = new Map<string, PackIcon[]>();
const PREVIEW_ICONS = 4;
let inflight: Promise<void> | null = null;
let fetchedAt = 0;

function publish(next: PacksSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

function register(pack: IconPack, updatedAt: string): void {
  try {
    registerLibrary(packToLibrary(pack));
    loaded.set(pack.id, updatedAt);
    previews.set(pack.id, pack.icons.slice(0, PREVIEW_ICONS));
  } catch (error) {
    console.warn(`Icon pack "${pack.id}" could not be loaded:`, error);
  }
}

async function load(): Promise<void> {
  try {
    if (!snapshot.ready) {
      // First load: one request carries everything.
      const { packs, full } = await api<{ packs: PackSummary[]; full: IconPack[] }>("/api/packs?full=1");
      const updated = new Map(packs.map((pack) => [pack.id, pack.updatedAt]));
      for (const pack of full) register(pack, updated.get(pack.id) ?? "");
      publish({ packs, ready: true, error: null });
      return;
    }
    const { packs } = await api<{ packs: PackSummary[] }>("/api/packs");
    const wanted = new Set(packs.map((pack) => pack.id));
    for (const library of listLibraries()) {
      if (isRuntimeLibrary(library.id) && !wanted.has(library.id)) {
        unregisterLibrary(library.id);
        loaded.delete(library.id);
        previews.delete(library.id);
      }
    }
    await Promise.all(
      packs
        .filter((pack) => loaded.get(pack.id) !== pack.updatedAt || !isRuntimeLibrary(pack.id))
        .map(async (summary) => register(await api<IconPack>(`/api/packs/${encodeURIComponent(summary.id)}`), summary.updatedAt)),
    );
    publish({ packs, ready: true, error: null });
  } catch (error) {
    publish({ ...snapshot, ready: true, error: error instanceof Error ? error.message : "Could not load icon packs." });
  } finally {
    fetchedAt = Date.now();
  }
}

/** A few icons of an installed pack, to show what it contains. */
export const packPreview = (id: string): PackIcon[] => previews.get(id) ?? [];

/** Re-reads the installed packs. Throttled unless `force` is set. */
export function refreshPacks(force = false): Promise<void> {
  if (!force && (inflight || Date.now() - fetchedAt < REFRESH_MS)) return inflight ?? Promise.resolve();
  const previous = inflight ?? Promise.resolve();
  const run = previous.then(load).finally(() => {
    if (inflight === run) inflight = null;
  });
  inflight = run;
  return run;
}

/** Uploads a pack (or SVG files / a base64 zip, see `POST /api/packs`) and registers it. */
export async function installPack(body: unknown): Promise<InstallResult> {
  const result = await api<InstallResult>("/api/packs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await refreshPacks(true);
  return result;
}

export async function removePack(id: string): Promise<void> {
  await api<{ ok: true }>(`/api/packs/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshPacks(true);
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePacks(): PacksSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => INITIAL);
}

/** Changes when any shape library is added, replaced or removed. */
export function useRegistryVersion(): number {
  return useSyncExternalStore(subscribeRegistry, registryVersion, () => 0);
}

/**
 * Loads the installed packs into the shape registry while a component is
 * mounted (the editor), and again whenever the tab regains focus, so packs
 * imported elsewhere show up.
 */
export function usePacksSync(): void {
  useEffect(() => {
    void refreshPacks();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshPacks();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
