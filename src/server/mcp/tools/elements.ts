import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DiagramDoc, Id } from "@/core/model/types";
import type { ApplyElementsResult } from "@/server/service";

import { diagramUrl } from "../format";
import { edgeInput, layoutChoice, layoutInput, nodeInput } from "../schemas";
import { DESTRUCTIVE, diagramId, IDEMPOTENT_WRITE, registerTool, WRITE, type ToolContext } from "../toolkit";

function positions(doc: DiagramDoc, ids: Id[]): string[] {
  return ids
    .filter((id) => doc.nodes[id])
    .slice(0, 80)
    .map((id) => {
      const n = doc.nodes[id];
      return `  ${id} → (${Math.round(n.x)}, ${Math.round(n.y)}) ${Math.round(n.w)}×${Math.round(n.h)}`;
    });
}

function applyReport(outcome: ApplyElementsResult, baseUrl: string) {
  const { doc, result, layout } = outcome;
  const lines: string[] = [];
  if (result.created.nodes.length) lines.push(`Created ${result.created.nodes.length} node(s): ${result.created.nodes.join(", ")}`);
  if (result.created.edges.length) lines.push(`Created ${result.created.edges.length} edge(s): ${result.created.edges.join(", ")}`);
  if (result.updated.nodes.length) lines.push(`Updated ${result.updated.nodes.length} node(s): ${result.updated.nodes.join(", ")}`);
  if (result.updated.edges.length) lines.push(`Updated ${result.updated.edges.length} edge(s): ${result.updated.edges.join(", ")}`);
  if (!lines.length) lines.push("Nothing was changed.");
  if (layout === "full") lines.push("Layout: the whole diagram was arranged automatically.");
  if (layout === "incremental") lines.push("Layout: new nodes were placed next to their neighbours (the user has arranged this diagram by hand, so it was not re-flowed). Call diagram_layout to re-arrange everything.");
  const placed = positions(doc, [...result.created.nodes, ...result.updated.nodes]);
  if (placed.length) lines.push("Positions:", ...placed);
  if (result.warnings.length) lines.push("", "Warnings (fix and retry the affected items):", ...result.warnings.map((w) => `- ${w}`));
  lines.push("", `Diagram now has ${Object.keys(doc.nodes).length} nodes and ${Object.keys(doc.edges).length} edges. Check the result with diagram_preview. ${diagramUrl(baseUrl, doc.id)}`);
  return {
    text: lines.join("\n"),
    structured: { created: result.created, updated: result.updated, warnings: result.warnings, layout, version: doc.version },
  };
}

