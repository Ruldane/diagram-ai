import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { formatIssues } from "@/core/model/schema";

import { registerDiagramToolset } from "./server";
import type { ToolContext } from "./toolkit";

export type ToolResultBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** What a tool returns, in the shape the MCP transport would send. */
export interface ToolResult {
  content: ToolResultBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface JsonObjectSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface RegisteredTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  /** JSON Schema of the input. Parameters with defaults are optional, as the caller may omit them. */
  inputSchema: JsonObjectSchema;
  /** Validates `args` like the MCP transport does (defaults applied), then runs the tool. Never throws for bad input. */
  call(args: unknown): Promise<ToolResult>;
}

interface ToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape;
  annotations?: { readOnlyHint?: boolean };
}

type ToolHandler = (args: unknown, extra: unknown) => Promise<ToolResult>;

/** `z.toJSONSchema` of a tool's input shape, as the `input_schema` of a model tool definition. */
export function toInputSchema(shape: z.ZodRawShape): JsonObjectSchema {
  const schema = z.toJSONSchema(z.object(shape), { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return { ...schema, type: "object" };
}

/**
 * The diagram tools without an MCP transport: each entry can be called
 * directly with the same validation, presence updates, error formatting and
 * truncation an MCP client gets, because the tools are registered through the
 * same `registerTool` wrapper. Used by the in-app assistant.
 */
export function createToolRegistry(ctx: ToolContext): RegisteredTool[] {
  const tools: RegisteredTool[] = [];

  // The register functions only use `registerTool`, so a collector stands in for the server.
  const collector = {
    registerTool(name: string, config: ToolConfig, handler: ToolHandler): void {
      const shape = config.inputSchema ?? {};
      const schema = z.object(shape);
      tools.push({
        name,
        title: config.title ?? name,
        description: config.description ?? "",
        readOnly: config.annotations?.readOnlyHint ?? false,
        inputSchema: toInputSchema(shape),
        async call(args) {
          const parsed = schema.safeParse(args ?? {});
          if (!parsed.success) {
            return { isError: true, content: [{ type: "text", text: `Error: invalid input — ${formatIssues(parsed.error)}` }] };
          }
          return handler(parsed.data, {});
        },
      });
    },
  };

  registerDiagramToolset(collector as unknown as McpServer, ctx);
  return tools;
}
