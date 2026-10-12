"use client";

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { contains, intersects, rectFromPoints, union } from "@/core/geometry/basics";
import { descendantsOf, isDescendant, nodeBounds } from "@/core/model/queries";
import type { DEdge, DiagramDoc, DNode, Id, Point, Rect } from "@/core/model/types";
import { getShape, usesText } from "@/core/shapes/registry";

import { addConnectedNode, createEdge, createNode, defaultShape, newEdge, type Direction } from "../actions/elements";
import { useEditorStore } from "../store/context";
import type { EditorStore, Viewport } from "../store/editor-store";
import { resizeNode, snapMove, type ResizeHandle } from "./snapping";

const DRAG_THRESHOLD = 4;
const SNAP_PIXELS = 6;

type Drag =
  | { kind: "pan"; start: Point; viewport: Viewport }
  | { kind: "marquee"; start: Point; base: Id[] }
  | {
      kind: "move";
      start: Point;
      started: boolean;
      clicked: Id;
      wasSelected: boolean;
      origins: Map<Id, Point>;
      waypoints: Map<Id, Point[]>;
      bounds: Rect;
      others: Rect[];
    }
  | { kind: "resize"; node: DNode; handle: ResizeHandle }
  | { kind: "rotate"; node: DNode }
  | { kind: "connect"; from: Id; start: Point; moved: boolean; side?: Direction }
  | { kind: "reattach"; edge: DEdge; end: "from" | "to" }
  | { kind: "draw"; shape: string; start: Point };

function elementIdAt(clientX: number, clientY: number): Id | null {
  const target = document.elementFromPoint(clientX, clientY);
  return target?.closest("[data-id]")?.getAttribute("data-id") ?? null;
}

/** Innermost container under a point, ignoring the nodes being moved. */
function containerAt(doc: DiagramDoc, point: Point, exclude: Set<Id>): DNode | null {
  let best: DNode | null = null;
  for (const node of Object.values(doc.nodes)) {
    if (exclude.has(node.id) || !getShape(node.shape).container) continue;
    const box = nodeBounds(node);
    if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
    if (!best || box.w * box.h < best.w * best.h) best = node;
  }
  return best;
}

/** Moves nodes into (or out of) the container they were dropped on. */
function reparentOnDrop(store: EditorStore, roots: Id[]) {
  const { doc } = store.getState();
  if (!doc) return;
  const moving = new Set<Id>(roots);
  for (const child of descendantsOf(doc.nodes, roots)) moving.add(child.id);
  const changed: DNode[] = [];
  for (const id of roots) {
    const node = doc.nodes[id];
    if (!node) continue;
    // A child dragged together with its parent keeps that parent.
    if (node.parent && moving.has(node.parent)) continue;
    const box = nodeBounds(node);
    const target = containerAt(doc, { x: box.x + box.w / 2, y: box.y + box.h / 2 }, moving);
    if ((target?.id ?? undefined) === node.parent) continue;
    if (target && isDescendant(doc.nodes, target.id, node.id)) continue;
    const next = { ...node };
    if (target) next.parent = target.id;
    else delete next.parent;
    changed.push(next);
  }
  if (changed.length) store.getState().applyTransient({ nodes: { set: changed } });
}

/**
 * Pointer interactions of the canvas: pan, select, marquee, move with smart
 * guides, resize, rotate, connect, re-attach connectors and draw shapes.
 * State of the current drag lives in a ref so pointer moves never re-render.
 */
