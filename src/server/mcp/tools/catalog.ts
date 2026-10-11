import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CATEGORIES, listDiagramTypes, searchDiagramTypes } from "@/core/catalog";
import { EDGE_KINDS } from "@/core/edges/kinds";
import { PALETTE } from "@/core/model/palette";
import { ICON_NAMES } from "@/core/shapes/icons";
import { getLibrary, listLibraries, searchShapes } from "@/core/shapes/registry";
import type { ShapeDef } from "@/core/shapes/types";

import { ensurePacks } from "../../packs/runtime";
import { pagination } from "../schemas";
import { READ_ONLY, registerTool, type ToolContext } from "../toolkit";

function shapeLine(shape: ShapeDef): string {
  const aliases = shape.aliases?.length ? ` · aliases: ${shape.aliases.slice(0, 5).join(", ")}` : "";
  const container = shape.container ? " · container" : "";
  const data = shape.data && Object.keys(shape.data).length ? ` · data: ${JSON.stringify(shape.data)}` : "";
  return `- \`${shape.id}\` — ${shape.name}${shape.description ? `: ${shape.description}` : ""}${aliases}${container}${data}`;
}

export function registerCatalogTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, {
    name: "diagram_list_types",
    title: "List diagram types",
    description:
      "Browse the catalog of diagram types (flowcharts, the UML family, ER, C4, BPMN, cloud architecture, AI agent systems, mind maps, roadmaps, wireframes…). Each entry says what the diagram is for and how to draw it correctly: which shapes and edge kinds to use. Call this when you are unsure which type fits the user's request.",
    input: {
      query: z.string().max(100).optional().describe("Search by name or keyword, e.g. 'database', 'swimlane', 'agent'."),
      category: z.string().max(40).optional().describe(`Only one category: ${CATEGORIES.map((c) => c.id).join(", ")}.`),
      ...pagination,
    },
    annotations: READ_ONLY,
    run: async ({ query, category, limit, offset }) => {
      let types = query ? searchDiagramTypes(query, 200) : listDiagramTypes();
      if (category) types = types.filter((t) => t.category === category);
      if (types.length === 0) return `No diagram type matches. Categories: ${CATEGORIES.map((c) => c.id).join(", ")}. Try a broader query, or use the "blank" type.`;
      const page = types.slice(offset, offset + limit);
      const lines = [`${types.length} diagram type${types.length === 1 ? "" : "s"}${types.length > page.length ? ` (showing ${offset + 1}–${offset + page.length})` : ""}:`];
      for (const type of page) {
        lines.push(
          `\n### ${type.name} — \`${type.id}\` (${type.category}${type.support === "generic" ? ", generic shapes" : ""})`,
          type.description,
          `How to draw: ${type.agentGuide}`,
          `Defaults: shape ${type.defaultShape}, edge kind ${type.edgeKind}, layout ${type.layout.algorithm}/${type.layout.direction}. Libraries: ${type.libraries.join(", ")}.`,
        );
      }
      if (types.length > offset + page.length) lines.push(`\nMore available: offset=${offset + limit}.`);
      return lines.join("\n");
    },
  });

  registerTool(server, ctx, {
    name: "diagram_list_shapes",
    title: "List shapes, icons, edge kinds and colours",
    description: `Look up what you can draw with.

- No arguments: the shape libraries with their sizes.
- library: "<id>" (e.g. "uml", "infra", "ai", "bpmn"): every shape in that library with its id, purpose, aliases and data parameters.
- query: "<text>": search shapes across all libraries (e.g. "queue", "actor", "gateway").
- library: "icons-list": the icon names accepted by \`icon\` on icon-based shapes.
- library: "edge-kinds": the relationship presets accepted by an edge's \`kind\`.
- library: "colors": the palette names accepted by \`color\`.

Any shape id, short name or alias shown here can be used as a node's \`shape\`.`,
    input: {
      library: z.string().max(40).optional().describe("Library id, or 'icons-list', 'edge-kinds', 'colors'."),
      query: z.string().max(60).optional().describe("Search text across shape names, aliases and descriptions."),
      ...pagination,
    },
    annotations: READ_ONLY,
    run: async ({ library, query, limit, offset }) => {
      await ensurePacks();
      if (library === "edge-kinds") {
        return ["Edge kinds (use as `kind` on an edge):", ...Object.entries(EDGE_KINDS).map(([id, k]) => `- \`${id}\` — ${k.description}`)].join("\n");
      }
      if (library === "colors") {
        return ["Palette colours (use as `color`):", ...Object.entries(PALETTE).map(([id, s]) => `- \`${id}\` — fill ${s.fill}, stroke ${s.stroke}`)].join("\n");
      }
      if (library === "icons-list") {
        const q = query?.toLowerCase();
        const names = ICON_NAMES.filter((n) => !q || n.includes(q));
        return `${names.length} icon names${q ? ` matching "${query}"` : ""} (use as \`icon\` on icons/*, infra/* and ai/* shapes):\n${names.join(", ")}`;
      }
      if (query) {
        const hits = searchShapes(query, 200).filter((s) => !library || s.id.startsWith(`${library}/`));
        if (!hits.length) return `No shape matches "${query}". Call diagram_list_shapes without arguments to see the libraries.`;
        const page = hits.slice(offset, offset + limit);
        return [`${hits.length} shape(s) matching "${query}":`, ...page.map(shapeLine), ...(hits.length > offset + page.length ? [`More available: offset=${offset + limit}.`] : [])].join("\n");
      }
      if (library) {
        const lib = getLibrary(library);
        if (!lib) return `Error: unknown library "${library}". Libraries: ${listLibraries().map((l) => l.id).join(", ")}, plus icons-list, edge-kinds, colors.`;
        const page = lib.shapes.slice(offset, offset + limit);
        return [
          `## ${lib.name} (\`${lib.id}\`) — ${lib.shapes.length} shapes`,
          lib.description,
          "",
          ...page.map(shapeLine),
          ...(lib.shapes.length > offset + page.length ? [`More available: offset=${offset + limit}.`] : []),
        ].join("\n");
      }
      return [
        "Shape libraries (call again with `library` to list shapes, or `query` to search):",
        ...listLibraries().map((l) => `- \`${l.id}\` — ${l.name} (${l.shapes.length} shapes): ${l.description}`),
        "- `icons-list` — icon names · `edge-kinds` — relationship presets · `colors` — palette",
      ].join("\n");
    },
  });
}
