import { toast } from "sonner";

import { mergePatches } from "@/core/model/patch";
import { boundsOfNodes } from "@/core/model/queries";
import type { DiagramDoc, Patch } from "@/core/model/types";
import type { ActivityEntry, DiagramEvent, DiagramResponse } from "@/core/protocol";

import type { EditorStore } from "../store/editor-store";
import { playRemotePatch, stopPlayback } from "./playback";

const ACTIVITY_LIMIT = 200;
const PRESENCE_DEBOUNCE_MS = 350;
const CURSOR_INTERVAL_MS = 80;
const RETRY_DELAYS_MS = [400, 1200, 3000];

/**
 * Keeps one editor in sync with the server:
 *  - loads the document,
 *  - sends local patches (in order, batched while a request is in flight),
 *  - applies and animates patches from agents and other tabs,
 *  - reports the human's selection so agents can act on it.
 *
 * Returns a function that tears everything down.
 */
export function connectSync(store: EditorStore): () => void {
  const { diagramId, clientId } = store.getState();
  const base = `/api/diagrams/${diagramId}`;
  let disposed = false;
  /** Highest server revision this tab has seen. */
  let version = 0;
  let source: EventSource | null = null;

  /* ------------------------------------------------------------- loading */

  async function fetchDoc(): Promise<DiagramDoc | null> {
    const response = await fetch(base, { cache: "no-store" });
    if (response.status === 404) {
      store.setState({ status: "missing" });
      return null;
    }
    if (response.status === 401) {
      // Accounts are on and this browser has neither a session nor a share link for the diagram.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the sync client has no router, and a full load resets the editor
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      return null;
    }
    if (!response.ok) throw new Error(`Failed to load diagram (${response.status})`);
    const body = (await response.json()) as DiagramResponse;
    // Accounts on: what this person may do. A viewer gets a read-only editor.
    store.setState({ role: body.viewer?.role ?? "owner", me: body.viewer?.user ?? null, readOnly: body.viewer?.role === "viewer" });
    return body.diagram;
  }

  async function reload() {
    try {
      const doc = await fetchDoc();
      if (disposed || !doc) return;
      stopPlayback(store);
      version = doc.version;
      store.getState().load(doc);
    } catch (error) {
      console.error(error);
      if (!disposed && !store.getState().doc) store.setState({ status: "error" });
    }
  }

  /* ------------------------------------------------------------ outgoing */

  let queue: Patch[] = [];
  let sending = false;

  async function post(patch: Patch): Promise<boolean> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await fetch(`${base}/ops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, patch }),
        });
        // The revision counter is advanced only by the event stream, which is
        // totally ordered; using this response too could skip a remote patch.
        if (response.ok) return true;
        // A rejected patch will not succeed on retry.
        if (response.status >= 400 && response.status < 500) return false;
      } catch {
        // network error: retry below
      }
      if (attempt < RETRY_DELAYS_MS.length) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
    return false;
  }

  async function flush() {
    if (sending) return;
    sending = true;
    while (queue.length && !disposed) {
      // Coalesce everything queued while the previous request was in flight.
      const patch = mergePatches(...queue);
      queue = [];
      if (!(await post(patch))) {
        queue = [];
        toast.error("Your last change could not be saved. The diagram was reloaded.");
        await reload();
        break;
      }
    }
    sending = false;
  }

  store.setState({
    emit: (patch) => {
      queue.push(patch);
      void flush();
    },
  });

  /* ------------------------------------------------------------ incoming */

  function addActivity(entry: ActivityEntry) {
    const activity = [...store.getState().activity, entry];
    store.setState({ activity: activity.length > ACTIVITY_LIMIT ? activity.slice(-ACTIVITY_LIMIT) : activity });
  }

  function handle(event: DiagramEvent) {
    switch (event.type) {
      case "hello":
        store.setState({ connection: "online", agents: event.agents, activity: event.activity, review: event.review ?? null, peers: (event.peers ?? []).filter((peer) => peer.id !== clientId) });
        // Missed changes while disconnected (or the first load raced a write).
        if (store.getState().doc && event.version > version) void reload();
        break;
      case "patch": {
        if (event.origin === clientId) {
          version = Math.max(version, event.version);
          break;
        }
        if (event.version <= version) break;
        if (event.version !== version + 1) {
          void reload();
          break;
        }
        version = event.version;
        const before = store.getState().doc;
        store.getState().applyRemote(event.patch, event.actor);
        if (before && event.actor.kind === "agent") playRemotePatch(store, before, event.patch, event.actor, event.animate);
        break;
      }
      case "activity":
        addActivity(event.entry);
        break;
      case "agent": {
        const others = store.getState().agents.filter((agent) => agent.id !== event.agent.id);
        store.setState({ agents: [...others, event.agent] });
        break;
      }
      case "highlight": {
        store.setState({ highlight: { ids: event.ids, message: event.message, actor: event.actor, key: Date.now() } });
        const doc = store.getState().doc;
        const bounds = doc ? boundsOfNodes(event.ids.map((id) => doc.nodes[id]).filter(Boolean)) : null;
        if (bounds) store.getState().zoomTo(bounds, 160, Math.max(1, store.getState().viewport.zoom));
        break;
      }
      case "review":
        store.setState({ review: event.review });
        break;
      case "peer": {
        if (event.peer.id === clientId) break;
        const others = store.getState().peers.filter((peer) => peer.id !== event.peer.id);
        store.setState({ peers: [...others, event.peer] });
        break;
      }
      case "peer-left":
        store.setState({ peers: store.getState().peers.filter((peer) => peer.id !== event.id) });
        break;
      case "reset":
        void reload();
        break;
      case "deleted":
        store.setState({ status: "missing" });
        break;
    }
  }

  function open() {
    if (disposed) return;
    source = new EventSource(`${base}/events?client=${encodeURIComponent(clientId)}`);
    source.onmessage = (message) => {
      try {
        handle(JSON.parse(message.data) as DiagramEvent);
      } catch (error) {
        console.error("Bad event from server", error);
      }
    };
    // EventSource reconnects by itself; the next `hello` triggers a resync if needed.
    source.onerror = () => {
      store.setState({ connection: "offline" });
      // A closed stream is not retried by the browser: the server refused it (signed out, access removed). Find out why.
      if (source?.readyState === EventSource.CLOSED) void reload();
    };
  }

  /* ------------------------------------------------------------ presence */

  let presenceTimer: number | undefined;
  let cursorTimer: number | undefined;
  let lastPresence = "";
  /** Pointer position in world coordinates; null while it is outside the canvas. */
  let cursor: { x: number; y: number } | null = null;
  let lastCursorSend = 0;
  let canvasRoot: Element | null = null;

  /** Reports selection, view and pointer. Selection and view drive "this" for agents; the pointer is shown to other people. */
  function sendPresence() {
    const { selection, viewport, canvasSize, status } = store.getState();
    if (status !== "ready" || disposed) return;
    const body = JSON.stringify({
      clientId,
      selection,
      viewport: { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, w: canvasSize.w / viewport.zoom, h: canvasSize.h / viewport.zoom },
      cursor,
    });
    if (body === lastPresence) return;
    lastPresence = body;
    lastCursorSend = Date.now();
    void fetch(`${base}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.selection === previous.selection && state.viewport === previous.viewport && state.canvasSize === previous.canvasSize) return;
    window.clearTimeout(presenceTimer);
    presenceTimer = window.setTimeout(sendPresence, PRESENCE_DEBOUNCE_MS);
  });

  // Live cursors: only worth sending while somebody else is on the diagram, and no faster than ~12 per second.
  function onPointerMove(event: PointerEvent) {
    if (!canvasRoot?.isConnected) canvasRoot = document.querySelector(".canvas-root");
    let next: { x: number; y: number } | null = null;
    if (canvasRoot && event.target instanceof Node && canvasRoot.contains(event.target)) {
      const rect = canvasRoot.getBoundingClientRect();
      const world = store.getState().toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      next = { x: Math.round(world.x), y: Math.round(world.y) };
    }
    cursor = next;
    if (store.getState().peers.length === 0) return;
    const wait = CURSOR_INTERVAL_MS - (Date.now() - lastCursorSend);
    window.clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(sendPresence, Math.max(0, wait));
  }
  document.addEventListener("pointermove", onPointerMove, { passive: true });

  void reload().then(open);

  return () => {
    disposed = true;
    source?.close();
    unsubscribe();
    document.removeEventListener("pointermove", onPointerMove);
    window.clearTimeout(presenceTimer);
    window.clearTimeout(cursorTimer);
    stopPlayback(store);
    store.setState({ emit: null, connection: "connecting" });
  };
}
