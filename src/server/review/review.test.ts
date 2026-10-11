import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor, DiagramDoc, Patch } from "@/core/model/types";
import type { DiagramEvent } from "@/core/protocol";
import { diffForReview, revertPatch } from "@/core/review";

import type { Hub } from "../realtime/hub";
import type { DiagramService } from "../service";
import type { DiagramRepository } from "../store/repository";

const AGENT: Actor = { kind: "agent", id: "claude-code", name: "Claude Code" };
const OTHER_AGENT: Actor = { kind: "agent", id: "codex", name: "Codex" };
const HUMAN: Actor = { kind: "human", id: "browser", name: "You" };

let dataDir: string;
let reviewDir: string;
let make: () => { service: DiagramService; repo: DiagramRepository; hub: Hub };
const repositories: DiagramRepository[] = [];

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "diagram-ai-review-"));
  // The config reads the data directory when it is first imported.
  process.env.DIAGRAM_DATA_DIR = dataDir;
  const { createHubState, Hub: HubClass } = await import("../realtime/hub");
  const { createServiceState, DiagramService: ServiceClass } = await import("../service");
  const { createRepositoryState, FileRepository } = await import("../store/repository");
  reviewDir = (await import("../config")).REVIEW_DIR;
  make = () => {
    const hub = new HubClass(createHubState());
    const repo = new FileRepository(createRepositoryState());
    repositories.push(repo);
    return { service: new ServiceClass(repo, hub, createServiceState()), repo, hub };
  };
});

afterAll(async () => {
  // Pending debounced writes would recreate the directory.
  await Promise.all(repositories.map((repo) => repo.flush()));
  await rm(dataDir, { recursive: true, force: true });
});

/** A diagram a person drew: a → b → c, plus a comment. */
async function seeded() {
  const parts = make();
  const { service } = parts;
  const created = await service.create({ name: "Review", type: "flowchart" }, HUMAN);
  const id = created.id;
  await service.applyElements(
    id,
    {
      nodes: [
        { id: "a", text: "Start", x: 0, y: 0 },
        { id: "b", text: "Check", x: 200, y: 0 },
        { id: "c", text: "Done", x: 400, y: 0 },
      ],
      edges: [
        { from: "a", to: "b", text: "go" },
        { from: "b", to: "c" },
      ],
    },
    { actor: HUMAN, mode: "create", layout: "none" },
  );
  await service.addComment(id, { text: "Is this right?", target: "b" }, HUMAN);
  const seed = await service.get(id);
  const events: DiagramEvent[] = [];
  parts.hub.subscribe(id, (event) => events.push(event));
  return { ...parts, id, seed, events };
}

const reviews = (events: DiagramEvent[]) => events.flatMap((event) => (event.type === "review" ? [event.review] : []));

/** What the browser does when the person rejects: a revert patch through the ordinary edit path. */
async function reject(service: DiagramService, id: string, ids?: string[]): Promise<DiagramDoc> {
  const { base } = await service.reviewState(id);
  const doc = await service.get(id);
  expect(base).not.toBeNull();
  const wanted = ids ?? diffForReview(base!, doc).changes.map((change) => change.id);
  const patch: Patch = revertPatch(base!, doc, wanted);
  return service.commit(id, patch, HUMAN, { origin: "browser" });
}

const content = (doc: DiagramDoc) => ({ nodes: doc.nodes, edges: doc.edges, comments: doc.comments });

