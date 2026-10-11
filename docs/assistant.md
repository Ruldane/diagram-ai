# In-app assistant

The "Ask" side panel: a prompt box inside the editor whose replies edit the open diagram through the same tools MCP clients get. Read this before changing the tool set, the prompt or the stream protocol.

## How a request flows

1. `AskPanel` (`src/features/editor/chat/`) posts the conversation (text only), the person's current selection and viewport to `POST /api/diagrams/[id]/chat` (`src/app/api/diagrams/[id]/chat/route.ts`).
2. The route validates (`src/server/chat/request.ts`), claims the per-diagram run lock (`run-lock.ts`), and streams newline-delimited JSON `ChatStreamEvent`s (`stream.ts`).
3. `session.ts` builds the system prompt (`prompt.ts`) and the tool set (`tools.ts`), then `runner.ts` runs the tool-use loop: stream a turn, run the tools it asked for sequentially, send the results back, repeat until it answers without tools.
4. Tools run as actor `assistant` (`ASSISTANT_ACTOR`). Edits are ordinary agent edits: the canvas animates them, the agent pill and Activity feed show them, they land in Review and in undo history. There is no special casing anywhere else.

The browser keeps nothing it cannot lose: the transcript lives in `store.chat` (survives tab switches, not a reload) and the in-flight request in `actions.ts` (survives the panel unmounting).

## Setup and billing

`ANTHROPIC_API_KEY` in `.env.local`, then restart. `DIAGRAM_AI_MODEL` overrides the default (`claude-sonnet-5-5`, see `config.ts`). This is billed per use to an Anthropic API account, separately from a Claude Code or Claude.ai subscription; the panel says so and points to MCP as the subscription route. The key is read from `process.env` on the server only; `GET /api/chat/status` returns a boolean.

## The tool set

`createToolRegistry` (`src/server/mcp/registry.ts`) calls the same `registerDiagramToolset` that `createMcpServer` uses, with a collector standing in for `McpServer`. So a new tool added under `src/server/mcp/tools/` and registered there is available to the assistant with its validation, presence update, error formatting and truncation, and its zod shape becomes `input_schema` through `z.toJSONSchema(..., { io: "input" })` (`io: "input"` keeps parameters with defaults optional).

- Exclusions are `ASSISTANT_EXCLUDED_TOOLS` in `src/server/chat/tools.ts`: `diagram_delete` and `diagram_export`. A test fails if a name in the list stops existing, so a rename cannot silently re-enable one. Add a name there when a new tool should not be callable from a chat box.
- Many tools report failure as normal text starting with `Error:`. The runner and the step rows treat that as an error and set `is_error` on the result (`summary.ts`).
- Per-tool wording of the step rows lives in `src/server/chat/summary.ts` (once finished) and `src/features/editor/chat/tool-labels.ts` (while running). Unknown tools fall back to the first line of their result.

## Prompt and caching

- System prompt = MCP `INSTRUCTIONS` + a static "working inside the editor" block (cached) + a small dynamic block with the open diagram and selection (not cached).
- Render order is tools, system, messages, and a change anywhere invalidates what follows. Keep the tool order deterministic and never put timestamps or ids in the static block.
- A second breakpoint moves to the last block of the conversation each turn (`withCacheBreakpoint` in `runner.ts`), so turn N re-reads turn N-1. Assistant turns are appended exactly as received because thinking blocks must be passed back unchanged.
- The usage line separates `cachedTokens`. If it stays zero across turns, something in the prefix is changing.
- History sent by the browser is text only (no tool calls or thinking). That is why the prompt tells the model to `diagram_read` before editing anything it did not just draw.

## Model parameters

Adaptive thinking and `output_config.effort` (`CHAT_EFFORT`, `medium`) are only sent to models that accept them (`supportsEffort`); older models 400 on both. No `temperature` is sent (rejected on current models). Thinking text is not requested: the panel shows "Thinking…" instead.

## Limits

15 model turns per request (`MAX_TURNS`), 32k output tokens per turn, 40 messages / 10k characters per message / 60k in total, one run per diagram (a second request gets 409). Aborting the HTTP request aborts the model call and skips remaining tools. A tool call cut off by `max_tokens` is never executed.

## Stream protocol

`ChatStreamEvent` in `src/core/protocol.ts`, one JSON object per line: `text` deltas, `tool` (running, then done or error, same `id`), `usage`, `error`, and always a final `done`. Blank lines are heartbeats. A reply that ends without `done` is shown as an interrupted connection. Text of consecutive model turns is separated by a blank line, and each tool row records the text length at which it started so the panel can interleave steps with paragraphs.

## Errors

`describeChatError` (`src/server/chat/errors.ts`) maps missing key, 401, 403, 404 (bad model), 429, 529, other 5xx, billing, connection and cancellation to actionable messages. Unexpected errors are logged by name and message only and shown generically; nothing echoes the key or a stack.

## Testing without the API

- Unit tests inject a scripted client (`src/server/chat/testing.ts`); nothing touches the network.
- The Anthropic SDK honours `ANTHROPIC_BASE_URL`, so a scratch server can be pointed at a local stub that speaks the streaming Messages format and the whole path (route, SDK parsing, stream, panel) can be exercised in a browser with a dummy key.
- Not verified against the real API: request acceptance of `thinking` / `output_config` on the default model, and real cache hit rates.

## Not done

- Server-side refusal fallbacks (a refusal ends the run with a message).
- Eager tool-input streaming: tools only run on a completed block, so partial input would have no use.
- Conversations are not persisted across reloads, and there is no per-person rate limit: like every other endpoint it trusts whoever can reach the app (see README, "Limits worth knowing").

## Command

`assistant.open` (`mod+j`) opens the Ask panel and focuses the composer; `focus.ts` carries the request across the panel mounting. Escape in the composer stops a running reply, Enter sends, Shift+Enter adds a line.
