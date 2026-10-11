import type { Point, Rect } from "../../model/types";

/** A node as the router sees it: its rotated bounds and where it sits in the container tree. */
export interface SceneBox {
  id: string;
  box: Rect;
  /** Containers are never obstacles; they only carry soft costs (title strip, shared parent). */
  container: boolean;
  /** Height of the title strip along the top of a container. */
  header: number;
  parent?: string;
}

/** One end of a connector, already resolved to a port. */
export interface RouteEnd {
  /** Port on the shape outline, or the free end point. */
  point: Point;
  /** Unit direction of travel when leaving the port. */
  normal: Point;
  /**
   * How far the port sits inside the node's bounding box, measured along `normal`
   * (non-zero for ports on a diamond slope or a fanned-out port on an ellipse).
   */
  depth: number;
  /** Straight run beyond the bounding box before the route may turn. */
  stub: number;
  /** Attached node: its body is an obstacle everywhere except at this port. */
  node?: string;
}

export interface RouteResult {
  /** Route vertices from port to port: axis-aligned, no repeated or collinear points. */
  points: Point[];
  /** Cost under the router's model (length + bends + penalties). Comparable between results of one problem. */
  cost: number;
  bends: number;
  /** The part of `cost` paid for sharing channels with connectors that are already routed. */
  shared: number;
  /** True when the route pays no obstacle, clearance, container or overlap penalty. */
  clean: boolean;
  /** Length drawn through other nodes: zero whenever an obstacle-free route exists. */
  crossing: number;
}

/**
 * Tuning of the cost model. All distances are world pixels; a route "costs" its
 * length plus these penalties, so a bend is worth a detour of `BEND` px.
 */
export const CLEARANCE = 12;
/** Half the narrowest gap a route may squeeze through (the node plus this much is a wall). */
export const HARD_MARGIN = 4;
export const BEND = 40;
export const REVERSAL = 3000;
/** Extra cost per px of a route inside another node. */
export const CROSS_PER_PX = 25;
/** Extra cost per px at the very edge of a node, fading to nothing at the clearance distance. */
export const SOFT_PER_PX = 2;
/** Extra cost per px outside the container both ends live in. */
export const OUTSIDE_PER_PX = 1;
/** Extra cost per px running along a container's title strip. */
export const HEADER_PER_PX = 2;
/** Extra cost per px sharing a channel with a connector that is already routed. */
export const OVERLAP_PER_PX = 0.3;

/**
 * Weight on the distance part of the A* estimate. Above 1 the search runs a little greedy: it expands a
 * third of the states and, because bends dominate the cost, returns the same routes in practice.
 */
export const GREED = 1.25;

/** Search window around the two ends before obstacles are considered. */
export const WINDOW = 100;
/** Grid vertices above which the sparse search is skipped for the heuristic candidates. */
export const MAX_VERTICES = 6000;
export const MAX_OBSTACLES = 48;

/** Coordinates closer than this are one line; a point inside a rect by less is on its border. */
export const SNAP = 0.25;
export const IN_EPS = 0.3;