describe("review baseline", () => {
  let ctx: Awaited<ReturnType<typeof seeded>>;
  beforeEach(async () => {
    ctx = await seeded();
  });

  it("is created by an agent's first change, from the document as it was before", async () => {
    const { service, repo, id, seed, events } = ctx;
    expect((await service.reviewState(id)).review).toEqual({ active: false });

    await service.applyElements(id, { nodes: [{ id: "d", text: "New", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });

    const state = await service.reviewState(id);
    expect(state.review).toMatchObject({ active: true, by: AGENT });
    expect(state.review.since).toBeTruthy();
    expect(state.base?.nodes).toEqual(seed.nodes);
    expect(state.base?.nodes.d).toBeUndefined();
    expect((await repo.getReviewBase(id))?.by).toEqual(AGENT);
    expect(reviews(events)).toEqual([expect.objectContaining({ active: true })]);
    // The baseline is announced before the change it belongs to.
    expect(events.findIndex((e) => e.type === "review")).toBeLessThan(events.findIndex((e) => e.type === "patch"));
  });

  it("is not created by a person's edit, and not altered by one", async () => {
    const { service, id, seed, events } = ctx;
    await service.commit(id, { nodes: { set: [{ ...seed.nodes.a, text: "Begin" }] } }, HUMAN);
    expect((await service.reviewState(id)).review.active).toBe(false);
    expect(reviews(events)).toEqual([]);

    await service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    const first = (await service.reviewState(id)).base;
    expect(first?.nodes.a.text).toBe("Begin");

    await service.commit(id, { nodes: { set: [{ ...(await service.get(id)).nodes.b, text: "Verify" }], remove: ["c"] } }, HUMAN);
    const after = (await service.reviewState(id)).base;
    expect(after).toEqual(first);
  });

  it("is not created by name or settings changes alone", async () => {
    const { service, id } = ctx;
    await service.commit(id, { doc: { name: "Renamed", settings: { grid: "lines" } } }, AGENT);
    expect((await service.reviewState(id)).review.active).toBe(false);
  });

  it("is created once, however many changes follow and whoever makes them", async () => {
    const { service, id, seed } = ctx;
    await Promise.all([
      service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" }),
      service.applyElements(id, { nodes: [{ id: "e", x: 800, y: 0 }] }, { actor: OTHER_AGENT, mode: "create", layout: "none" }),
    ]);
    await service.applyElements(id, { nodes: [{ id: "f", x: 1000, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    const { review, base } = await service.reviewState(id);
    expect(review.by?.id).toBe("claude-code");
    expect(base?.nodes).toEqual(seed.nodes);
  });

  it("is created by an agent restoring a checkpoint", async () => {
    const { service, id, seed } = ctx;
    const snapshot = await service.createSnapshot(id, "Before", HUMAN);
    await service.commit(id, { nodes: { remove: ["c"] } }, HUMAN);
    await service.restoreSnapshot(id, snapshot.id, AGENT);
    const { review, base } = await service.reviewState(id);
    expect(review.active).toBe(true);
    expect(base?.nodes.c).toBeUndefined();
    expect((await service.get(id)).nodes.c).toEqual(seed.nodes.c);
  });

  it("survives a restart: a cold repository reads it back from disk", async () => {
    const { service, id } = ctx;
    await service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    expect(existsSync(path.join(reviewDir, `${id}.json`))).toBe(true);

    const cold = make();
    const base = await cold.repo.getReviewBase(id);
    expect(base?.by).toEqual(AGENT);
    expect(Object.keys(base!.doc.nodes).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("what agents changed", () => {
  it("shows up in the diff exactly, and each kind of change can be rejected", async () => {
    const { service, id, seed } = await seeded();
    const added = await service.applyElements(
      id,
      { nodes: [{ id: "d", text: "Cache", x: 200, y: 200 }], edges: [{ from: "b", to: "d", text: "reads" }] },
      { actor: AGENT, mode: "create", layout: "none" },
    );
    const edgeId = added.result.created.edges[0];
    await service.applyElements(id, { nodes: [{ id: "a", text: "Begin" }] }, { actor: AGENT, mode: "update", layout: "none" });
    await service.applyElements(id, { nodes: [{ id: "c", x: 420, y: 90 }] }, { actor: AGENT, mode: "update", layout: "none" });
    await service.remove(id, ["b"], AGENT);

    const { base } = await service.reviewState(id);
    const doc = await service.get(id);
    const diff = diffForReview(base!, doc);
    const byKind = (kind: string) => diff.changes.filter((change) => change.kind === kind).map((change) => change.id).sort();

    // `b` is gone with its connectors, including the one the agent had just added to `d`.
    const baseEdgeIds = Object.keys(seed.edges);
    const [commentId] = Object.keys(seed.comments);
    expect(byKind("added")).toEqual(["d"]);
    expect(byKind("removed")).toEqual(["b", ...baseEdgeIds].sort());
    // `a` was renamed; the comment pinned to the removed `b` came loose.
    expect(byKind("modified")).toEqual(["a", commentId].sort());
    expect(byKind("layout")).toEqual(["c"]);
    // The agent's edge died with its node: it is neither in the baseline nor in the document.
    expect(doc.edges[edgeId]).toBeUndefined();

    const restored = await reject(service, id);
    expect(content(restored)).toEqual(content(seed));
    // Rejecting is a normal edit: the baseline stays until a person accepts.
    expect((await service.reviewState(id)).review.active).toBe(true);
  });

  it("each single change rejects to the exact previous document", async () => {
    const cases: [string, (service: DiagramService, id: string) => Promise<unknown>][] = [
      ["added node", (s, id) => s.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }], edges: [{ from: "c", to: "d" }] }, { actor: AGENT, mode: "create", layout: "none" })],
      ["updated text", (s, id) => s.applyElements(id, { nodes: [{ id: "a", text: "Begin" }] }, { actor: AGENT, mode: "update", layout: "none" })],
      ["moved node", (s, id) => s.applyElements(id, { nodes: [{ id: "b", x: 250, y: 40 }] }, { actor: AGENT, mode: "update", layout: "none" })],
      ["removed node", (s, id) => s.remove(id, ["b"], AGENT)],
      ["removed connector", async (s, id) => s.remove(id, [Object.keys((await s.get(id)).edges)[0]], AGENT)],
      ["new comment", (s, id) => s.addComment(id, { text: "Why?", target: "c" }, AGENT)],
      ["resolved comment", async (s, id) => s.resolveComment(id, Object.keys((await s.get(id)).comments)[0], true, AGENT)],
      ["layout", (s, id) => s.layout(id, AGENT)],
    ];
    for (const [name, change] of cases) {
      const { service, id, seed } = await seeded();
      await change(service, id);
      const { base } = await service.reviewState(id);
      const doc = await service.get(id);
      expect(diffForReview(base!, doc).changes.length, `${name}: something to review`).toBeGreaterThan(0);
      const restored = await reject(service, id);
      expect(content(restored), name).toEqual(content(seed));
    }
  });

  it("works with the layout an agent gets by default", async () => {
    const { service, id, seed } = await seeded();
    await service.applyElements(
      id,
      { nodes: [{ id: "d", text: "Queue" }, { id: "e", text: "Worker" }], edges: [{ from: "c", to: "d" }, { from: "d", to: "e" }] },
      { actor: AGENT, mode: "create" },
    );
    const { base } = await service.reviewState(id);
    const diff = diffForReview(base!, await service.get(id));
    expect(diff.counts.added).toBe(4);
    const restored = await reject(service, id);
    expect(content(restored)).toEqual(content(seed));
  });
});

describe("accepting", () => {
  it("everything clears the baseline and tells the browsers", async () => {
    const { service, repo, id, events } = await seeded();
    await service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    expect((await service.reviewState(id)).review.active).toBe(true);

    const result = await service.acceptReview(id, "all");
    expect(result.review).toEqual({ active: false });
    expect(result.base).toBeNull();
    expect(await repo.getReviewBase(id)).toBeNull();
    expect(existsSync(path.join(reviewDir, `${id}.json`))).toBe(false);
    expect(reviews(events).at(-1)).toEqual({ active: false });

    // The next agent change starts a fresh baseline from the accepted state.
    await service.applyElements(id, { nodes: [{ id: "e", x: 800, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    const next = await service.reviewState(id);
    expect(next.review.active).toBe(true);
    expect(next.base?.nodes.d).toBeDefined();
    expect(next.base?.nodes.e).toBeUndefined();
  });

  it("some elements keeps the rest awaiting review", async () => {
    const { service, id, events } = await seeded();
    await service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }, { id: "e", x: 800, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    await service.applyElements(id, { nodes: [{ id: "a", text: "Begin" }] }, { actor: AGENT, mode: "update", layout: "none" });

    const result = await service.acceptReview(id, ["d", "a"]);
    expect(result.accepted.sort()).toEqual(["a", "d"]);
    expect(result.review.active).toBe(true);
    expect(result.base?.nodes.d).toBeDefined();
    expect(result.base?.nodes.a.text).toBe("Begin");
    expect(result.base?.nodes.e).toBeUndefined();
    expect(reviews(events).at(-1)).toMatchObject({ active: true });

    const { base } = await service.reviewState(id);
    const diff = diffForReview(base!, await service.get(id));
    expect(diff.changes.map((change) => change.id)).toEqual(["e"]);

    // Accepting the last one closes the review.
    expect((await service.acceptReview(id, ["e"])).review.active).toBe(false);
  });

  it("an empty selection closes a review that no longer differs", async () => {
    const { service, id } = await seeded();
    await service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    expect((await service.acceptReview(id, [])).review.active).toBe(true);
    await reject(service, id);
    expect((await service.acceptReview(id, [])).review.active).toBe(false);
  });

  it("is harmless when nothing is pending", async () => {
    const { service, id } = await seeded();
    expect(await service.acceptReview(id, "all")).toMatchObject({ review: { active: false }, base: null, accepted: [] });
  });

  it("leaves the diagram itself untouched", async () => {
    const { service, id } = await seeded();
    await service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    const before = await service.get(id);
    await service.acceptReview(id, "all");
    expect(await service.get(id)).toBe(before);
  });
});

describe("diagrams and checkpoints", () => {
  it("deleting a diagram removes its baseline", async () => {
    const { service, repo, id } = await seeded();
    await service.applyElements(id, { nodes: [{ id: "d", x: 600, y: 0 }] }, { actor: AGENT, mode: "create", layout: "none" });
    expect(existsSync(path.join(reviewDir, `${id}.json`))).toBe(true);

    await service.deleteDiagram(id);
    expect(existsSync(path.join(reviewDir, `${id}.json`))).toBe(false);
    expect(await repo.getReviewBase(id)).toBeNull();
  });

  it("a checkpoint can be fetched with its document", async () => {
    const { service, id, seed } = await seeded();
    const info = await service.createSnapshot(id, "Before the agent", HUMAN);
    const snapshot = await service.getSnapshot(id, info.id);
    expect(snapshot).toMatchObject({ id: info.id, name: "Before the agent" });
    expect(snapshot.doc.nodes).toEqual(seed.nodes);
    await expect(service.getSnapshot(id, "nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("review status for agents", () => {
  it("counts what is pending and remembers what the user put back", async () => {
    const { service, id } = await seeded();
    await service.applyElements(
      id,
      { nodes: [{ id: "d", text: "Cache", x: 600, y: 0 }, { id: "e", text: "Queue", x: 800, y: 0 }], edges: [{ from: "c", to: "d" }] },
      { actor: AGENT, mode: "create", layout: "none" },
    );
    await service.applyElements(id, { nodes: [{ id: "c", x: 420, y: 10 }] }, { actor: AGENT, mode: "update", layout: "none" });

    let status = await service.reviewStatus(id);
    expect(status.review.active).toBe(true);
    expect(status.counts).toMatchObject({ added: 3, layout: 1, modified: 0, removed: 0 });
    expect(status.rearranged).toEqual({ nodes: 1, edges: 0 });
    expect(status.reverted).toEqual([]);

    // The person deletes the Cache node (and, with it, the agent's connector).
    await service.commit(id, { nodes: { remove: ["d"] } }, HUMAN);
    status = await service.reviewStatus(id);
    expect(status.reverted.map((item) => ({ id: item.id, how: item.how, label: item.label })).filter((item) => item.id === "d")).toEqual([
      { id: "d", how: "removed", label: "Cache" },
    ]);
    expect(status.changes.map((change) => change.label)).toContain("Queue");
    expect(status.changes.map((change) => change.id)).not.toContain("d");

    // Accepting forgets it.
    await service.acceptReview(id, "all");
    expect((await service.reviewStatus(id)).reverted).toEqual([]);
  });
});