export function registerElementTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, {
    name: "diagram_add_elements",
    title: "Add nodes and edges",
    description: `Add nodes and/or edges to a diagram. This is the main drawing tool: send the whole diagram (or a coherent chunk of it) in one call.

You do NOT need coordinates: leave x/y out and nodes are sized to their text and arranged automatically. Give each node a short readable \`id\` and reference those ids in \`edges\` (edges can connect to nodes created in the same call or to existing ones).

Example — a small flow:
  nodes: [{ id: "start", shape: "terminator", text: "Start" }, { id: "check", shape: "decision", text: "Valid?" }, { id: "save", text: "Save order" }]
  edges: [{ from: "start", to: "check" }, { from: "check", to: "save", text: "Yes" }]
Example — grouping: { id: "backend", shape: "group", text: "Backend" } then children with parent: "backend".
Example — UML class: { id: "user", shape: "uml/class", text: "User\\n---\\n+ id: UUID\\n+ email: string\\n---\\n+ login(): void" } and an edge { from: "admin", to: "user", kind: "inheritance" }.

Returns the ids created, their positions, and warnings for anything that could not be applied (unknown shapes, missing node ids) so you can fix just those. Use diagram_update_elements to change existing elements.`,
    input: {
      diagram_id: diagramId,
      nodes: z.array(nodeInput).max(300).default([]).describe("Nodes to create."),
      edges: z.array(edgeInput).max(600).default([]).describe("Edges to create. Each needs `from` and `to` node ids."),
      layout: layoutChoice,
    },
    annotations: WRITE,
    run: async ({ diagram_id, nodes, edges, layout }, { service, actor, baseUrl }) => {
      if (!nodes.length && !edges.length) return "Error: provide at least one node or edge.";
      return applyReport(await service.applyElements(diagram_id, { nodes, edges }, { actor, mode: "create", layout }), baseUrl);
    },
  });

  registerTool(server, ctx, {
    name: "diagram_update_elements",
    title: "Update nodes and edges",
    description: `Change existing nodes or edges by id. Only the fields you send are changed: text, shape, color, style, size, position, parent, edge endpoints, kind, labels.

Examples: rename → nodes: [{ id: "save", text: "Persist order" }]; recolour → nodes: [{ id: "db", color: "green" }]; re-point an edge → edges: [{ id: "e_ab12", to: "queue" }]; move into a group → nodes: [{ id: "api", parent: "backend" }].

Element ids come from diagram_read or from the call that created them. Unknown ids are reported as warnings and skipped.`,
    input: {
      diagram_id: diagramId,
      nodes: z.array(nodeInput.extend({ id: z.string().max(64).describe("Id of the node to update.") })).max(300).default([]),
      edges: z.array(edgeInput.extend({ id: z.string().max(64).describe("Id of the edge to update.") })).max(600).default([]),
      layout: layoutChoice,
    },
    annotations: IDEMPOTENT_WRITE,
    run: async ({ diagram_id, nodes, edges, layout }, { service, actor, baseUrl }) => {
      if (!nodes.length && !edges.length) return "Error: provide at least one node or edge to update.";
      return applyReport(await service.applyElements(diagram_id, { nodes, edges }, { actor, mode: "update", layout: layout ?? "none" }), baseUrl);
    },
  });

  registerTool(server, ctx, {
    name: "diagram_delete_elements",
    title: "Delete nodes and edges",
    description:
      "Remove nodes, edges or comments from a diagram by id. Edges attached to a removed node are removed with it. Removing a container also removes everything inside it unless keep_children is true. The user can undo this in the browser.",
    input: {
      diagram_id: diagramId,
      ids: z.array(z.string().max(64)).min(1).max(1000).describe("Ids of the nodes, edges or comments to remove."),
      keep_children: z.boolean().default(false).describe("When removing a container, keep its children on the canvas."),
    },
    annotations: DESTRUCTIVE,
    run: async ({ diagram_id, ids, keep_children }, { service, actor }) => {
      const { doc, removed, missing } = await service.remove(diagram_id, ids, actor, !keep_children);
      return {
        text: [
          removed.length ? `Removed ${removed.length} element(s): ${removed.join(", ")}` : "Nothing was removed.",
          ...(missing.length ? [`Not found (already gone or wrong id): ${missing.join(", ")}. Use diagram_read to list current ids.`] : []),
          `Diagram now has ${Object.keys(doc.nodes).length} nodes and ${Object.keys(doc.edges).length} edges.`,
        ].join("\n"),
        structured: { removed, missing, version: doc.version },
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_layout",
    title: "Auto-arrange a diagram",
    description: `Re-arrange a diagram automatically: positions nodes, resizes containers around their children and routes connectors.

Algorithms — layered: flows, architectures, dependencies, class hierarchies (default). tree: org charts, mind maps, decision trees. force: networks without a clear direction. radial: hub-and-spoke. grid: unconnected items.
Call it without options to re-apply the diagram's current layout, e.g. after the user asked to "tidy up". Pass \`ids\` to arrange only part of the diagram. The browser animates the change.`,
    input: {
      diagram_id: diagramId,
      options: layoutInput.optional(),
      ids: z.array(z.string().max(64)).max(2000).optional().describe("Only arrange these nodes; everything else stays put."),
    },
    annotations: IDEMPOTENT_WRITE,
    run: async ({ diagram_id, options, ids }, { service, actor }) => {
      const doc = await service.layout(diagram_id, actor, options, ids);
      const layout = doc.settings.layout;
      return `Arranged ${ids?.length ?? Object.keys(doc.nodes).length} nodes with the ${layout.algorithm} layout (direction: ${layout.direction}). Check the result with diagram_preview.`;
    },
  });

  registerTool(server, ctx, {
    name: "diagram_build_sequence",
    title: "Build a sequence diagram",
    description: `Generate a UML sequence diagram from an ordered list of participants and messages. Lifelines are spaced so labels fit and each message gets its own row, top to bottom.

Use this instead of diagram_add_elements for sequence diagrams (time-ordered interactions cannot be auto-arranged as a graph). Create the diagram with type "uml-sequence" first.

Example:
  participants: [{ id: "user", name: "User", kind: "actor" }, { id: "api", name: "API" }, { id: "db", name: "Database" }]
  messages: [{ from: "user", to: "api", text: "POST /orders" }, { from: "api", to: "db", text: "INSERT order" }, { from: "db", to: "api", text: "id", kind: "return" }, { from: "api", to: "api", text: "validate" }, { from: "api", to: "user", text: "201 Created", kind: "return" }]

kind: "sync" (solid arrow, default), "async" (open arrow), "return" (dashed). A message from a participant to itself draws a self-call. If the diagram already has content the sequence is placed below it.`,
    input: {
      diagram_id: diagramId,
      participants: z
        .array(
          z.object({
            id: z.string().max(40).optional().describe("Short id used in messages. Defaults to a slug of the name."),
            name: z.string().min(1).max(80).describe("Label shown in the lifeline header."),
            kind: z.enum(["participant", "actor"]).default("participant").describe("'actor' draws a stick figure."),
          }),
        )
        .min(1)
        .max(30),
      messages: z
        .array(
          z.object({
            from: z.string().max(80).describe("Sender participant id or name."),
            to: z.string().max(80).describe("Receiver participant id or name."),
            text: z.string().max(200).optional(),
            kind: z.enum(["sync", "async", "return"]).default("sync"),
          }),
        )
        .max(200),
    },
    annotations: WRITE,
    run: async ({ diagram_id, participants, messages }, { service, actor, baseUrl }) => {
      const { doc, participantIds, warnings } = await service.buildSequence(diagram_id, { participants, messages }, actor);
      return [
        `Built a sequence diagram: ${participantIds.length} lifelines (${participantIds.join(", ")}) and ${messages.length - warnings.length} messages.`,
        ...(warnings.length ? ["Warnings:", ...warnings.map((w) => `- ${w}`)] : []),
        `Check the result with diagram_preview. ${diagramUrl(baseUrl, doc.id)}`,
      ].join("\n");
    },
  });
}