export function useInteractions(containerRef: RefObject<HTMLDivElement | null>) {
  const store = useEditorStore();
  const drag = useRef<Drag | null>(null);

  const screenPoint = (event: { clientX: number; clientY: number }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (event: { clientX: number; clientY: number }): Point => store.getState().toWorld(screenPoint(event));

  /* -------------------------------------------------------------- wheel */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = store.getState();
      if (event.ctrlKey || event.metaKey) {
        // Trackpad pinches arrive as small ctrl+wheel deltas; mouse wheels as large ones.
        const factor = Math.exp(-event.deltaY * (Math.abs(event.deltaY) < 50 ? 0.012 : 0.0022));
        state.zoomAt(screenPoint(event), factor);
      } else {
        const { viewport } = state;
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        state.setViewport({ ...viewport, x: viewport.x - dx, y: viewport.y - dy });
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and the store are stable
  }, [store]);

  /* ------------------------------------------------------- move helpers */

  function startMove(doc: DiagramDoc, clicked: Id, wasSelected: boolean, start: Point): Drag | null {
    const { selection } = store.getState();
    const roots = selection.filter((id) => doc.nodes[id] && !doc.nodes[id].locked);
    if (!roots.includes(clicked)) return null;
    const moving = new Map<Id, DNode>();
    for (const id of roots) moving.set(id, doc.nodes[id]);
    for (const child of descendantsOf(doc.nodes, roots)) moving.set(child.id, child);

    const origins = new Map<Id, Point>();
    for (const node of moving.values()) origins.set(node.id, { x: node.x, y: node.y });
    const waypoints = new Map<Id, Point[]>();
    for (const edge of Object.values(doc.edges)) {
      if (!edge.waypoints?.length) continue;
      const a = edge.from.node ? moving.has(edge.from.node) : false;
      const b = edge.to.node ? moving.has(edge.to.node) : false;
      if (a && b) waypoints.set(edge.id, edge.waypoints);
    }
    const bounds = union(roots.map((id) => nodeBounds(doc.nodes[id])))!;
    const others = Object.values(doc.nodes)
      .filter((node) => !moving.has(node.id))
      .map(nodeBounds);
    return { kind: "move", start, started: false, clicked, wasSelected, origins, waypoints, bounds, others };
  }

  function applyMove(current: Extract<Drag, { kind: "move" }>, pointer: Point, freeform: boolean) {
    const state = store.getState();
    const doc = state.doc!;
    let dx = pointer.x - current.start.x;
    let dy = pointer.y - current.start.y;
    let guides: ReturnType<typeof snapMove>["guides"] = [];
    if (!freeform) {
      const tentative = { ...current.bounds, x: current.bounds.x + dx, y: current.bounds.y + dy };
      const snapped = snapMove(tentative, current.others, SNAP_PIXELS / state.viewport.zoom, doc.settings.snap ? doc.settings.gridSize : 0);
      dx += snapped.dx;
      dy += snapped.dy;
      guides = snapped.guides;
    }
    const nodes: DNode[] = [];
    for (const [id, origin] of current.origins) {
      const node = doc.nodes[id];
      if (node) nodes.push({ ...node, x: origin.x + dx, y: origin.y + dy });
    }
    const edges: DEdge[] = [];
    for (const [id, points] of current.waypoints) {
      const edge = doc.edges[id];
      if (edge) edges.push({ ...edge, waypoints: points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
    }
    state.applyTransient({ nodes: { set: nodes }, ...(edges.length ? { edges: { set: edges } } : {}) });
    store.setState({ overlay: { guides } });
  }

  /** Layout-computed routes stop making sense once one end moves: let those edges re-route. */
  function releaseRoutes(doc: DiagramDoc, moving: Set<Id>, inside: Set<Id>) {
    const edges: DEdge[] = [];
    for (const edge of Object.values(doc.edges)) {
      if (!edge.autoRoute || inside.has(edge.id)) continue;
      const touches = (edge.from.node && moving.has(edge.from.node)) || (edge.to.node && moving.has(edge.to.node));
      if (!touches) continue;
      const next: DEdge = { ...edge, from: { node: edge.from.node, point: edge.from.point }, to: { node: edge.to.node, point: edge.to.point } };
      delete next.waypoints;
      delete next.autoRoute;
      if (!next.from.point) delete next.from.point;
      if (!next.to.point) delete next.to.point;
      edges.push(next);
    }
    if (edges.length) store.getState().applyTransient({ edges: { set: edges } });
  }

  /* ------------------------------------------------------------ handlers */

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const state = store.getState();
    const doc = state.doc;
    if (!doc) return;
    const element = containerRef.current!;
    const screen = screenPoint(event);
    const world = state.toWorld(screen);
    const target = event.target as Element;
    // Clicks inside HTML overlays (text editor, comment pins) are theirs to handle.
    if (target.closest("[data-canvas-ui]")) return;

    const capture = () => element.setPointerCapture(event.pointerId);

    if (event.button === 1 || (event.button === 0 && (state.tool === "pan" || state.spaceHeld))) {
      drag.current = { kind: "pan", start: screen, viewport: state.viewport };
      capture();
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;

    const handle = target.closest("[data-handle]");
    const port = target.closest("[data-port]");
    const id = target.closest("[data-id]")?.getAttribute("data-id") ?? null;

    if (state.tool === "shape" && state.toolShape) {
      drag.current = { kind: "draw", shape: state.toolShape, start: world };
      capture();
      return;
    }
    if (state.tool === "text") {
      createNode(store, "basic/text", { at: world, text: "", edit: true });
      state.setTool("select");
      return;
    }
    if (state.tool === "comment") {
      store.setState({ draftComment: { x: world.x, y: world.y, target: id && doc.nodes[id] ? id : undefined }, panel: "comments" });
      return;
    }
    if (state.tool === "connect") {
      if (id && doc.nodes[id]) {
        drag.current = { kind: "connect", from: id, start: screen, moved: false };
        capture();
      }
      return;
    }

    if (handle) {
      const kind = handle.getAttribute("data-handle")!;
      const forId = handle.getAttribute("data-for")!;
      if (kind === "edge-from" || kind === "edge-to") {
        const edge = doc.edges[forId];
        if (!edge) return;
        state.beginGesture();
        drag.current = { kind: "reattach", edge, end: kind === "edge-from" ? "from" : "to" };
      } else {
        const node = doc.nodes[forId];
        if (!node) return;
        state.beginGesture();
        drag.current = kind === "rotate" ? { kind: "rotate", node } : { kind: "resize", node, handle: kind as ResizeHandle };
      }
      capture();
      return;
    }

    if (port) {
      drag.current = {
        kind: "connect",
        from: port.getAttribute("data-for")!,
        start: screen,
        moved: false,
        side: port.getAttribute("data-port") as Direction,
      };
      capture();
      return;
    }

    if (id && (doc.nodes[id] || doc.edges[id])) {
      const wasSelected = state.selection.includes(id);
      if (event.shiftKey) {
        state.select([id], true);
        return;
      }
      if (!wasSelected) state.select([id]);
      if (doc.nodes[id]) {
        drag.current = startMove(doc, id, wasSelected, world);
        if (drag.current) capture();
      }
      return;
    }

    if (!event.shiftKey) state.select([]);
    drag.current = { kind: "marquee", start: world, base: event.shiftKey ? state.selection : [] };
    capture();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = store.getState();
    const doc = state.doc;
    const current = drag.current;
    if (!doc) return;

    if (!current) {
      // Hover feedback (connection ports) for the select and connect tools.
      if (state.tool !== "select" && state.tool !== "connect") return;
      const target = event.target as Element;
      if (target.closest("[data-port]")) return;
      const id = target.closest("[data-id]")?.getAttribute("data-id") ?? null;
      const hovered = id && doc.nodes[id] ? id : null;
      if (hovered !== state.hovered) store.setState({ hovered });
      return;
    }

    const screen = screenPoint(event);
    const world = state.toWorld(screen);

    switch (current.kind) {
      case "pan":
        state.setViewport({ ...current.viewport, x: current.viewport.x + screen.x - current.start.x, y: current.viewport.y + screen.y - current.start.y });
        break;

      case "marquee": {
        const rect = rectFromPoints(current.start, world);
        const hit = new Set(current.base);
        for (const node of Object.values(doc.nodes)) {
          const box = nodeBounds(node);
          // Containers are only picked when fully enclosed, so dragging inside a frame selects its content.
          if (getShape(node.shape).container ? contains(rect, box) : intersects(rect, box)) hit.add(node.id);
        }
        for (const edge of Object.values(doc.edges)) {
          if (edge.from.node && edge.to.node && hit.has(edge.from.node) && hit.has(edge.to.node)) hit.add(edge.id);
        }
        store.setState({ overlay: { marquee: rect }, selection: [...hit] });
        break;
      }

      case "move": {
        if (!current.started) {
          const startScreen = state.toScreen(current.start);
          if (Math.hypot(screen.x - startScreen.x, screen.y - startScreen.y) < DRAG_THRESHOLD) break;
          current.started = true;
          state.beginGesture();
          releaseRoutes(doc, new Set(current.origins.keys()), new Set(current.waypoints.keys()));
          store.setState({ hovered: null });
        }
        applyMove(current, world, event.altKey);
        break;
      }

      case "resize": {
        const def = getShape(current.node.shape);
        const rect = resizeNode(current.node, current.handle, world, {
          min: def.minSize ?? { w: 20, h: 20 },
          keepAspect: Boolean(def.keepAspect) || event.shiftKey,
          grid: doc.settings.snap && !event.altKey ? doc.settings.gridSize : 0,
        });
        const live = doc.nodes[current.node.id];
        if (live) state.applyTransient({ nodes: { set: [{ ...live, ...rect }] } });
        break;
      }

      case "rotate": {
        const { node } = current;
        const cx = node.x + node.w / 2;
        const cy = node.y + node.h / 2;
        let angle = (Math.atan2(world.y - cy, world.x - cx) * 180) / Math.PI + 90;
        // Snap to 15° steps unless Alt is held.
        if (!event.altKey) angle = Math.round(angle / 15) * 15;
        angle = ((angle % 360) + 360) % 360;
        const live = doc.nodes[node.id];
        if (live) {
          const next = { ...live, rotation: angle };
          if (!angle) delete (next as Partial<DNode>).rotation;
          state.applyTransient({ nodes: { set: [next] } });
        }
        break;
      }

      case "connect": {
        if (!current.moved && Math.hypot(screen.x - current.start.x, screen.y - current.start.y) < DRAG_THRESHOLD) break;
        current.moved = true;
        const under = elementIdAt(event.clientX, event.clientY);
        const targetId = under && doc.nodes[under] && under !== current.from ? under : undefined;
        store.setState({ overlay: { connect: { from: current.from, to: world, target: targetId } } });
        break;
      }

      case "reattach": {
        const under = elementIdAt(event.clientX, event.clientY);
        const other = current.end === "from" ? current.edge.to.node : current.edge.from.node;
        const targetId = under && doc.nodes[under] && under !== other ? under : undefined;
        const live = doc.edges[current.edge.id];
        if (!live) break;
        const end = targetId ? { node: targetId } : { point: { x: Math.round(world.x), y: Math.round(world.y) } };
        const next: DEdge = { ...live, [current.end]: end };
        delete next.waypoints;
        delete next.autoRoute;
        state.applyTransient({ edges: { set: [next] } });
        break;
      }

      case "draw":
        store.setState({ overlay: { draft: rectFromPoints(current.start, world) } });
        break;
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    drag.current = null;
    const state = store.getState();
    const doc = state.doc;
    if (containerRef.current?.hasPointerCapture(event.pointerId)) containerRef.current.releasePointerCapture(event.pointerId);
    if (!current || !doc) return;
    const world = worldPoint(event);

    switch (current.kind) {
      case "marquee":
        store.setState({ overlay: {} });
        break;

      case "move":
        if (!current.started) {
          // A plain click on one of several selected nodes narrows the selection to it.
          if (current.wasSelected && state.selection.length > 1) state.select([current.clicked]);
          break;
        }
        reparentOnDrop(store, state.selection.filter((id) => current.origins.has(id)));
        state.applyTransient({ doc: { settings: { autoLayout: false } } });
        state.endGesture();
        break;

      case "resize":
      case "rotate":
      case "reattach":
        state.endGesture();
        break;

      case "connect": {
        store.setState({ overlay: {} });
        if (!current.moved) {
          if (current.side) addConnectedNode(store, current.from, current.side);
          break;
        }
        const under = elementIdAt(event.clientX, event.clientY);
        if (under && doc.nodes[under] && under !== current.from) {
          createEdge(store, current.from, under);
        } else if (!under) {
          // Dropped on empty canvas: create the next node right there.
          const source = doc.nodes[current.from];
          const def = source ? getShape(source.shape) : null;
          const shapeId = !def || def.container || def.keepAspect ? defaultShape(doc) : def.id;
          state.beginGesture();
          const node = createNode(store, shapeId, { at: world, text: "", edit: true });
          const fresh = store.getState().doc;
          if (node && fresh) store.getState().applyTransient({ edges: { set: [newEdge(fresh, { node: current.from }, { node: node.id })] } });
          store.getState().endGesture();
        }
        if (state.tool === "connect") state.setTool("select");
        break;
      }

      case "draw": {
        const rect = rectFromPoints(current.start, world);
        const dragged = rect.w > 12 && rect.h > 12;
        const def = getShape(current.shape);
        store.setState({ overlay: {} });
        createNode(store, current.shape, {
          at: dragged ? { x: rect.x, y: rect.y } : world,
          topLeft: dragged,
          size: dragged ? { w: rect.w, h: def.keepAspect ? rect.w : rect.h } : undefined,
          edit: !def.container && usesText(def),
        });
        if (!event.shiftKey) state.setTool("select");
        break;
      }

      case "pan":
        break;
    }
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    const state = store.getState();
    const doc = state.doc;
    if (!doc || state.tool !== "select" || state.readOnly) return;
    // Hit-test by position: pointer capture retargets click events to the canvas container.
    const target = document.elementFromPoint(event.clientX, event.clientY) ?? (event.target as Element);
    if (target.closest("[data-canvas-ui], [data-handle], [data-port]")) return;
    const id = target.closest("[data-id]")?.getAttribute("data-id");
    if (id && (doc.nodes[id] || doc.edges[id])) {
      if (!doc.nodes[id]?.locked) store.setState({ editing: id, selection: [id] });
      return;
    }
    createNode(store, defaultShape(doc), { at: worldPoint(event), text: "", edit: true });
  }

  function onPointerLeave() {
    if (!drag.current && store.getState().hovered) store.setState({ hovered: null });
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    if (containerRef.current?.hasPointerCapture(event.pointerId)) containerRef.current.releasePointerCapture(event.pointerId);
    store.getState().cancelGesture();
  }

  /** Right-click selects what is under the pointer so the context menu acts on it. */
  function onContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    const state = store.getState();
    const id = (event.target as Element).closest("[data-id]")?.getAttribute("data-id");
    if (id && state.doc && (state.doc.nodes[id] || state.doc.edges[id])) {
      if (!state.selection.includes(id)) state.select([id]);
    } else if (!(event.target as Element).closest("[data-canvas-ui]")) {
      state.select([]);
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onDoubleClick, onContextMenu };
}
