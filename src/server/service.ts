import { getDiagramType, resolveDiagramType } from "@/core/catalog";
import { exportPages, type ExportScope } from "@/core/export/pages";
import { importDrawio } from "@/core/io/drawio";
import { importMermaid } from "@/core/io/mermaid";
import { loadElk } from "@/core/layout/engine";
import { computeLayout } from "@/core/layout/layout";
import { placeNear } from "@/core/layout/place";
import { createDoc } from "@/core/model/defaults";
import { newDiagramId, newId, randomId } from "@/core/model/ids";
import { removalPatch, withIntegrity } from "@/core/model/integrity";
import { applyPatch, isEmptyPatch, mergePatches, patchStats } from "@/core/model/patch";
import { boundsOfNodes } from "@/core/model/queries";
import { docSchema, formatIssues } from "@/core/model/schema";
import type { Actor, DComment, DiagramDoc, DiagramSummary, Id, LayoutOptions, Patch, Point } from "@/core/model/types";
import type { ActivityAction, ClientPresence, ExportFormat, PatchAnimation, SnapshotInfo } from "@/core/protocol";
import { applySpec, type ApplyResult, type ElementsSpec } from "@/core/spec/apply";
import { buildSequence, type SequenceSpec } from "@/core/spec/sequence";

import { invalid, notFound } from "./errors";
import { ensurePacks } from "./packs/runtime";
import type { Hub } from "./realtime/hub";
import { exportDiagram, pagePng, type ExportedFile, type ExportOptions } from "./render/export";
import { createReviewMemory, ReviewTracker, type ReviewMemory, type ReviewState, type ReviewStatus } from "./review/tracker";
import { makeSnapshot, toSnapshotInfo, type DiagramRepository, type Snapshot } from "./store/repository";

export const SYSTEM_ACTOR: Actor = { kind: "system", id: "system", name: "System" };

export interface CommitOptions {
  /** Browser tab that produced the change; it ignores its own echo. */
  origin?: string;
  animate?: PatchAnimation;
  /** Adds a line to the activity feed. */
  log?: { action: ActivityAction; summary: string; ids?: Id[] };
}

export interface CreateInput {
  name?: string;
  type?: string;
  description?: string;
  template?: boolean;
}

export type LayoutRequest = "auto" | "none" | LayoutOptions;

export interface ApplyElementsResult {
  doc: DiagramDoc;
  result: ApplyResult;
  /** Whether positions were computed automatically. */
  layout: "full" | "incremental" | "none";
}

