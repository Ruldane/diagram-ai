import type Anthropic from "@anthropic-ai/sdk";

import { createToolRegistry, type RegisteredTool, type ToolResult } from "../mcp/registry";
import type { ToolContext } from "../mcp/toolkit";

/**
 * Tools external agents get that the in-app assistant does not: deleting a
 * whole diagram is not something to do from a chat box, and `diagram_export`
 * writes files on the server (the Export dialog does that job for people).
 */
export const ASSISTANT_EXCLUDED_TOOLS: readonly string[] = ["diagram_delete", "diagram_export"];

export interface AssistantToolset {
  /** Tool definitions for the model, in a stable order so the cached prompt prefix stays valid. */
  definitions: Anthropic.Tool[];
  /** Runs a tool call from the model. Unknown or excluded names and bad input come back as error results. */
  run(name: string, input: unknown): Promise<ToolResult>;
}

const errorResult = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] });

export function toToolDefinition(tool: RegisteredTool): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: { ...tool.inputSchema, type: "object" },
  };
}

export function createAssistantToolset(ctx: ToolContext): AssistantToolset {
  const excluded = new Set(ASSISTANT_EXCLUDED_TOOLS);
  const tools = createToolRegistry(ctx).filter((tool) => !excluded.has(tool.name));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    definitions: tools.map(toToolDefinition),
    async run(name, input) {
      const tool = byName.get(name);
      if (!tool) {
        const hint = excluded.has(name) ? " It is not available in the in-app assistant; tell the user how to do it themselves instead." : "";
        return errorResult(`Error: there is no tool named "${name}".${hint}`);
      }
      return tool.call(input);
    },
  };
}
