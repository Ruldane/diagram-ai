import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { APP_VERSION, MCP_SERVER_NAME } from "../config";
import type { ToolContext } from "./toolkit";
import { registerPrompts } from "./prompts";
import { registerResources } from "./resources";
import { registerCatalogTools } from "./tools/catalog";
import { registerDiagramTools } from "./tools/diagrams";
import { registerElementTools } from "./tools/elements";
import { registerOutputTools } from "./tools/output";
import { registerReviewTools } from "./tools/review";
import { registerReviewStatusTools } from "./tools/review-status";

/** Sent to the agent at connection time: the workflow that produces good diagrams. */
export const INSTRUCTIONS = `Diagram AI is a live diagramming canvas. Everything you do here appears instantly in the user's browser, so they can watch you draw and edit alongside you.

Recommended workflow
1. Find or create: diagram_list to locate an existing diagram, or diagram_create with the right type (diagram_list_types to choose). Share the returned URL with the user.
2. Read before editing: diagram_read shows current nodes, edges and open comments. The user may have changed things by hand.
3. Draw: diagram_add_elements with nodes (give each a short id) and edges that reference those ids. Do not compute coordinates — omit x/y and the layout engine arranges and routes everything. Use containers (parent) to group related nodes. For sequence diagrams use diagram_build_sequence.
4. Look: diagram_preview returns a picture of the result. Check it and fix overlaps, long labels or confusing structure with diagram_update_elements / diagram_layout.
5. Collaborate: diagram_get_selection tells you what the user means by "this"; diagram_list_comments shows their review notes; diagram_highlight points at things; diagram_add_comment asks a question in context. diagram_checkpoint before big rewrites.
6. Deliver: diagram_export for SVG, PNG, PDF, PPTX, draw.io, Mermaid or JSON.

Conventions
- Shapes accept ids ("flowchart/decision"), short names ("decision") or aliases ("postgres", "lambda", "agent"). diagram_list_shapes lists them.
- Edge \`kind\` sets notation: flow, dashed, inheritance, implementation, composition, aggregation, dependency, one-to-many, message, async, return…
- \`color\` takes a palette name: default, gray, blue, teal, green, yellow, orange, red, pink, purple, dark.
- Labels: "\\n" for line breaks; a line with only "---" separates compartments (class name / attributes / methods; table name / columns).
- Keep labels short (2–5 words); put detail in a second line or a note.`;

/** Every diagram tool. The in-app assistant registers the same set through `registry.ts`. */
export function registerDiagramToolset(server: McpServer, ctx: ToolContext): void {
  registerDiagramTools(server, ctx);
  registerElementTools(server, ctx);
  registerCatalogTools(server, ctx);
  registerReviewTools(server, ctx);
  registerReviewStatusTools(server, ctx);
  registerOutputTools(server, ctx);
}

/**
 * Builds an MCP server instance bound to one request's context. The endpoint
 * is stateless, so a fresh instance per request keeps callers isolated.
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: APP_VERSION }, { instructions: INSTRUCTIONS });
  registerDiagramToolset(server, ctx);
  registerPrompts(server, ctx);
  registerResources(server, ctx);
  return server;
}