/** Lower-cases a leading capital unless it starts an acronym ("Flowchart" → "flowchart", "UML class diagram" stays). */
const sentenceCase = (name: string): string => (/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

function describeApply(result: ApplyResult): string {
  const parts: string[] = [];
  const added = [
    result.created.nodes.length ? plural(result.created.nodes.length, "node") : "",
    result.created.edges.length ? plural(result.created.edges.length, "connector") : "",
  ].filter(Boolean);
  const updated = [
    result.updated.nodes.length ? plural(result.updated.nodes.length, "node") : "",
    result.updated.edges.length ? plural(result.updated.edges.length, "connector") : "",
  ].filter(Boolean);
  if (added.length) parts.push(`added ${added.join(" and ")}`);
  if (updated.length) parts.push(`updated ${updated.join(" and ")}`);
  return parts.join(", ") || "made no changes";
}

/**
 * The one place where diagrams are read and changed on the server. REST route
 * handlers and MCP tools are thin adapters over this class, so a human in the
 * browser and an agent over MCP always go through the same rules.
 */
export interface ServiceState {
  /** Tail of the pending-change chain per diagram. */
  locks: Map<Id, Promise<unknown>>;
  listTimer: NodeJS.Timeout | null;
  /** What the review tracker remembers between requests. */
  review: ReviewMemory;
}

export const createServiceState = (): ServiceState => ({ locks: new Map(), listTimer: null, review: createReviewMemory() });

export class DiagramService {
  /** Decides when agent changes become reviewable and moves the review baseline on accept. */
  private readonly review: ReviewTracker;

  constructor(
    private readonly repo: DiagramRepository,
    readonly hub: Hub,
    /** Passed in so it can outlive this instance (see `server/context.ts`). */
    private readonly state: ServiceState = createServiceState(),
  ) {
    // State created before the review feature existed (a hot-reloaded dev server) lacks the field.
    state.review ??= createReviewMemory();
    this.review = new ReviewTracker(repo, hub, state.review);
  }

  private get locks() {
    return this.state.locks;
  }

  /** Serialises changes per diagram so concurrent writers cannot clobber each other. */
  private withLock<T>(id: Id, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch(() => undefined);
    this.locks.set(id, settled);
    void settled.then(() => {
      if (this.locks.get(id) === settled) this.locks.delete(id);
    });
    return run;
  }

  /* --------------------------------------------------------------- reads */

  list(): Promise<DiagramSummary[]> {
    return this.repo.list();
  }

  async get(id: Id): Promise<DiagramDoc> {
    await ensurePacks(); // every render and shape lookup starts from a document, so imported icon packs are registered by now
    const doc = await this.repo.get(id);
    if (!doc) throw notFound(`No diagram with id "${id}". Use diagram_list to see available diagrams.`);
    return doc;
  }

  /* ------------------------------------------------------------- creation */

  async create(input: CreateInput, actor: Actor): Promise<DiagramDoc> {
    const type = (input.type && resolveDiagramType(input.type)) || getDiagramType(input.type ?? "");
    let doc = createDoc({
      id: newDiagramId(),
      name: input.name?.trim() || `Untitled ${sentenceCase(type.name)}`,
      type: type.id,
      description: input.description,
      settings: { routing: type.routing, layout: type.layout },
    });

    if (input.template && type.template) {
      const template = type.template;
      if (template.sequence) {
        doc = applyPatch(doc, buildSequence(template.sequence, { x: 0, y: 0 }, actor).patch).doc;
      } else {
        doc = applyPatch(doc, applySpec(doc, template, { actor, defaultShape: type.defaultShape }).patch).doc;
        if (template.layout === "auto") doc = applyPatch(doc, await computeLayout(doc, type.layout, await loadElk())).doc;
        else doc = { ...doc, settings: { ...doc.settings, autoLayout: false } };
      }
    }
    doc = { ...doc, version: 1 };
    this.repo.save(doc);
    this.hub.log(doc.id, actor, "create", `created “${doc.name}” (${type.name})`);
    this.hub.publishWorkspace({ type: "diagrams" });
    return doc;
  }

  async duplicate(id: Id, actor: Actor): Promise<DiagramDoc> {
    const source = await this.get(id);
    const now = new Date().toISOString();
    const copy: DiagramDoc = { ...source, id: newDiagramId(), name: `${source.name} (copy)`, comments: {}, createdAt: now, updatedAt: now, version: 1 };
    this.repo.save(copy);
    this.hub.log(copy.id, actor, "create", `duplicated “${source.name}”`);
    this.hub.publishWorkspace({ type: "diagrams" });
    return copy;
  }

  async importDiagram(input: { format: "json" | "drawio" | "mermaid"; content: string; name?: string }, actor: Actor): Promise<{ doc: DiagramDoc; warnings: string[] }> {
    const warnings: string[] = [];
    let doc: DiagramDoc;

    if (input.format === "json") {
      let raw: unknown;
      try {
        raw = JSON.parse(input.content);
      } catch {
        throw invalid("The file is not valid JSON.");
      }
      const parsed = docSchema.safeParse(raw);
      if (!parsed.success) throw invalid(`Not a Diagram AI document: ${formatIssues(parsed.error)}`);
      const now = new Date().toISOString();
      doc = { ...(parsed.data as DiagramDoc), id: newDiagramId(), name: input.name?.trim() || parsed.data.name, createdAt: now, updatedAt: now, version: 1 };
    } else if (input.format === "drawio") {
      const imported = await importDrawio(input.content);
      warnings.push(...imported.warnings);
      if (!imported.spec.nodes?.length) throw invalid(warnings[0] ?? "No shapes were found in this draw.io file.");
      doc = createDoc({ name: input.name?.trim() || imported.name || "Imported diagram", type: "blank", settings: { autoLayout: false } });
      const applied = applySpec(doc, imported.spec, { actor, mode: "create" });
      warnings.push(...applied.warnings);
      doc = { ...applyPatch(doc, applied.patch).doc, version: 1 };
    } else {
      const imported = importMermaid(input.content);
      warnings.push(...imported.warnings);
      if (imported.kind === "sequence" && imported.sequence) {
        const type = getDiagramType("uml-sequence");
        doc = createDoc({ name: input.name?.trim() || "Imported sequence diagram", type: type.id, settings: { routing: type.routing, layout: type.layout } });
        const built = buildSequence(imported.sequence, { x: 0, y: 0 }, actor);
        warnings.push(...built.warnings);
        doc = { ...applyPatch(doc, built.patch).doc, version: 1 };
      } else {
        if (!imported.spec.nodes?.length) throw invalid(warnings[0] ?? "No nodes were found in this Mermaid text.");
        const type = getDiagramType("flowchart");
        const layout: LayoutOptions = { ...type.layout, direction: imported.direction ?? type.layout.direction };
        doc = createDoc({ name: input.name?.trim() || "Imported flowchart", type: type.id, settings: { routing: type.routing, layout } });
        const applied = applySpec(doc, imported.spec, { actor, mode: "create", defaultShape: type.defaultShape });
        warnings.push(...applied.warnings);
        doc = applyPatch(doc, applied.patch).doc;
        doc = { ...applyPatch(doc, await computeLayout(doc, layout, await loadElk())).doc, version: 1 };
      }
    }

    this.repo.save(doc);
    this.hub.log(doc.id, actor, "import", `imported “${doc.name}” from ${input.format}`);
    this.hub.publishWorkspace({ type: "diagrams" });
    return { doc, warnings };
  }

  async deleteDiagram(id: Id): Promise<void> {
    await this.get(id);
    await this.withLock(id, async () => {
      await this.repo.delete(id);
      this.review.forget(id);
      this.hub.publish(id, { type: "deleted" });
      this.hub.forget(id);
      this.hub.publishWorkspace({ type: "diagrams" });
    });
  }

  /* -------------------------------------------------------------- changes */

  /** Applies a patch without taking the lock; callers must hold it. */
  private async apply(doc: DiagramDoc, patch: Patch, actor: Actor, options: CommitOptions): Promise<DiagramDoc> {
    const complete = withIntegrity(doc, patch);
    const { doc: changed, changed: didChange } = applyPatch(doc, complete);
    if (!didChange) return doc;
    // The review baseline is taken from the document as it is before an agent's first change.
    await this.review.beforeChange(doc, complete, actor);
    const next: DiagramDoc = { ...changed, version: doc.version + 1, updatedAt: new Date().toISOString() };
    this.repo.save(next);
    // Append-only change log (PostgreSQL only; a no-op for the file repository).
    this.repo.appendOp?.(doc.id, next.version, actor, complete);
    this.hub.publish(doc.id, {
      type: "patch",
      patch: complete,
      version: next.version,
      actor,
      origin: options.origin,
      animate: options.animate ?? "none",
    });
    if (options.log) this.hub.log(doc.id, actor, options.log.action, options.log.summary, options.log.ids);
    const metaChanged = Boolean(patch.doc?.name || patch.doc?.type || patch.doc?.description !== undefined);
    const stats = patchStats(patch);
    if (metaChanged || stats.nodesSet || stats.nodesRemoved || stats.edgesSet || stats.edgesRemoved || stats.commentsSet || stats.commentsRemoved) {
      this.notifyListChanged();
    }
    return next;
  }

  /** The home page only needs to know "something changed", so coalesce bursts. */
  private notifyListChanged() {
    if (this.state.listTimer) return;
    this.state.listTimer = setTimeout(() => {
      this.state.listTimer = null;
      this.hub.publishWorkspace({ type: "diagrams" });
    }, 800);
  }

  commit(id: Id, patch: Patch, actor: Actor, options: CommitOptions = {}): Promise<DiagramDoc> {
    return this.withLock(id, async () => this.apply(await this.get(id), patch, actor, options));
  }

  /** Creates and/or updates elements from a spec, then positions new nodes. */
  applyElements(
    id: Id,
    spec: ElementsSpec,
    options: { actor: Actor; mode: "create" | "update" | "upsert"; layout?: LayoutRequest },
  ): Promise<ApplyElementsResult> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      const type = getDiagramType(doc.type);
      const result = applySpec(doc, spec, {
        actor: options.actor,
        mode: options.mode,
        defaultShape: type.defaultShape,
        preferLibraries: type.libraries,
        defaultEdgeKind: type.edgeKind,
      });
      if (isEmptyPatch(result.patch)) return { doc, result, layout: "none" as const };

      let patch = result.patch;
      let layout: ApplyElementsResult["layout"] = "none";
      const request = options.layout ?? "auto";
      const staged = applyPatch(doc, patch).doc;
      const wasEmpty = Object.keys(doc.nodes).length === 0;

      if (typeof request === "object") {
        patch = mergePatches(patch, await computeLayout(staged, request, await loadElk()));
        layout = "full";
      } else if (request === "auto" && result.unplaced.length) {
        if (wasEmpty || doc.settings.autoLayout) {
          patch = mergePatches(patch, await computeLayout(staged, doc.settings.layout, await loadElk()));
          layout = "full";
        } else {
          patch = mergePatches(patch, placeNear(staged, result.unplaced));
          layout = "incremental";
        }
      }

      const ids = [...result.created.nodes, ...result.created.edges, ...result.updated.nodes, ...result.updated.edges];
      const created = result.created.nodes.length + result.created.edges.length > 0;
      const next = await this.apply(doc, patch, options.actor, {
        animate: created ? "draw" : "layout",
        log: { action: created ? "add" : "update", summary: describeApply(result), ids },
      });
      return { doc: next, result, layout };
    });
  }

  /** Replaces the diagram's content with a generated sequence diagram, or appends it beside existing content. */
  buildSequence(id: Id, spec: SequenceSpec, actor: Actor): Promise<{ doc: DiagramDoc; participantIds: Id[]; warnings: string[] }> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      const bounds = boundsOfNodes(Object.values(doc.nodes));
      const origin: Point = bounds ? { x: bounds.x, y: Math.round(bounds.y + bounds.h + 120) } : { x: 0, y: 0 };
      const built = buildSequence(spec, origin, actor);
      // Generated ids must not collide with what is already on the canvas.
      const clash = (built.patch.nodes?.set ?? []).filter((n) => n.id in doc.nodes).map((n) => n.id);
      if (clash.length) {
        throw invalid(`Participant ids already exist in this diagram: ${clash.join(", ")}. Give participants different ids or delete the old ones first.`);
      }
      const next = await this.apply(doc, mergePatches(built.patch, { doc: { settings: { autoLayout: false } } }), actor, {
        animate: "draw",
        log: {
          action: "add",
          summary: `built a sequence diagram with ${plural(spec.participants.length, "participant")} and ${plural(spec.messages.length, "message")}`,
          ids: built.participantIds,
        },
      });
      return { doc: next, participantIds: built.participantIds, warnings: built.warnings };
    });
  }

  /** Computes a layout without saving it (the browser applies it as an undoable edit). */
  async previewLayout(id: Id, options?: LayoutOptions, ids?: Id[]): Promise<Patch> {
    const doc = await this.get(id);
    return computeLayout(doc, options ?? doc.settings.layout, await loadElk(), ids?.length ? { ids: new Set(ids) } : {});
  }

  layout(id: Id, actor: Actor, options?: LayoutOptions, ids?: Id[]): Promise<DiagramDoc> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      const resolved = options ?? doc.settings.layout;
      const patch = await computeLayout(doc, resolved, await loadElk(), ids?.length ? { ids: new Set(ids) } : {});
      return this.apply(doc, patch, actor, {
        animate: "layout",
        log: { action: "layout", summary: `re-arranged the diagram (${resolved.algorithm}, ${resolved.direction})` },
      });
    });
  }

  remove(id: Id, ids: Id[], actor: Actor, cascade = true): Promise<{ doc: DiagramDoc; removed: Id[]; missing: Id[] }> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      const missing = ids.filter((e) => !(e in doc.nodes) && !(e in doc.edges) && !(e in doc.comments));
      const patch = removalPatch(doc, ids, cascade);
      const removed = [...(patch.nodes?.remove ?? []), ...(patch.edges?.remove ?? []), ...(patch.comments?.remove ?? [])];
      const next = removed.length
        ? await this.apply(doc, patch, actor, { log: { action: "delete", summary: `removed ${plural(removed.length, "element")}` } })
        : doc;
      return { doc: next, removed, missing };
    });
  }

  /* ------------------------------------------------------------- comments */

  addComment(id: Id, input: { text: string; target?: Id; x?: number; y?: number }, actor: Actor): Promise<DComment> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      if (!input.text.trim()) throw invalid("A comment needs some text.");
      let position: Point = { x: input.x ?? 0, y: input.y ?? 0 };
      if (input.target) {
        const node = doc.nodes[input.target];
        if (!node && !(input.target in doc.edges)) throw notFound(`No element "${input.target}" to comment on.`);
        if (node) position = { x: node.x + node.w, y: node.y };
      } else if (input.x === undefined || input.y === undefined) {
        const bounds = boundsOfNodes(Object.values(doc.nodes));
        if (bounds) position = { x: bounds.x + bounds.w + 40, y: bounds.y };
      }
      const comment: DComment = {
        id: newId("comment"),
        ...(input.target ? { target: input.target } : {}),
        ...position,
        author: actor,
        text: input.text.trim(),
        createdAt: new Date().toISOString(),
        replies: [],
      };
      await this.apply(doc, { comments: { set: [comment] } }, actor, {
        log: { action: "comment", summary: `commented: “${comment.text.slice(0, 80)}”`, ids: input.target ? [input.target] : undefined },
      });
      return comment;
    });
  }

  replyToComment(id: Id, commentId: Id, text: string, actor: Actor): Promise<DComment> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      const comment = doc.comments[commentId];
      if (!comment) throw notFound(`No comment "${commentId}". Use diagram_list_comments to see comment ids.`);
      if (!text.trim()) throw invalid("A reply needs some text.");
      const next: DComment = {
        ...comment,
        replies: [...comment.replies, { id: randomId("r"), author: actor, text: text.trim(), createdAt: new Date().toISOString() }],
      };
      await this.apply(doc, { comments: { set: [next] } }, actor, {
        log: { action: "comment", summary: `replied: “${text.trim().slice(0, 80)}”`, ids: comment.target ? [comment.target] : undefined },
      });
      return next;
    });
  }

  resolveComment(id: Id, commentId: Id, resolved: boolean, actor: Actor): Promise<DComment> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      const comment = doc.comments[commentId];
      if (!comment) throw notFound(`No comment "${commentId}". Use diagram_list_comments to see comment ids.`);
      const next: DComment = { ...comment, resolved };
      await this.apply(doc, { comments: { set: [next] } }, actor, {
        log: { action: "comment", summary: `${resolved ? "resolved" : "re-opened"} a comment` },
      });
      return next;
    });
  }

  /* ------------------------------------------------------------ snapshots */

  listSnapshots(id: Id): Promise<SnapshotInfo[]> {
    return this.repo.listSnapshots(id);
  }

  async createSnapshot(id: Id, name: string | undefined, actor: Actor): Promise<SnapshotInfo> {
    const doc = await this.get(id);
    const snapshot = makeSnapshot(randomId("s"), name?.trim() || `Checkpoint ${new Date().toLocaleString("en-GB")}`, actor, doc);
    await this.repo.saveSnapshot(snapshot);
    this.hub.log(id, actor, "snapshot", `saved checkpoint “${snapshot.name}”`);
    return toSnapshotInfo(snapshot);
  }

  /** One checkpoint with its document, e.g. to compare the diagram against it. */
  async getSnapshot(id: Id, snapshotId: Id): Promise<Snapshot> {
    await this.get(id);
    const snapshot = await this.repo.getSnapshot(id, snapshotId);
    if (!snapshot) throw notFound(`No checkpoint "${snapshotId}". Use the snapshot list to see checkpoint ids.`);
    return snapshot;
  }

  restoreSnapshot(id: Id, snapshotId: Id, actor: Actor): Promise<DiagramDoc> {
    return this.withLock(id, async () => {
      const doc = await this.get(id);
      const snapshot = await this.repo.getSnapshot(id, snapshotId);
      if (!snapshot) throw notFound(`No checkpoint "${snapshotId}". Use the snapshot list to see checkpoint ids.`);
      // Keep a way back: checkpoint the current state before overwriting it.
      await this.repo.saveSnapshot(makeSnapshot(randomId("s"), `Before restoring “${snapshot.name}”`, SYSTEM_ACTOR, doc));
      const restored: DiagramDoc = { ...snapshot.doc, id, version: doc.version + 1, updatedAt: new Date().toISOString() };
      await this.review.beforeReplace(doc, actor);
      this.repo.save(restored);
      this.hub.publish(id, { type: "reset", version: restored.version });
      this.hub.log(id, actor, "restore", `restored checkpoint “${snapshot.name}”`);
      this.hub.publishWorkspace({ type: "diagrams" });
      return restored;
    });
  }

  /* --------------------------------------------------------------- review */

  /** Whether agent changes are waiting for review, and the baseline to compare the diagram with. */
  async reviewState(id: Id): Promise<ReviewState> {
    await this.get(id);
    return this.review.read(id);
  }

  /**
   * Marks changes as reviewed: the baseline moves forward to the current state
   * of those elements (all of them when `ids` is omitted). The diagram itself
   * is not touched; rejecting a change is an ordinary edit made by the browser.
   */
  acceptReview(id: Id, ids: Id[] | "all" = "all"): Promise<ReviewState & { accepted: Id[] }> {
    return this.withLock(id, async () => this.review.accept(await this.get(id), ids));
  }

  /** The pending review in terms an agent can act on. */
  async reviewStatus(id: Id): Promise<ReviewStatus> {
    return this.review.status(await this.get(id));
  }

  /* --------------------------------------------------------------- output */

  async export(id: Id, format: ExportFormat, options: ExportOptions = {}): Promise<ExportedFile> {
    return exportDiagram(await this.get(id), format, options);
  }

  /** PNG picture of the diagram (or of some elements) for agents to look at. */
  async preview(id: Id, options: { scale?: number; ids?: Id[] } = {}): Promise<{ png: Uint8Array; width: number; height: number }> {
    const doc = await this.get(id);
    const scope: ExportScope = options.ids?.length ? { kind: "selection", ids: options.ids } : { kind: "all" };
    const page = exportPages(doc, scope)[0];
    // Keep previews small enough for a model to ingest comfortably.
    const longest = Math.max(page.view.w, page.view.h);
    const scale = Math.min(options.scale ?? 1.5, 1600 / longest);
    const png = await pagePng(page, { scale });
    return { png, width: Math.round(page.view.w * scale), height: Math.round(page.view.h * scale) };
  }

  /* ------------------------------------------------------------- presence */

  setPresence(id: Id, presence: Omit<ClientPresence, "at">): void {
    this.hub.setPresence(id, { ...presence, at: new Date().toISOString() });
  }
}
