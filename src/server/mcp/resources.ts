import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { CATEGORIES, listDiagramTypes } from "@/core/catalog";
import { EDGE_KINDS } from "@/core/edges/kinds";
import { PALETTE } from "@/core/model/palette";
import { ICON_NAMES } from "@/core/shapes/icons";
import { getLibrary, listLibraries } from "@/core/shapes/registry";
import type { ShapeDef } from "@/core/shapes/types";

import { ServiceError } from "../errors";
import { describeDiagram, limitText, summaryLine } from "./format";
import { DRAWING_GUIDE } from "./guide";
import type { ToolContext } from "./toolkit";

/** MCP's code for "no such resource" (the SDK enum does not list it). */
const RESOURCE_NOT_FOUND = -32002;

const MARKDOWN = "text/markdown";

/** Most diagrams listed as individual resources; `diagram://diagrams` shows the same set as one document. */
const LIST_LIMIT = 100;

/** Elements shown per diagram resource before the text is cut off. */
const OUTLINE_LIMIT = 500;

/** Pseudo-libraries `diagram_list_shapes` also knows, served under `diagram://shapes/{library}`. */
const EXTRA_LIBRARIES = [
  { id: "edge-kinds", name: "Edge kinds", description: "Relationship presets for an edge's `kind`." },
  { id: "colors", name: "Colours", description: "Palette names for a node or edge `color`." },
  { id: "icons-list", name: "Icon names", description: "Names accepted by `icon` on icons/*, infra/* and ai/* shapes." },
] as const;

