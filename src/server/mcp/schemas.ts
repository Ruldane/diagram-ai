import { z } from "zod";

import { EDGE_KIND_NAMES } from "@/core/edges/kinds";
import { PALETTE_NAMES } from "@/core/model/palette";
import { edgeStyleSchema, layoutSchema, nodeStyleSchema, routingSchema } from "@/core/model/schema";

const COLORS = PALETTE_NAMES.join(", ");

export const nodeInput = z
  .object({
    id: z
      .string()
      .max(64)
      .optional()
      .describe("Stable id you choose, e.g. 'auth-service'. Edges and later updates refer to it. Derived from the text when omitted."),
    shape: z
      .string()
      .max(80)
      .optional()
      .describe("Shape id or alias: 'flowchart/decision', 'uml/class', 'postgres', 'agent'… Omit for the diagram type's default shape. Browse with diagram_list_shapes."),
    text: z
      .string()
      .max(4000)
      .optional()
      .describe("Label. Use \\n for line breaks. For compartment shapes (uml/class, er/entity) separate sections with a line containing only ---."),
    parent: z.string().max(64).nullable().optional().describe("Id of a container node (frame, group, pool, boundary…) this node sits inside. null detaches."),
    color: z.string().max(16).optional().describe(`Palette colour for fill + stroke + text: ${COLORS}. Or a #rrggbb fill.`),
    icon: z.string().max(40).optional().describe("Icon name for icon-based shapes (icons/*, infra/*, ai/*), e.g. 'database', 'bot', 'shield-check'."),
    x: z.number().optional().describe("Left position in px. Omit x and y to let auto-layout place the node (recommended)."),
    y: z.number().optional().describe("Top position in px."),
    w: z.number().min(1).optional().describe("Width in px. Omit to fit the text."),
    h: z.number().min(1).optional().describe("Height in px. Omit to fit the text."),
    style: nodeStyleSchema.optional().describe("Fine-grained style overrides (fill, stroke, strokeWidth, dash, fontSize, bold, align…)."),
    data: z.record(z.string(), z.unknown()).optional().describe("Shape-specific parameters documented by diagram_list_shapes."),
    note: z.string().max(2000).optional().describe("Hidden note for collaborators (not drawn)."),
    link: z.string().max(2000).optional().describe("URL opened when the node is clicked in exports."),
  })
  .strict();

const anchorInput = z.enum(["auto", "top", "right", "bottom", "left"]);

export const edgeInput = z
  .object({
    id: z.string().max(64).optional().describe("Optional id. Only needed to update or delete the edge later."),
    from: z.string().max(64).optional().describe("Source node id. Required for new edges."),
    to: z.string().max(64).optional().describe("Target node id. Required for new edges."),
    text: z.string().max(400).optional().describe("Label in the middle of the edge, e.g. 'Yes', 'HTTPS', 'publishes'."),
    kind: z
      .string()
      .max(40)
      .optional()
      .describe(`Relationship preset setting markers and dash: ${EDGE_KIND_NAMES.join(", ")}. Defaults to 'flow' (arrow at the target).`),
    routing: routingSchema.optional().describe("Line routing. Defaults to the diagram's setting."),
    startText: z.string().max(60).optional().describe("Small label near the source end (multiplicity, role)."),
    endText: z.string().max(60).optional().describe("Small label near the target end."),
    color: z.string().max(16).optional().describe(`Line colour: ${COLORS}, or #rrggbb.`),
    fromAnchor: anchorInput.optional().describe("Side of the source node to leave from. Default 'auto'."),
    toAnchor: anchorInput.optional().describe("Side of the target node to arrive at. Default 'auto'."),
    style: edgeStyleSchema.optional().describe("Fine-grained overrides (stroke, strokeWidth, dash, startMarker, endMarker, fontSize…)."),
    note: z.string().max(2000).optional(),
  })
  .strict();

export const layoutInput = layoutSchema.describe(
  "Layout options. algorithm: layered (flows, architectures, hierarchies — default), tree (org charts, mind maps), force (networks), radial, grid. direction: down, right, up, left.",
);

export const layoutChoice = z
  .union([z.enum(["auto", "none"]), layoutInput])
  .optional()
  .describe(
    "'auto' (default): position new nodes automatically — a full re-layout while the diagram is still machine-arranged, otherwise next to their neighbours. 'none': keep the x/y you gave. Or explicit layout options to force a full re-layout.",
  );

export const pagination = {
  limit: z.number().int().min(1).max(200).default(60).describe("Maximum items to return."),
  offset: z.number().int().min(0).default(0).describe("Items to skip, for pagination."),
};
