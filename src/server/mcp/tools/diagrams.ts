import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getDiagramType, resolveDiagramType } from "@/core/catalog";
import { colorSchema, routingSchema } from "@/core/model/schema";

import { describeDiagram, diagramUrl, summaryLine } from "../format";
import { pagination } from "../schemas";
import { DESTRUCTIVE, diagramId, IDEMPOTENT_WRITE, READ_ONLY, registerTool, WRITE, type ToolContext } from "../toolkit";

export function registerDiagramTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, {
    name: "diagram_list",
    title: "List diagrams",
    description:
      "List the diagrams in the workspace, most recently updated first, with ids, types, sizes and URLs. Use it to find the diagram the user is talking about before reading or editing it.",
    input: {
      query: z.string().max(100).optional().describe("Only diagrams whose name contains this text (case-insensitive)."),
      ...pagination,
    },
    annotations: READ_ONLY,
    run: async ({ query, limit, offset }, { service, baseUrl }) => {
      const q = query?.trim().toLowerCase();
      const all = (await service.list()).filter((d) => !q || d.name.toLowerCase().includes(q));
      const page = all.slice(offset, offset + limit);
      if (all.length === 0) {
        return q ? `No diagram name contains "${query}". Call diagram_list without a query to see all.` : "The workspace is empty. Create a diagram with diagram_create.";
      }
      const hasMore = all.length > offset + page.length;
      return {
        text: [
          `${all.length} diagram${all.length === 1 ? "" : "s"}${hasMore ? ` (showing ${offset + 1}–${offset + page.length})` : ""}:`,
          ...page.map((d) => summaryLine(d, baseUrl)),
          ...(hasMore ? [`More available: offset=${offset + limit}.`] : []),
        ].join("\n"),
        structured: { total: all.length, count: page.length, offset, has_more: hasMore, diagrams: page.map((d) => ({ ...d, url: diagramUrl(baseUrl, d.id) })) },
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_create",
    title: "Create a diagram",
    description: `Create a new, empty diagram and get its id and the URL where the user can watch it being drawn live.

Pick the \`type\` that matches the notation (e.g. flowchart, uml-class, uml-sequence, er-diagram, c4-container, architecture, bpmn, agent-architecture, mind-map). The type sets the default shapes, connector style and layout, and the response tells you which shapes and edge kinds to use. Call diagram_list_types to browse all types.

Next step: add content with diagram_add_elements (or diagram_build_sequence for sequence diagrams). Tell the user the URL so they can follow along.`,
    input: {
      name: z.string().min(1).max(200).describe("Title shown to the user, e.g. 'Checkout service architecture'."),
      type: z.string().max(80).default("flowchart").describe("Diagram type id or name, e.g. 'uml-class', 'ER diagram', 'c4-container'."),
      description: z.string().max(2000).optional().describe("What the diagram shows, for future readers."),
      with_example: z.boolean().default(false).describe("Start from the type's example content instead of an empty canvas."),
    },
    annotations: WRITE,
    run: async ({ name, type, description, with_example }, { service, actor, baseUrl }) => {
      const resolved = resolveDiagramType(type);
      const doc = await service.create({ name, type: resolved?.id ?? type, description, template: with_example }, actor);
      const def = getDiagramType(doc.type);
      const url = diagramUrl(baseUrl, doc.id);
      return {
        text: [
          `Created "${doc.name}" — id: \`${doc.id}\`, type: ${def.id} (${def.name}).`,
          `Open in the browser to watch live: ${url}`,
          ...(resolved ? [] : [`Note: unknown type "${type}", used "${def.id}". Call diagram_list_types to see valid types.`]),
          "",
          `How to draw a ${def.name}: ${def.agentGuide}`,
          `Default shape: ${def.defaultShape} · default edge kind: ${def.edgeKind} · layout: ${def.layout.algorithm}/${def.layout.direction}`,
          `Shape libraries for this type: ${def.libraries.join(", ")} (browse with diagram_list_shapes).`,
        ].join("\n"),
        structured: { id: doc.id, url, type: def.id, default_shape: def.defaultShape, node_count: Object.keys(doc.nodes).length },
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_read",
    title: "Read a diagram",
    description: `Read the current content of a diagram: every node (id, shape, label, position, size, container), every edge (id, endpoints, label, kind) and open comments.

Always read before editing a diagram you did not just create — the user may have changed it in the browser. Use \`ids\` to focus on part of a large diagram, and response_format "json" when you need exact styles or data fields.`,
    input: {
      diagram_id: diagramId,
      ids: z.array(z.string().max(64)).max(500).optional().describe("Only these elements (and edges touching them)."),
      response_format: z.enum(["markdown", "json"]).default("markdown").describe("'markdown': compact outline. 'json': full element data including styles."),
      ...pagination,
    },
    annotations: READ_ONLY,
    run: async ({ diagram_id, ids, response_format, limit, offset }, { service, baseUrl, hub, actor }) => {
      const doc = await service.get(diagram_id);
      hub.log(doc.id, actor, "read", "read the diagram");
      if (response_format === "markdown") {
        const { review } = await service.reviewState(diagram_id);
        return describeDiagram(doc, baseUrl, { ids, limit, offset, review });
      }

      const filter = ids?.length ? new Set(ids) : null;
      const nodes = Object.values(doc.nodes).filter((n) => !filter || filter.has(n.id));
      const edges = Object.values(doc.edges).filter(
        (e) => !filter || filter.has(e.id) || (e.from.node && filter.has(e.from.node)) || (e.to.node && filter.has(e.to.node)),
      );
      const payload = {
        id: doc.id,
        name: doc.name,
        type: doc.type,
        description: doc.description,
        version: doc.version,
        url: diagramUrl(baseUrl, doc.id),
        settings: doc.settings,
        total_nodes: nodes.length,
        total_edges: edges.length,
        offset,
        has_more: Math.max(nodes.length, edges.length) > offset + limit,
        nodes: nodes.slice(offset, offset + limit),
        edges: edges.slice(offset, offset + limit),
        comments: Object.values(doc.comments),
      };
      return { text: JSON.stringify(payload, null, 2), structured: payload };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_configure",
    title: "Rename or configure a diagram",
    description:
      "Change a diagram's name, description, type or canvas settings (background colour, default connector routing). Does not touch its elements.",
    input: {
      diagram_id: diagramId,
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      type: z.string().max(80).optional().describe("New diagram type id (changes palette and defaults, not existing elements)."),
      background: colorSchema.optional().describe("Canvas colour as #rrggbb."),
      routing: routingSchema.optional().describe("Routing for connectors created from now on."),
    },
    annotations: IDEMPOTENT_WRITE,
    run: async ({ diagram_id, name, description, type, background, routing }, { service, actor }) => {
      const resolved = type ? resolveDiagramType(type) : undefined;
      if (type && !resolved) return `Error: unknown diagram type "${type}". Call diagram_list_types to see valid types.`;
      const settings = { ...(background ? { background } : {}), ...(routing ? { routing } : {}), ...(resolved ? { layout: resolved.layout } : {}) };
      const doc = await service.commit(
        diagram_id,
        { doc: { name, description, type: resolved?.id, ...(Object.keys(settings).length ? { settings } : {}) } },
        actor,
        { log: { action: "update", summary: "updated the diagram settings" } },
      );
      return `Updated "${doc.name}" (type: ${doc.type}, background: ${doc.settings.background}, routing: ${doc.settings.routing}).`;
    },
  });

  registerTool(server, ctx, {
    name: "diagram_delete",
    title: "Delete a diagram",
    description:
      "Permanently delete a whole diagram and its checkpoints. This cannot be undone — only call it when the user explicitly asked to delete the diagram. To remove elements inside a diagram use diagram_delete_elements.",
    input: { diagram_id: diagramId, confirm_name: z.string().describe("The diagram's exact name, to confirm you are deleting the right one.") },
    annotations: DESTRUCTIVE,
    run: async ({ diagram_id, confirm_name }, { service }) => {
      const doc = await service.get(diagram_id);
      if (doc.name.trim().toLowerCase() !== confirm_name.trim().toLowerCase()) {
        return `Error: confirm_name does not match. The diagram "${diagram_id}" is named "${doc.name}". Nothing was deleted.`;
      }
      await service.deleteDiagram(diagram_id);
      return `Deleted diagram "${doc.name}" (${diagram_id}).`;
    },
  });
}
