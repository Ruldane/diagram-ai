# MCP server

How agents connect to the app and how the tools are built. Prompts, resources and the Claude Code skill are in [agent-skill.md](agent-skill.md).

## Connecting a client

The endpoint is `POST /api/mcp` (Streamable HTTP, JSON responses, stateless). Start the app (`npm run dev`), then:

| Client | Command |
| --- | --- |
| Claude Code | `claude mcp add --transport http diagram-ai http://localhost:3000/api/mcp` |
| Codex | `codex mcp add diagram-ai --url http://localhost:3000/api/mcp/codex` (or `[mcp_servers.diagram-ai] url = "…"` in `~/.codex/config.toml`) |
| Cursor, VS Code, Gemini CLI | `{ "mcpServers": { "diagram-ai": { "url": "http://localhost:3000/api/mcp" } } }` |
| stdio-only clients | `npx -y mcp-remote http://localhost:3000/api/mcp` as the command |

`.mcp.json` at the repo root registers the server for Claude Code sessions started here. Check the connection with the `diagram_list` tool.

**Identity.** An agent is named from, in order: a URL segment (`/api/mcp/my-agent`) or `?agent=`, the `X-Agent-Name` header, the client name sent in `initialize` (remembered per User-Agent because the endpoint is stateless), then the User-Agent (`src/server/mcp/identity.ts`). The name and colour show on the canvas (agent pill, cursor, activity feed).

**Origin guard.** Browser pages cannot call the endpoint cross-site (`assertSameOrigin`); CLI clients send no `Origin` and pass.

## Anatomy

| File | Role |
| --- | --- |
| `src/app/api/mcp/[[...agent]]/route.ts` | builds a fresh `McpServer` + transport per request (isolation, nothing to lose on restart) |
| `src/server/mcp/server.ts` | `createMcpServer`: registers every tool; holds the connection `INSTRUCTIONS` |
| `src/server/mcp/toolkit.ts` | `registerTool` wrapper, annotations, error shaping |
| `src/server/mcp/schemas.ts` | shared zod input schemas (node, edge, layout, pagination) |
| `src/server/mcp/format.ts` | markdown outlines of diagrams, truncation (`CHARACTER_LIMIT`) |
| `src/server/mcp/tools/*.ts` | tools by theme: diagrams, elements, catalog, review (selection/comments), output |

The tool list is the product's API for agents; read the `description` strings in `tools/` rather than a copy here.

## Adding or changing a tool

1. Implement behaviour as a `DiagramService` method first ([server.md](server.md)); the tool only parses arguments and formats the result.
2. Register with `registerTool(server, ctx, { name, title, description, input, annotations, run })` in the matching file under `tools/`. Names are `diagram_<verb>_<noun>`.
3. **Descriptions are prompts.** Say what the tool does, when to use it, a concrete example call, and what it returns. Name the next step.
4. **Errors are instructions.** Return actionable text (`Error: unknown shape "x" — did you mean …`) and prefer warnings over failure for partial input, as `applySpec` does.
5. Set annotations honestly (`READ_ONLY`, `WRITE`, `IDEMPOTENT_WRITE`, `DESTRUCTIVE` from `toolkit.ts`).
6. `registerTool` updates agent presence and truncates oversized output for you; return `{ text, structured?, images? }` or a string.
7. Pagination (`limit`/`offset`, `has_more`) for anything list-like.

## Pull, not push

MCP clients call tools; the server cannot start a turn in an idle agent. Browser-side signals reach an agent only when it asks (`diagram_get_selection`, `diagram_list_comments`, `diagram_read`). For talking to an assistant from inside the app, see [assistant.md](assistant.md).

## Testing

`node scripts/mcp-smoke.mjs http://localhost:3000 [agent-name]` walks the whole surface against a running server (point it at a scratch server and `DIAGRAM_DATA_DIR`, see [testing.md](testing.md)). Unit-level tests build `createMcpServer` over an in-memory transport.