/** First value of a URI template variable, percent-decoded (left as is when malformed). */
function first(value: string | string[] | undefined): string {
  const raw = (Array.isArray(value) ? value[0] : value) ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Failures are protocol errors whose message says what to do next. */
function failure(error: unknown): never {
  if (error instanceof McpError) throw error;
  if (error instanceof ServiceError) {
    throw new McpError(error.code === "not_found" ? RESOURCE_NOT_FOUND : ErrorCode.InvalidParams, error.message);
  }
  throw error;
}

function shapeLine(shape: ShapeDef): string {
  const aliases = shape.aliases?.length ? ` · aliases: ${shape.aliases.slice(0, 5).join(", ")}` : "";
  const container = shape.container ? " · container" : "";
  const data = shape.data && Object.keys(shape.data).length ? ` · data: ${JSON.stringify(shape.data)}` : "";
  return `- \`${shape.id}\` — ${shape.name}${shape.description ? `: ${shape.description}` : ""}${aliases}${container}${data}`;
}

function typesDocument(): string {
  const all = listDiagramTypes();
  const lines = [
    "# Diagram types",
    "",
    `${all.length} types. Pass the id as \`type\` to diagram_create. diagram_list_types with a \`query\` returns the full "how to draw" guide for a type; "generic" means it is drawn with general-purpose shapes.`,
  ];
  for (const category of CATEGORIES) {
    const types = all.filter((type) => type.category === category.id);
    if (!types.length) continue;
    lines.push("", `## ${category.name}`, category.description, "");
    for (const type of types) {
      lines.push(`- \`${type.id}\` — ${type.name}${type.support === "generic" ? " (generic)" : ""}: ${type.description}`);
    }
  }
  return lines.join("\n");
}

function shapeIndexDocument(): string {
  return [
    "# Shape libraries",
    "",
    "Read `diagram://shapes/{library}` for the shapes of one library. A node's `shape` accepts a full id (`flowchart/decision`), a short name (`decision`) or an alias (`postgres`).",
    "",
    ...listLibraries().map((library) => `- \`${library.id}\` — ${library.name} (${library.shapes.length} shapes): ${library.description}`),
    ...EXTRA_LIBRARIES.map((extra) => `- \`${extra.id}\` — ${extra.name}: ${extra.description}`),
  ].join("\n");
}

function libraryDocument(id: string): string | undefined {
  if (id === "edge-kinds") {
    return ["# Edge kinds", "", "Use as `kind` on an edge.", "", ...Object.entries(EDGE_KINDS).map(([name, kind]) => `- \`${name}\` — ${kind.description}`)].join("\n");
  }
  if (id === "colors") {
    return ["# Colours", "", "Use as `color` on a node or edge.", "", ...Object.entries(PALETTE).map(([name, swatch]) => `- \`${name}\` — fill ${swatch.fill}, stroke ${swatch.stroke}`)].join("\n");
  }
  if (id === "icons-list") {
    return ["# Icon names", "", "Use as `icon` on icons/*, infra/* and ai/* shapes.", "", ICON_NAMES.join(", ")].join("\n");
  }
  const library = getLibrary(id);
  if (!library) return undefined;
  return [`# ${library.name} (\`${library.id}\`)`, "", library.description, "", `${library.shapes.length} shapes:`, "", ...library.shapes.map(shapeLine)].join("\n");
}

/** MCP resources: read-only documents agents can attach to a conversation. */
export function registerResources(server: McpServer, ctx: ToolContext): void {
  const document = (uri: URL, text: string) => ({ contents: [{ uri: uri.href, mimeType: MARKDOWN, text }] });

  server.registerResource(
    "guide",
    "diagram://guide",
    {
      title: "Drawing guide",
      description: "How to use the Diagram AI tools well: workflow, choosing a type, node and edge conventions, layout, a preview checklist and what not to do.",
      mimeType: MARKDOWN,
    },
    (uri) => document(uri, DRAWING_GUIDE),
  );

  server.registerResource(
    "diagram-types",
    "diagram://types",
    {
      title: "Diagram types",
      description: "Every diagram type id with its category and a one-line description, for choosing the `type` of diagram_create.",
      mimeType: MARKDOWN,
    },
    (uri) => document(uri, typesDocument()),
  );

  server.registerResource(
    "shape-libraries",
    "diagram://shapes",
    {
      title: "Shape libraries",
      description: "The shape libraries with their sizes, plus the edge-kind, colour and icon vocabularies.",
      mimeType: MARKDOWN,
    },
    (uri) => document(uri, shapeIndexDocument()),
  );

  server.registerResource(
    "shape-library",
    new ResourceTemplate("diagram://shapes/{library}", {
      list: () => ({
        resources: [
          ...listLibraries().map((library) => ({
            uri: `diagram://shapes/${library.id}`,
            name: `shapes-${library.id}`,
            title: `${library.name} shapes`,
            description: `${library.shapes.length} shapes: ${library.description}`,
            mimeType: MARKDOWN,
          })),
          ...EXTRA_LIBRARIES.map((extra) => ({
            uri: `diagram://shapes/${extra.id}`,
            name: `shapes-${extra.id}`,
            title: extra.name,
            description: extra.description,
            mimeType: MARKDOWN,
          })),
        ],
      }),
      complete: {
        library: (value) => [...listLibraries().map((library) => library.id), ...EXTRA_LIBRARIES.map((extra) => extra.id)].filter((id) => id.startsWith(value)),
      },
    }),
    {
      title: "Shapes of one library",
      description: "Every shape of one library with its id, purpose, aliases and parameters. Library ids are listed in diagram://shapes.",
      mimeType: MARKDOWN,
    },
    (uri, variables) => {
      const id = first(variables.library);
      const text = libraryDocument(id);
      if (text === undefined) {
        const known = [...listLibraries().map((library) => library.id), ...EXTRA_LIBRARIES.map((extra) => extra.id)];
        throw new McpError(RESOURCE_NOT_FOUND, `Unknown shape library "${id}". Libraries: ${known.join(", ")}. Read diagram://shapes for the index.`);
      }
      return document(uri, text);
    },
  );

  server.registerResource(
    "diagrams",
    "diagram://diagrams",
    {
      title: "Diagrams",
      description: "The diagrams in the workspace, most recently updated first, with ids, types, sizes and URLs.",
      mimeType: MARKDOWN,
    },
    async (uri) => {
      const all = await ctx.service.list();
      const shown = all.slice(0, LIST_LIMIT);
      const text = all.length
        ? [
            `# Diagrams (${all.length}${shown.length < all.length ? `, showing the ${shown.length} most recent` : ""})`,
            "",
            ...shown.map((summary) => summaryLine(summary, ctx.baseUrl)),
            "",
            "Read `diagram://diagram/{id}` for the outline of one, or use diagram_read.",
          ].join("\n")
        : "# Diagrams\n\nThe workspace is empty. Create one with diagram_create.";
      return document(uri, text);
    },
  );

  server.registerResource(
    "diagram",
    new ResourceTemplate("diagram://diagram/{id}", {
      list: async () => {
        const all = await ctx.service.list();
        return {
          resources: all.slice(0, LIST_LIMIT).map((summary) => ({
            uri: `diagram://diagram/${summary.id}`,
            name: summary.id,
            title: summary.name,
            description: `${summary.type} · ${summary.nodeCount} nodes, ${summary.edgeCount} edges${summary.openComments ? `, ${summary.openComments} open comments` : ""}`,
            mimeType: MARKDOWN,
          })),
        };
      },
      complete: {
        id: async (value) => {
          const q = value.toLowerCase();
          const all = await ctx.service.list();
          return all
            .filter((summary) => !q || summary.id.toLowerCase().startsWith(q) || summary.name.toLowerCase().includes(q))
            .map((summary) => summary.id)
            .slice(0, 20);
        },
      },
    }),
    {
      title: "Diagram outline",
      description: "The current nodes, edges and open comments of one diagram: the same outline diagram_read returns.",
      mimeType: MARKDOWN,
    },
    async (uri, variables) => {
      try {
        const id = first(variables.id);
        const doc = await ctx.service.get(id);
        const { review } = await ctx.service.reviewState(id);
        const outline = describeDiagram(doc, ctx.baseUrl, { limit: OUTLINE_LIMIT, offset: 0, review });
        return document(uri, limitText(outline, "Use diagram_read with ids, limit and offset to page through the rest."));
      } catch (error) {
        return failure(error);
      }
    },
  );
}
