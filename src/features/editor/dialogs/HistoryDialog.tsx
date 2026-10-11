"use client";

import { GitCompareArrows, LoaderCircle, RotateCcw, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { Actor } from "@/core/model/types";
import type { ApiError, SnapshotInfo } from "@/core/protocol";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextInput } from "@/components/ui/fields";
import { actorColor, timeAgo } from "@/lib/agents";

import { compareWithCheckpoint } from "../review/review-state";
import { useEditor, useEditorStore } from "../store/context";
import { useClock } from "./use-clock";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; snapshots: SnapshotInfo[] };

const NAME_MAX_LENGTH = 120;

const newestFirst = (snapshots: SnapshotInfo[]): SnapshotInfo[] => [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;
const authorColor = (author: Actor): string => (author.kind === "system" ? "var(--ink-4)" : actorColor(author));
const messageOf = (error: unknown, fallback: string): string => (error instanceof Error && error.message ? error.message : fallback);

/** Throws the server's `{ error }` message for a failed response. */
async function expectOk(response: Response, fallback: string): Promise<Response> {
  if (response.ok) return response;
  const body = (await response.json().catch(() => null)) as Partial<ApiError> | null;
  throw new Error(body?.error || `${fallback} (${response.status})`);
}

function CheckpointRow({ snapshot, now, confirming, restoring, comparing, locked, onAsk, onCancel, onRestore, onCompare }: {
  snapshot: SnapshotInfo;
  now: number;
  confirming: boolean;
  restoring: boolean;
  /** This checkpoint's document is being fetched for a comparison. */
  comparing: boolean;
  /** Another row is busy. */
  locked: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onRestore: () => void;
  onCompare: () => void;
}) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{snapshot.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-3">
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: authorColor(snapshot.author) }} />
            <span>{snapshot.author.name}</span>
            <span aria-hidden>·</span>
            <time dateTime={snapshot.createdAt} title={new Date(snapshot.createdAt).toLocaleString()}>
              {timeAgo(snapshot.createdAt, now)}
            </time>
            <span aria-hidden>·</span>
            <span className="font-mono text-[11px]">
              {count(snapshot.nodeCount, "node")}, {count(snapshot.edgeCount, "connector")}
            </span>
          </p>
        </div>
        {confirming ? null : (
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="ghost" onClick={onCompare} disabled={locked || comparing} aria-busy={comparing} aria-label={`Compare with ${snapshot.name}`}>
              {comparing ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <GitCompareArrows aria-hidden className="size-3.5" />}
              Compare
            </Button>
            <Button size="sm" onClick={onAsk} disabled={locked} aria-label={`Restore ${snapshot.name}`}>
              <RotateCcw aria-hidden className="size-3.5" />
              Restore
            </Button>
          </div>
        )}
      </div>

      {confirming ? (
        <div role="alert" className="mt-2.5 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-lg bg-sunken px-3 py-2">
          <p className="min-w-[200px] flex-1 text-[12px] leading-relaxed text-ink-2">
            This replaces the current diagram. Its current state is saved as a checkpoint first, so you can undo this from this list.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={restoring}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={onRestore} disabled={restoring} aria-busy={restoring}>
              {restoring ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : null}
              {restoring ? "Restoring…" : "Replace diagram"}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Checkpoints of the diagram: save one, or go back to an earlier one. */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const store = useEditorStore();
  const diagramId = useEditor((state) => state.diagramId);
  const clientId = useEditor((state) => state.clientId);
  const endpoint = `/api/diagrams/${encodeURIComponent(diagramId)}/snapshots`;
  const now = useClock();

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [comparing, setComparing] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then((response) => expectOk(response, "The checkpoints could not be loaded"))
      .then((response) => response.json() as Promise<{ snapshots: SnapshotInfo[] }>)
      .then(({ snapshots }) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", snapshots: newestFirst(snapshots) });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: messageOf(error, "The checkpoints could not be loaded.") });
      });
    return () => controller.abort();
  }, [endpoint, attempt]);

  const reload = () => {
    setLoad({ status: "loading" });
    setAttempt((value) => value + 1);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, clientId }),
      });
      const { snapshot } = (await (await expectOk(response, "The checkpoint could not be saved")).json()) as { snapshot: SnapshotInfo };
      setLoad((current) => (current.status === "ready" ? { status: "ready", snapshots: [snapshot, ...current.snapshots] } : current));
      // The list failed to load earlier: now is a good moment to try again.
      if (load.status === "error") reload();
      setName("");
      toast.success(`Saved checkpoint “${snapshot.name}”`);
    } catch (error) {
      toast.error(messageOf(error, "The checkpoint could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const restore = async (snapshot: SnapshotInfo) => {
    setRestoring(true);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(snapshot.id)}?client=${encodeURIComponent(clientId)}`, { method: "POST" });
      await expectOk(response, "The checkpoint could not be restored");
      // The server tells every open tab, this one included, to reload the diagram.
      toast.success(`Restored “${snapshot.name}”. The state before it is in the checkpoint list.`);
      onClose();
    } catch (error) {
      toast.error(messageOf(error, "The checkpoint could not be restored."));
      setRestoring(false);
    }
  };

  /** Shows the checkpoint as a diff on the canvas and in the Review tab, then gets out of the way. */
  const compare = async (snapshot: SnapshotInfo) => {
    setComparing(snapshot.id);
    try {
      await compareWithCheckpoint(store, snapshot.id);
      onClose();
    } catch (error) {
      toast.error(messageOf(error, "The checkpoint could not be loaded."));
      setComparing(null);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Checkpoints"
      description="Saved states of this diagram that you, or an agent, can return to."
      width="max-w-xl"
    >
      <form onSubmit={(event) => void save(event)} className="flex gap-2">
        <TextInput
          aria-label="Checkpoint name (optional)"
          placeholder="Name this checkpoint (optional)"
          maxLength={NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" disabled={saving || restoring} aria-busy={saving}>
          {saving ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Save aria-hidden className="size-4" />}
          <span className="max-[420px]:sr-only">Save checkpoint</span>
        </Button>
      </form>

      <div className="mt-4">
        {load.status === "loading" ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">Loading checkpoints…</span>
            {[0, 1, 2].map((row) => (
              <div key={row} aria-hidden className="h-[52px] animate-pulse rounded-xl bg-sunken" />
            ))}
          </div>
        ) : load.status === "error" ? (
          <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-line px-4 py-8 text-center">
            <p className="text-[13px] text-ink-2">{load.message}</p>
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : load.snapshots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
            <p className="font-display text-[18px] text-ink">No checkpoints yet</p>
            <p className="mx-auto mt-1 max-w-[340px] text-[13px] leading-relaxed text-ink-3">
              Save one before a big change, or ask your agent to. You can come back to it at any time.
            </p>
          </div>
        ) : (
          <ul aria-label="Checkpoints" className="divide-y divide-line rounded-xl border border-line bg-raised">
            {load.snapshots.map((snapshot) => (
              <CheckpointRow
                key={snapshot.id}
                snapshot={snapshot}
                now={now}
                confirming={confirming === snapshot.id}
                restoring={restoring && confirming === snapshot.id}
                comparing={comparing === snapshot.id}
                locked={restoring || saving || comparing !== null}
                onAsk={() => setConfirming(snapshot.id)}
                onCancel={() => setConfirming(null)}
                onRestore={() => void restore(snapshot)}
                onCompare={() => void compare(snapshot)}
              />
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
