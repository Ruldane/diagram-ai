import { getDiagramType } from "../catalog";
import { withIntegrity } from "../model/integrity";
import { slugify } from "../model/ids";
import { applyPatch } from "../model/patch";
import { boundsOfNodes } from "../model/queries";
import type { Actor, DEdge, DiagramDoc, DNode, DocMeta, Id, LayoutOptions, Patch, Point } from "../model/types";
import { getShape } from "../shapes/registry";
import { applySpec, type EdgeSpec, type NodeSpec } from "../spec/apply";
import { buildSequence, type SequenceSpec } from "../spec/sequence";
import { exportedFlowIds, mermaidLinkOf, mermaidShapeOf, sameValue } from "./equivalence";
import type { CodeImport, ImportKind } from "./types";

/**
 * Turns parsed diagram text into one patch for the open document.
 *
 * Elements are matched by id, so what the text still names keeps its
 * position, size and styling; only what the text says is changed. Positions
 * for new elements are not decided here (layout is asynchronous): the plan
 * says which strategy applies and `placePlan` in `layout.ts` carries it out.
 */

export type CodeApplyMode = "replace" | "insert";

export interface CodePlanOptions {
  actor?: Actor;
  /**
   * Replace only: ids of the elements the code created earlier. When given,
   * elements outside this set are never removed (live editing must not eat
   * what was drawn by hand). Omit it to replace the whole diagram.
   */
  managed?: ReadonlySet<Id>;
}

export type Placement =
  /** Nothing needs a position. */
  | { strategy: "none" }
  /** Lay out the whole document; `anchor` moves the result to where the old content started. */
  | { strategy: "full"; layout: LayoutOptions; anchor?: Point }
  /** Lay out `ids` among themselves, where the importer dropped them. */
  | { strategy: "cluster"; ids: Id[]; layout: LayoutOptions }
  /** Put `ids` beside the elements they connect to; unconnected groups are laid out as a cluster. */
  | { strategy: "near"; ids: Id[]; layout: LayoutOptions };

export interface CodePlan {
  patch: Patch;
  /** The document after `patch`, new elements at provisional positions. */
  staged: DiagramDoc;
  /** Problems met while building the patch (the importer's own warnings are separate). */
  warnings: string[];
  created: { nodes: Id[]; edges: Id[] };
  updated: { nodes: Id[]; edges: Id[] };
  removed: { nodes: Id[]; edges: Id[] };
  /** Every node the code now describes: new, changed and untouched. */
  owned: Id[];
  placement: Placement;
}

const NEXT_TO_CONTENT = 80;

const SUGGESTED_TYPE: Partial<Record<ImportKind, string>> = {
  flowchart: "flowchart",
  sequence: "uml-sequence",
  class: "uml-class",
  usecase: "uml-use-case",
  activity: "uml-activity",
  component: "uml-component",
};

/** The diagram type the text suggests (used when it lands on an empty canvas). */
export function suggestedDiagramType(kind: ImportKind): string | undefined {
  return SUGGESTED_TYPE[kind];
}

const pairKey = (from: string | undefined, to: string | undefined): string => `${from ?? ""}\u0000${to ?? ""}`;

function noopPlan(doc: DiagramDoc): CodePlan {
  return {
    patch: {},
    staged: doc,
    warnings: [],
    created: { nodes: [], edges: [] },
    updated: { nodes: [], edges: [] },
    removed: { nodes: [], edges: [] },
    owned: [],
    placement: { strategy: "none" },
  };
}

/* ----------------------------------------------------------------- matching */

/**
 * Which node of the document each element of the text stands for: the node
 * with the same id, or the node whose `exportMermaid` id it is. Elements
 * absent from the map are new.
 */
export function matchCodeIds(doc: DiagramDoc, imported: Pick<CodeImport, "kind" | "spec" | "sequence">): Map<string, Id> {
  const out = new Map<string, Id>();
  if (imported.kind === "sequence" && imported.sequence) {
    for (const participant of imported.sequence.participants) {
      const key = participant.id ?? participant.name;
      const id = slugify(key);
      if (id in doc.nodes) out.set(key, id);
    }
    return out;
  }
  const codeIds = (imported.spec.nodes ?? []).map((node) => node.id).filter((id): id is string => Boolean(id));
  const used = new Set<Id>();
  for (const id of codeIds) {
    if (id in doc.nodes) {
      out.set(id, id);
      used.add(id);
    }
  }
  if (imported.kind === "flowchart") {
    const exported = exportedFlowIds(doc);
    for (const id of codeIds) {
      const docId = exported.get(id);
      if (!out.has(id) && docId && !used.has(docId)) {
        out.set(id, docId);
        used.add(docId);
      }
    }
  }
  return out;
}

