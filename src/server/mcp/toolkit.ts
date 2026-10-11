import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, ZodError } from "zod";

import { formatIssues } from "@/core/model/schema";
import type { Actor } from "@/core/model/types";

import { ServiceError } from "../errors";
import type { Hub } from "../realtime/hub";
import type { DiagramService } from "../service";
import { limitText } from "./format";

export interface ToolContext {
  service: DiagramService;
  hub: Hub;
  /** The agent making the call. */
  actor: Actor;
  /** Origin of the web app, for links back to the canvas. */
  baseUrl: string;
}

export interface ToolOutput {
  text: string;
  /** Machine-readable result mirrored as `structuredContent`. */
  structured?: Record<string, unknown>;
  images?: { data: string; mimeType: string }[];
}

interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const IDEMPOTENT_WRITE: ToolAnnotations = { ...WRITE, idempotentHint: true };
export const DESTRUCTIVE: ToolAnnotations = { ...WRITE, destructiveHint: true };

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: Shape;
  annotations: ToolAnnotations;
  run: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<ToolOutput | string>;
}

/** Turns any failure into a tool error whose text tells the agent what to do next. */
function errorText(error: unknown): string {
  if (error instanceof ServiceError) return `Error: ${error.message}`;
  if (error instanceof ZodError) return `Error: invalid input — ${formatIssues(error)}`;
  console.error("[diagram-ai] MCP tool failed:", error);
  return `Error: ${error instanceof Error ? error.message : "unexpected failure"}. Nothing was changed; check the arguments and try again.`;
}

/**
 * Registers a tool with shared behaviour: the agent's presence is updated so
 * the canvas shows it working, errors become actionable tool errors, and
 * oversized responses are truncated.
 */
export function registerTool<Shape extends z.ZodRawShape>(server: McpServer, ctx: ToolContext, tool: ToolDefinition<Shape>): void {
  server.registerTool(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
    (async (args: z.infer<z.ZodObject<Shape>>) => {
      const diagramId = (args as { diagram_id?: unknown }).diagram_id;
      ctx.hub.touchAgent(ctx.actor, tool.name, typeof diagramId === "string" ? diagramId : undefined);
      try {
        const output = await tool.run(args, ctx);
        const result = typeof output === "string" ? { text: output } : output;
        return {
          content: [
            { type: "text" as const, text: limitText(result.text) },
            ...(result.images ?? []).map((image) => ({ type: "image" as const, ...image })),
          ],
          ...(result.structured ? { structuredContent: result.structured } : {}),
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: errorText(error) }] };
      }
    }) as never,
  );
}

export const diagramId = z.string().min(1).max(64).describe("Diagram id, from diagram_list or diagram_create.");
