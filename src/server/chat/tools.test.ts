import { describe, expect, it } from "vitest";

import { createToolRegistry } from "../mcp/registry";
import type { ToolContext } from "../mcp/toolkit";
import { ASSISTANT_EXCLUDED_TOOLS, toToolDefinition } from "./tools";

// Registering a tool does not touch the context, so a stub is enough to inspect definitions.
const registry = createToolRegistry({} as ToolContext);

describe("tool registry", () => {
  it("exposes the whole MCP tool surface", () => {
    const names = registry.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(21);
    for (const expected of ["diagram_create", "diagram_add_elements", "diagram_preview", "diagram_get_selection", "diagram_delete", "diagram_export"]) {
      expect(names).toContain(expected);
    }
  });

  it("converts every input shape to a valid JSON Schema object", () => {
    for (const tool of registry) {
      const schema = tool.inputSchema;
      expect(schema.type, tool.name).toBe("object");
      expect(schema.properties, tool.name).toBeTypeOf("object");
      expect(schema, tool.name).not.toHaveProperty("$schema");
      for (const required of schema.required ?? []) expect(Object.keys(schema.properties ?? {}), `${tool.name}.${required}`).toContain(required);
      // Plain data, so it can be sent as JSON.
      expect(JSON.parse(JSON.stringify(schema)), tool.name).toEqual(schema);
    }
  });

  it("keeps parameters with defaults optional", () => {
    const read = registry.find((tool) => tool.name === "diagram_read")!;
    expect(read.inputSchema.required).toEqual(["diagram_id"]);
    const add = registry.find((tool) => tool.name === "diagram_add_elements")!;
    expect(add.inputSchema.required).toEqual(["diagram_id"]);
  });

  it("builds model tool definitions with a name, a description and an input schema", () => {
    for (const tool of registry) {
      const definition = toToolDefinition(tool);
      expect(definition.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(definition.description?.length ?? 0).toBeGreaterThan(20);
      expect(definition.input_schema.type).toBe("object");
    }
  });

  it("only excludes tools that exist, so a rename cannot silently re-enable one", () => {
    const names = new Set(registry.map((tool) => tool.name));
    expect(ASSISTANT_EXCLUDED_TOOLS).toEqual(["diagram_delete", "diagram_export"]);
    for (const excluded of ASSISTANT_EXCLUDED_TOOLS) expect(names.has(excluded), excluded).toBe(true);
  });

  it("validates input like the MCP transport and reports problems as tool errors", async () => {
    const create = registry.find((tool) => tool.name === "diagram_create")!;
    const result = await create.call({ name: 42 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("invalid input");
  });
});