function edgesByPair(doc: DiagramDoc): Map<string, DEdge[]> {
  const out = new Map<string, DEdge[]>();
  for (const edge of Object.values(doc.edges)) {
    if (!edge.from.node || !edge.to.node) continue;
    const key = pairKey(edge.from.node, edge.to.node);
    out.set(key, [...(out.get(key) ?? []), edge]);
  }
  return out;
}

/** Edge fields the text decides; everything else on a matched connector (colour, route, notes) stays. */
function withoutCodeFields(edge: DEdge, keepStyle: boolean): DEdge {
  const out: DEdge = { ...edge };
  delete out.text;
  delete out.startText;
  delete out.endText;
  if (!keepStyle && edge.style) {
    const style = { ...edge.style };
    delete style.startMarker;
    delete style.endMarker;
    delete style.dash;
    delete style.strokeWidth;
    if (Object.keys(style).length) out.style = style;
    else delete out.style;
  }
  return out;
}

/* ------------------------------------------------------------- the planner */

/**
 * Plans how `imported` changes `doc`.
 *
 * - `replace`: the diagram becomes what the text says. Elements are matched
 *   by id (and, for connectors, by their end points); matched ones keep
 *   position, size and style; vanished ones are removed.
 * - `insert`: the text is added beside the existing content under fresh ids.
 *
 * The result is a single patch, so applying it is one undo step.
 */
export function planCodeApply(doc: DiagramDoc, imported: CodeImport, mode: CodeApplyMode, options: CodePlanOptions = {}): CodePlan {
  if (imported.kind === "sequence" && imported.sequence) return planSequence(doc, imported.sequence, mode, options);
  return planElements(doc, imported, mode, options);
}

