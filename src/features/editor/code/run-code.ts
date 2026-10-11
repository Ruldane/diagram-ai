import { toast } from "sonner";

import { planCodeApply, type CodeApplyMode, type CodePlan } from "@/core/code/apply";
import { placePlan } from "@/core/code/layout";
import type { CodeParse } from "@/core/code/parse";
import { loadElk } from "@/core/layout/engine";
import { isEmptyPatch } from "@/core/model/patch";
import { boundsOfNodes } from "@/core/model/queries";
import type { Id } from "@/core/model/types";

import type { EditorStore } from "../store/editor-store";
import { playRemotePatch } from "../sync/playback";

const SELF = { kind: "human", id: "browser", name: "You" } as const;
/** How often a plan is redone because the document changed while it was being laid out. */
const ATTEMPTS = 3;
/** Matches the delay `autoLayout` waits for its animation before framing the result. */
const FRAME_DELAY_MS = 560;

export type ApplyOutcome =
  | { status: "applied"; plan: CodePlan }
  /** The text already matches the canvas. */
  | { status: "unchanged"; plan: CodePlan }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** "added 3 shapes, updated 1, removed 2" (or "add 3 shapes, update 1, remove 2"): what a plan does, in the words people use for what they see. */
export function describePlan(plan: CodePlan, tense: "past" | "future" = "past"): string {
  const [add, update, remove, change] = tense === "past" ? ["added", "updated", "removed", "changed"] : ["add", "update", "remove", "change"];
  const added = plan.created.nodes.length;
  const updated = plan.updated.nodes.length;
  const removed = plan.removed.nodes.length;
  const connectors = plan.created.edges.length + plan.updated.edges.length + plan.removed.edges.length;
  const parts = [
    added ? `${add} ${plural(added, "shape")}` : "",
    updated ? `${update} ${updated}` : "",
    removed ? `${remove} ${removed}` : "",
  ].filter(Boolean);
  if (!parts.length && connectors) parts.push(`${change} ${plural(connectors, "connector")}`);
  return parts.length ? parts.join(", ") : "make no changes";
}

/**
 * Applies parsed diagram text to the open document as ONE undoable edit.
 *
 * Layout is asynchronous, so the document may change underneath the plan (an
 * agent edits, the person types a label). The plan is built again from the
 * newest document in that case, so nothing is overwritten with stale content.
 */
export async function applyCode(
  store: EditorStore,
  parsed: CodeParse,
  mode: CodeApplyMode,
  options: { managed?: ReadonlySet<Id> } = {},
): Promise<ApplyOutcome> {
  if (parsed.empty) return { status: "skipped", reason: "There is nothing to apply yet." };
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const before = store.getState().doc;
    if (!before) return { status: "failed", reason: "The diagram is not loaded." };
    if (store.getState().readOnly) return { status: "skipped", reason: "This diagram is read-only." };

    let plan: CodePlan;
    let patch;
    try {
      plan = planCodeApply(before, parsed.imported, mode, { actor: SELF, managed: options.managed });
      patch = await placePlan(plan, await loadElk());
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.message : "The layout could not be computed." };
    }

    const state = store.getState();
    // Mid-drag edits are not recorded in history, so wait for the gesture to end instead of applying into it.
    if (state.gestureBase) return { status: "skipped", reason: "A drag is in progress." };
    if (state.doc !== before) continue;
    if (isEmptyPatch(patch)) return { status: "unchanged", plan };

    state.apply(patch);
    playRemotePatch(store, before, patch, SELF, "layout");
    reveal(store, plan, mode);
    return { status: "applied", plan };
  }
  return { status: "failed", reason: "The diagram kept changing while the text was applied. Try again." };
}

/** Brings new content into view: whole-diagram layouts and inserted blocks are framed; small edits leave the view alone. */
function reveal(store: EditorStore, plan: CodePlan, mode: CodeApplyMode): void {
  const framed = mode === "insert" || plan.placement.strategy === "full" || plan.placement.strategy === "cluster";
  if (!framed) return;
  const ids = mode === "insert" ? plan.created.nodes : plan.owned;
  window.setTimeout(() => {
    const doc = store.getState().doc;
    const bounds = doc ? boundsOfNodes(ids.map((id) => doc.nodes[id]).filter(Boolean)) : null;
    if (bounds) store.getState().zoomTo(bounds, 64, 1.1);
  }, FRAME_DELAY_MS);
}

/** Result message for an explicit Apply / Insert. */
export function announce(outcome: ApplyOutcome, mode: CodeApplyMode): void {
  switch (outcome.status) {
    case "applied":
      toast.success(mode === "insert" ? `Inserted ${describePlan(outcome.plan)}.` : `Applied: ${describePlan(outcome.plan)}.`);
      break;
    case "unchanged":
      toast("The canvas already matches this text.");
      break;
    case "skipped":
    case "failed":
      toast.error(outcome.reason);
      break;
  }
}
