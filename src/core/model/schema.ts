import { z } from "zod";

import { MARKER_KINDS } from "../edges/markers";
import { normalizeColor } from "./palette";
import { safeLink } from "./url";
import { SCHEMA_VERSION, type DiagramDoc, type MarkerKind, type Patch } from "./types";

/**
 * Runtime validation for everything that crosses a trust boundary: REST
 * payloads from the browser, imported files and documents read from disk.
 */

const MAX_TEXT = 20_000;
const coordinate = z.number().finite().min(-1e6).max(1e6);
const dimension = z.number().finite().min(1).max(1e5);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/, "ids are 1-64 chars: letters, digits, _ . : -");
const text = z.string().max(MAX_TEXT);
const point = z.object({ x: coordinate, y: coordinate });

export const colorSchema = z
  .string()
  .max(16)
  .transform((value, ctx) => {
    const color = normalizeColor(value);
    if (!color) {
      ctx.addIssue({ code: "custom", message: `"${value}" is not a colour. Use #rrggbb or "none".` });
      return z.NEVER;
    }
    return color;
  });

const textStyle = {
  fontFamily: z.enum(["sans", "serif", "mono", "hand"]).optional(),
  fontSize: z.number().min(4).max(200).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  textColor: colorSchema.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  valign: z.enum(["top", "middle", "bottom"]).optional(),
};

const dash = z.enum(["solid", "dashed", "dotted"]);

export const nodeStyleSchema = z.object({
  ...textStyle,
  fill: colorSchema.optional(),
  stroke: colorSchema.optional(),
  strokeWidth: z.number().min(0).max(40).optional(),
  dash: dash.optional(),
  opacity: z.number().min(0).max(1).optional(),
  radius: z.number().min(0).max(500).optional(),
  shadow: z.boolean().optional(),
});

export const markerSchema = z.enum(MARKER_KINDS as [MarkerKind, ...MarkerKind[]]);

export const edgeStyleSchema = z.object({
  ...textStyle,
  stroke: colorSchema.optional(),
  strokeWidth: z.number().min(0.25).max(40).optional(),
  dash: dash.optional(),
  opacity: z.number().min(0).max(1).optional(),
  startMarker: markerSchema.optional(),
  endMarker: markerSchema.optional(),
  animated: z.boolean().optional(),
});

const actor = z.object({
  kind: z.enum(["human", "agent", "system"]),
  id: z.string().max(80),
  name: z.string().max(80),
  ownerId: z.string().max(80).optional(),
});

export const nodeSchema = z.object({
  id,
  shape: z.string().max(80),
  x: coordinate,
  y: coordinate,
  w: dimension,
  h: dimension,
  rotation: z.number().finite().min(-360).max(360).optional(),
  z: z.number().finite(),
  parent: id.optional(),
  text: text.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  style: nodeStyleSchema.optional(),
  locked: z.boolean().optional(),
  link: z
    .string()
    .max(2000)
    .refine((value) => safeLink(value) !== undefined || value.trim() === "", { message: "Links must be http(s), mailto or relative URLs." })
    .optional(),
  note: text.optional(),
  createdBy: actor.optional(),
});

const anchor = z.union([z.literal("auto"), z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })]);
const edgeEnd = z.object({ node: id.optional(), anchor: anchor.optional(), point: point.optional() });

export const routingSchema = z.enum(["straight", "orthogonal", "curved"]);

export const edgeSchema = z.object({
  id,
  from: edgeEnd,
  to: edgeEnd,
  routing: routingSchema,
  waypoints: z.array(point).max(200).optional(),
  autoRoute: z.boolean().optional(),
  text: text.optional(),
  startText: z.string().max(200).optional(),
  endText: z.string().max(200).optional(),
  style: edgeStyleSchema.optional(),
  z: z.number().finite().optional(),
  note: text.optional(),
  createdBy: actor.optional(),
});

export const commentSchema = z.object({
  id,
  target: id.optional(),
  x: coordinate,
  y: coordinate,
  author: actor,
  text: text.min(1),
  createdAt: z.string().max(40),
  resolved: z.boolean().optional(),
  replies: z
    .array(z.object({ id, author: actor, text: text.min(1), createdAt: z.string().max(40) }))
    .max(500)
    .default([]),
});

export const layoutSchema = z.object({
  algorithm: z.enum(["layered", "tree", "force", "radial", "grid"]),
  direction: z.enum(["down", "right", "up", "left"]),
  spacing: z.number().min(0).max(1000).optional(),
  rankSpacing: z.number().min(0).max(1000).optional(),
});

export const settingsSchema = z.object({
  background: colorSchema,
  grid: z.enum(["dots", "lines", "none"]),
  gridSize: z.number().min(2).max(200),
  snap: z.boolean(),
  routing: routingSchema,
  layout: layoutSchema,
  autoLayout: z.boolean(),
});

const elementPatch = <T extends z.ZodType>(element: T) =>
  z.object({ set: z.array(element).max(5000).optional(), remove: z.array(id).max(5000).optional() });

export const patchSchema = z.object({
  nodes: elementPatch(nodeSchema).optional(),
  edges: elementPatch(edgeSchema).optional(),
  comments: elementPatch(commentSchema).optional(),
  doc: z
    .object({
      name: z.string().min(1).max(200).optional(),
      type: z.string().max(80).optional(),
      description: z.string().max(4000).optional(),
      settings: settingsSchema.partial().optional(),
    })
    .optional(),
});

export const docSchema = z.object({
  schema: z.literal(SCHEMA_VERSION),
  id,
  name: z.string().min(1).max(200),
  type: z.string().max(80),
  description: z.string().max(4000).optional(),
  nodes: z.record(z.string(), nodeSchema),
  edges: z.record(z.string(), edgeSchema),
  comments: z.record(z.string(), commentSchema).default({}),
  settings: settingsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().min(0),
});

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function parsePatch(input: unknown): Patch {
  return patchSchema.parse(input) as Patch;
}

export function parseDoc(input: unknown): DiagramDoc {
  return docSchema.parse(input) as DiagramDoc;
}