function planElements(doc: DiagramDoc, imported: CodeImport, mode: CodeApplyMode, options: CodePlanOptions): CodePlan {
  const replace = mode === "replace";
  const specNodes = imported.spec.nodes ?? [];
  const specEdges = imported.spec.edges ?? [];
  if (!specNodes.length) return noopPlan(doc);

  const content = boundsOfNodes(Object.values(doc.nodes));
  const wasEmpty = !content;
  const adopt = replace && wasEmpty ? SUGGESTED_TYPE[imported.kind] : undefined;
  const type = getDiagramType(adopt ?? doc.type);

  /* Settings: an empty canvas takes the type's routing and layout; an explicit direction wins. */
  let meta: DocMeta | undefined;
  let relayout = false;
  if (adopt && adopt !== doc.type) {
    meta = {
      type: adopt,
      settings: { routing: type.routing, layout: { ...type.layout, direction: imported.direction ?? type.layout.direction } },
    };
  } else if (replace && imported.direction && imported.direction !== doc.settings.layout.direction) {
    meta = { settings: { layout: { ...doc.settings.layout, direction: imported.direction } } };
    relayout = !wasEmpty;
  }
  const settings = meta?.settings ? { ...doc.settings, ...meta.settings } : doc.settings;

  /* Ids: what each element of the text is called in the document. */
  const codeIds = specNodes.map((node, index) => node.id ?? `element-${index + 1}`);
  const targets = new Map<string, Id>();
  if (replace) {
    const matched = matchCodeIds(doc, { kind: imported.kind, spec: imported.spec });
    codeIds.forEach((codeId, index) => {
      const sourceId = specNodes[index].id;
      targets.set(codeId, (sourceId !== undefined ? matched.get(sourceId) : undefined) ?? codeId);
    });
  } else {
    const taken = new Set<Id>([...Object.keys(doc.nodes), ...Object.keys(doc.edges), ...Object.keys(doc.comments)]);
    const spoken = new Set(codeIds);
    for (const codeId of codeIds) {
      let id = codeId;
      for (let i = 2; taken.has(id); i++) id = `${codeId}-${i}`;
      while (spoken.has(id) && id !== codeId) id = `${id}-x`;
      taken.add(id);
      targets.set(codeId, id);
    }
  }
  const owned = new Set<Id>(targets.values());
  const matchedNodes = new Set<Id>([...owned].filter((id) => replace && id in doc.nodes));

  /* Connectors: matched by end points, in order of appearance. */
  const existingEdges = replace ? edgesByPair(doc) : new Map<string, DEdge[]>();
  const seen = new Map<string, number>();
  const matchedEdges = new Map<Id, EdgeSpec>();
  const edgeSpecs: EdgeSpec[] = specEdges.map((edge) => {
    const from = edge.from !== undefined ? (targets.get(edge.from) ?? edge.from) : undefined;
    const to = edge.to !== undefined ? (targets.get(edge.to) ?? edge.to) : undefined;
    const key = pairKey(from, to);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const match = existingEdges.get(key)?.[occurrence];
    if (match) matchedEdges.set(match.id, edge);
    return { ...edge, from, to, ...(match ? { id: match.id } : {}) };
  });

  /* What the text no longer mentions. */
  const vanishedNodes = replace ? Object.keys(doc.nodes).filter((id) => !owned.has(id) && (!options.managed || options.managed.has(id))) : [];
  const vanishedSet = new Set(vanishedNodes);
  const codeNodes = options.managed ? new Set<Id>([...options.managed, ...owned]) : null;
  const vanishedEdges = replace
    ? Object.values(doc.edges)
        .filter((edge) => {
          if (matchedEdges.has(edge.id)) return false;
          const from = edge.from.node;
          const to = edge.to.node;
          if ((from && vanishedSet.has(from)) || (to && vanishedSet.has(to))) return true;
          if (!codeNodes) return true;
          return Boolean(from && to && codeNodes.has(from) && codeNodes.has(to));
        })
        .map((edge) => edge.id)
    : [];

  /* The document the specs are applied to: vanished elements gone, matched connectors cleared of what the text decides. */
  let base: DiagramDoc = { ...doc, type: meta?.type ?? doc.type, settings };
  base = applyPatch(base, withIntegrity(base, { nodes: { remove: vanishedNodes }, edges: { remove: vanishedEdges } })).doc;
  const edgeEdits: Record<Id, DEdge> = {};
  const keepStyle = new Set<Id>();
  for (const [id, source] of matchedEdges) {
    const current = base.edges[id];
    if (!current) continue;
    // A connector that already reads the same in text keeps its exact style (custom markers survive).
    const sameInText = imported.kind === "flowchart" && sameValue(mermaidLinkOf(current.style), { ...(source.kind ? { kind: source.kind } : {}), ...(source.style ? { style: source.style } : {}) });
    if (sameInText) keepStyle.add(id);
    edgeEdits[id] = withoutCodeFields(current, sameInText);
  }
  if (Object.keys(edgeEdits).length) base = { ...base, edges: { ...base.edges, ...edgeEdits } };

  const nodeSpecs: NodeSpec[] = specNodes.map((node, index) => {
    const id = targets.get(codeIds[index])!;
    const current = replace ? doc.nodes[id] : undefined;
    const spec: NodeSpec = { ...node, id };
    if (node.parent) spec.parent = targets.get(node.parent) ?? node.parent;
    if (current) {
      const keepsShape =
        imported.kind === "flowchart" &&
        node.shape !== undefined &&
        node.shape !== current.shape &&
        (mermaidShapeOf(current.shape) === node.shape || (getShape(current.shape).container && node.shape === "basic/group"));
      if (keepsShape) delete spec.shape;
      // A node the text no longer puts in a group leaves it, but one a person put in their own frame stays there.
      if (!node.parent && current.parent && owned.has(current.parent)) spec.parent = null;
    }
    return spec;
  });
  const edgeSpecsFinal: EdgeSpec[] = edgeSpecs.map((edge) => {
    if (!edge.id || !keepStyle.has(edge.id)) return edge;
    const kept: EdgeSpec = { ...edge };
    delete kept.kind;
    delete kept.style;
    return kept;
  });

  const result = applySpec(base, { nodes: nodeSpecs, edges: edgeSpecsFinal }, {
    actor: options.actor,
    mode: "upsert",
    defaultShape: type.defaultShape,
    preferLibraries: type.libraries,
  });

  /* Only what actually differs goes into the patch, so a no-op edit is not an undo step. */
  const nodeSet = (result.patch.nodes?.set ?? []).filter((node) => !sameValue(doc.nodes[node.id], node));
  const edgeSet = (result.patch.edges?.set ?? []).filter((edge) => !sameValue(doc.edges[edge.id], edge));
  const nodeRemove = vanishedNodes;
  const edgeRemove = vanishedEdges;

  let patch: Patch = {
    ...(nodeSet.length || nodeRemove.length
      ? { nodes: { ...(nodeSet.length ? { set: nodeSet } : {}), ...(nodeRemove.length ? { remove: nodeRemove } : {}) } }
      : {}),
    ...(edgeSet.length || edgeRemove.length
      ? { edges: { ...(edgeSet.length ? { set: edgeSet } : {}), ...(edgeRemove.length ? { remove: edgeRemove } : {}) } }
      : {}),
    ...(meta ? { doc: meta } : {}),
  };
  patch = withIntegrity(doc, patch);
  const staged = applyPatch(doc, patch).doc;

  /* Where the new nodes go. */
  const layout: LayoutOptions = { ...staged.settings.layout, direction: imported.direction ?? staged.settings.layout.direction };
  const created = nodeSet.filter((node) => !(node.id in doc.nodes)).map((node) => node.id);
  const createdSet = new Set(created);
  const unplaced = result.unplaced.filter((id) => createdSet.has(id));
  // Ids as they ended up (a new node may have been renamed to stay clear of a connector id).
  const ownedNow = new Set<Id>([...matchedNodes, ...created]);
  let placement: Placement = { strategy: "none" };
  if (unplaced.length || relayout) {
    if (!replace) placement = { strategy: "cluster", ids: unplaced, layout };
    else if (matchedNodes.size === 0 || relayout) {
      const foreign = Object.keys(staged.nodes).some((id) => !ownedNow.has(id));
      placement = foreign
        ? { strategy: "cluster", ids: [...ownedNow], layout }
        : { strategy: "full", layout, ...(content ? { anchor: { x: content.x, y: content.y } } : {}) };
    } else placement = { strategy: "near", ids: unplaced, layout };
  }

  return {
    patch,
    staged,
    warnings: result.warnings,
    created: { nodes: created, edges: edgeSet.filter((edge) => !(edge.id in doc.edges)).map((edge) => edge.id) },
    updated: {
      nodes: nodeSet.filter((node) => node.id in doc.nodes).map((node) => node.id),
      edges: edgeSet.filter((edge) => edge.id in doc.edges).map((edge) => edge.id),
    },
    removed: { nodes: patch.nodes?.remove ?? [], edges: patch.edges?.remove ?? [] },
    owned: [...ownedNow],
    placement,
  };
}

/* ---------------------------------------------------------------- sequence */

function planSequence(doc: DiagramDoc, sequence: SequenceSpec, mode: CodeApplyMode, options: CodePlanOptions): CodePlan {
  if (!sequence.participants.length) return noopPlan(doc);
  const replace = mode === "replace";
  const everything = Object.values(doc.nodes);
  const content = boundsOfNodes(everything);
  const adopt = replace && !content ? "uml-sequence" : undefined;
  const type = getDiagramType(adopt ?? doc.type);

  // Sequences are built row by row, so they are never "auto layout": agents must not re-flow them.
  const meta: DocMeta = {
    ...(adopt && adopt !== doc.type ? { type: adopt } : {}),
    settings: { autoLayout: false, ...(adopt && adopt !== doc.type ? { routing: type.routing, layout: type.layout } : {}) },
  };

  const vanishedNodes = replace ? everything.filter((node) => !options.managed || options.managed.has(node.id)).map((node) => node.id) : [];
  const vanishedSet = new Set(vanishedNodes);
  const remaining = everything.filter((node) => !vanishedSet.has(node.id));
  const vanishedEdges = replace
    ? Object.values(doc.edges).filter((edge) => {
        const from = edge.from.node;
        const to = edge.to.node;
        if ((from && vanishedSet.has(from)) || (to && vanishedSet.has(to))) return true;
        return !options.managed;
      })
    : [];

  // Participant ids must not collide with anything that stays on the canvas.
  const taken = new Set<Id>([...remaining.map((node) => node.id), ...Object.keys(doc.edges), ...Object.keys(doc.comments)]);
  const renamed = new Map<string, Id>();
  const participants = sequence.participants.map((participant) => {
    const key = participant.id ?? participant.name;
    const base = slugify(key) || "participant";
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    renamed.set(key, id);
    if (!renamed.has(participant.name)) renamed.set(participant.name, id);
    return { ...participant, id };
  });
  const messages = sequence.messages.map((message) => ({ ...message, from: renamed.get(message.from) ?? message.from, to: renamed.get(message.to) ?? message.to }));

  const remainingBounds = boundsOfNodes(remaining);
  const origin: Point = remainingBounds
    ? { x: remainingBounds.x + remainingBounds.w + NEXT_TO_CONTENT, y: remainingBounds.y }
    : { x: content?.x ?? 0, y: content?.y ?? 0 };
  const built = buildSequence({ participants, messages }, origin, options.actor);

  // Lifelines that keep their id keep what a person gave them: colours, notes, links.
  const builtNodes: DNode[] = (built.patch.nodes?.set ?? []).map((node) => {
    const previous = doc.nodes[node.id];
    if (!previous) return node;
    return {
      ...node,
      createdBy: previous.createdBy,
      ...(previous.style ? { style: { ...node.style, ...previous.style } } : {}),
      ...(previous.note ? { note: previous.note } : {}),
      ...(previous.link ? { link: previous.link } : {}),
      ...(previous.locked ? { locked: previous.locked } : {}),
    };
  });

  // Messages keep the id of the connector between the same two lifelines at the same position in the list.
  const previousEdges = new Map<string, DEdge[]>();
  for (const edge of vanishedEdges) {
    if (!edge.from.node || !edge.to.node) continue;
    const key = pairKey(edge.from.node, edge.to.node);
    previousEdges.set(key, [...(previousEdges.get(key) ?? []), edge]);
  }
  const seen = new Map<string, number>();
  const reused = new Set<Id>();
  const builtEdges: DEdge[] = (built.patch.edges?.set ?? []).map((edge) => {
    const key = pairKey(edge.from.node, edge.to.node);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const previous = previousEdges.get(key)?.[occurrence];
    if (!previous) return edge;
    reused.add(previous.id);
    return {
      ...edge,
      id: previous.id,
      createdBy: previous.createdBy,
      ...(previous.note ? { note: previous.note } : {}),
      style: { ...previous.style, ...edge.style },
    };
  });

  const builtIds = new Set(builtNodes.map((node) => node.id));
  const nodeSet = builtNodes.filter((node) => !sameValue(doc.nodes[node.id], node));
  const edgeSet = builtEdges.filter((edge) => !sameValue(doc.edges[edge.id], edge));
  const nodeRemove = vanishedNodes.filter((id) => !builtIds.has(id));
  const edgeRemove = vanishedEdges.map((edge) => edge.id).filter((id) => !reused.has(id));

  let patch: Patch = {
    ...(nodeSet.length || nodeRemove.length
      ? { nodes: { ...(nodeSet.length ? { set: nodeSet } : {}), ...(nodeRemove.length ? { remove: nodeRemove } : {}) } }
      : {}),
    ...(edgeSet.length || edgeRemove.length
      ? { edges: { ...(edgeSet.length ? { set: edgeSet } : {}), ...(edgeRemove.length ? { remove: edgeRemove } : {}) } }
      : {}),
  };
  const hasContentChange = Boolean(patch.nodes || patch.edges);
  // Settings are only written when something else changes, so an unchanged text stays a no-op.
  if (hasContentChange) patch = { ...patch, doc: meta };
  patch = withIntegrity(doc, patch);

  return {
    patch,
    staged: applyPatch(doc, patch).doc,
    warnings: built.warnings,
    created: { nodes: nodeSet.filter((node) => !(node.id in doc.nodes)).map((node) => node.id), edges: edgeSet.filter((edge) => !(edge.id in doc.edges)).map((edge) => edge.id) },
    updated: { nodes: nodeSet.filter((node) => node.id in doc.nodes).map((node) => node.id), edges: edgeSet.filter((edge) => edge.id in doc.edges).map((edge) => edge.id) },
    removed: { nodes: patch.nodes?.remove ?? [], edges: patch.edges?.remove ?? [] },
    owned: [...builtIds],
    placement: { strategy: "none" },
  };
}
