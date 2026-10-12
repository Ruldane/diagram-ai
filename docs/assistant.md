# In-app assistant

The "Ask" side panel: a prompt box inside the editor whose replies edit the open diagram through the same tools MCP clients get. Read this before changing an engine, the tool set, the prompt or the stream protocol.

## Engines

| Engine | Id | Needs | Billed to |
| --- | --- | --- | --- |
| Claude Code (default when usable) | `claude-code` | the `claude` CLI installed and signed in, app opened at localhost, single-user mode | the person's own Claude plan |
| Claude API | `claude-api` | `ANTHROPIC_API_KEY` in `.env.local` | the Anthropic API account of the key |

`GET /api/chat/status` returns each engine with `available`, a `reason` (safe to show), `billing`, `authMethod`, and `default` (the first available, in the order above). The request's `engine` picks one; without it the default is used. The panel shows a picker with status chips and reasons, remembers the choice and the acknowledgement in `localStorage` (`prefs.ts`), and shows setup steps for whichever selected engine cannot answer (`SetupCard.tsx`: the API-key steps only for the API engine). Both engines implement `Engine` (`src/server/chat/engines/types.ts`); a new one is registered in `engines/index.ts` and given its status and `run`.

## How a request flows

1. `AskPanel` (`src/features/editor/chat/`) posts the conversation (text only), the selection, the viewport, the engine and, for a CLI engine, `sessionId` and `workdir` to `POST /api/diagrams/[id]/chat`.
2. The route validates (`request.ts`), applies the gates below for local engines, claims the per-diagram run lock (`run-lock.ts`) and streams newline-delimited JSON `ChatStreamEvent`s (`stream.ts`).
3. The engine's `run` emits events. The API engine runs the tool loop in-process (`session.ts`, `runner.ts`); the Claude Code engine starts the CLI, which calls the same tools over MCP.
4. Edits are ordinary agent edits (actor `assistant`, or `claude-code` over MCP): the canvas animates them, the agent pill and Activity show them, they land in Review and undo history.

The browser keeps the transcript in `store.chat` (survives tab switches, not a reload) and the request in `actions.ts`. `ChatStreamEvent` has `text`, `tool` (running, then done or error, same `id`), `usage`, `error`, `session`, `diagnostic` (the engine's own note, e.g. whether the tools connected) and always a final `done`; blank lines are heartbeats.

## Claude Code engine

`engines/claude-code.ts` and `bridge/`. Never reads, copies, stores or logs a token or credential file, and offers no sign-in.

- **Command**: `claude -p --output-format stream-json --verbose --include-partial-messages --disable-slash-commands --setting-sources "" --strict-mcp-config --mcp-config <file> --permission-mode dontAsk --allowedTools mcp__diagram-ai__* --disallowedTools <delete, export> --tools "" --max-turns 20 --session-id <uuid>` (`--resume <uuid>` afterwards), brief via `--append-system-prompt`. The prompt goes on stdin. Never `--bare` (it ignores a subscription login) and never a permission-bypass flag. `buildClaudeArgs` is snapshot-tested.
- **Tools**: the MCP config points only at `<origin>/api/mcp/claude-code` (`alwaysLoad`). The `init` event's `mcp_servers` status must be `connected`; otherwise the run is stopped with a message (`claude-events.ts`).
- **Isolation**: no settings files (their allow rules, hooks, plugins and `env` would widen what a run may do; verified that a user-level `Read` allow rule otherwise lets it read any file), no skills, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` added to the environment.
- **Working folder** (optional): the panel's field becomes the CLI's cwd and `Read/Glob/Grep(//abs/path/**)` allow rules (`folderReadRules`); reads elsewhere are refused (verified, including `~/.claude/settings.json`). A path with characters a rule cannot hold gets no file tools and a diagnostic. Files are never written.
- **Environment**: the child gets this process's environment minus `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY`, `CLAUDE_CODE_SIMPLE`, `CLAUDE_CONFIG_DIR` (matched case-insensitively), so a key in `.env.local` never turns a plan run into an API run.
- **Login**: only `claude auth status` (JSON `loggedIn`, `authMethod`), cached 30 s. An `api_key` method is reported as API billing.
- **Binary** (`binary.ts`): `DIAGRAM_AI_CLAUDE_PATH`, well-known install folders, then `PATH`. On Windows a real `.exe` wins over a `.cmd`, and an npm `.cmd` shim is unwrapped to the package's own `claude.exe`. A shim that cannot be unwrapped runs through `cmd.exe` only with arguments from a fixed character set (`quoteForCmd` refuses anything else), the brief moved onto stdin.
- **Sessions**: the first message gets a UUID, the `session` event returns it, the browser sends it back and the next run uses `--resume`. Without a session the earlier messages are put in the prompt (capped).
- **Stopping**: abort (Escape, closed tab) and the 10-minute timeout (`DIAGRAM_AI_BRIDGE_TIMEOUT_MS`) kill the whole tree (`taskkill /pid <pid> /T /F` on Windows, the process group elsewhere); children also die with the server.
- **Output**: UTF-8, BOM and CRLF tolerated, partial lines buffered (`LineSplitter`). An exit code without a `result` line is never read as success.
- **Gates** (`bridge/gating.ts`): off with `DIAGRAM_AI_LOCAL_AGENTS=off`; off whenever accounts are on (`DIAGRAM_AI_AUTH=on` with `DATABASE_URL`; PostgreSQL storage alone does not count) and not overridable; the request's Host must be `localhost`, `127.0.0.1` or `[::1]` with no forwarding headers naming another machine; the `x-diagram-ai-bridge-ack` header must carry `claude-code:<version>` of the notice in `src/core/chat-terms.ts` (the dialog and the server read the same constant; bump the version when the wording changes).

## Codex

Codex is not bridged, on purpose. OpenAI's documentation recommends an API key for programmatic use and does not address third-party apps that wrap the CLI. Use Codex in its own terminal with this app's MCP server ([mcp.md](mcp.md)).

## Legal and policy

Not legal advice; terms change, so read the sources. As understood when this was built: Anthropic permits the unmodified `claude` binary, used with the person's own login on their own machine. This app therefore starts that binary and nothing else, never touches the login, is local-only (loopback Host, not behind a proxy), is off when accounts exist, and shows the acknowledgement above. It is for personal, non-commercial use: do not share a login, expose the app to a network, or build a service on it. Other uses need an API key (the Claude API engine).
Sources: [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Run Claude Code programmatically](https://code.claude.com/docs/en/headless), [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview), [Consumer terms](https://www.anthropic.com/legal/consumer-terms).

## Platform notes

- **Windows**: `claude.exe` from the native installer (`~/.local/bin`) or the npm package; `claude.cmd` is unwrapped. The CLI keeps sessions under `~/.claude/projects` for the working folder.
- **macOS and Linux**: `~/.local/bin/claude`, Homebrew, npm-global and Volta locations are searched, then `PATH`. A GUI-launched server may lack your shell's `PATH`: set `DIAGRAM_AI_CLAUDE_PATH`.
- Default working folder is `<data dir>/bridge/workdir` (empty, created on demand; `DIAGRAM_AI_BRIDGE_WORKDIR` overrides).

## Troubleshooting

| What you see | Why | Do |
| --- | --- | --- |
| "Claude Code was not found" | not installed, or not where the app looks | install it, or set `DIAGRAM_AI_CLAUDE_PATH` |
| "Not signed in" | `claude auth status` says logged out; a custom `CLAUDE_CONFIG_DIR` is ignored by design | run `claude` in a terminal and sign in |
| "only work when this app is opened at http://localhost" | opened by LAN address, hostname or through a proxy | open `http://localhost:<port>` on this computer |
| "Not available when accounts and sharing are enabled" | `DIAGRAM_AI_AUTH=on` with `DATABASE_URL` | use the Claude API engine, or turn accounts off to use the CLI bridge |
| "could not reach the app's tool server" | the CLI could not call `/api/mcp/claude-code` at the address you opened | open the app at the address the server listens on; check firewalls |
| "was not allowed to use: Read" | a folder was set and the model tried a path outside it | expected; ask about files inside the folder |
| "stopped: …limit reached" | the plan's usage window is used up | wait, or use the API engine |

## Residual risk

`next dev` used to listen on all interfaces. `npm run dev` now passes `-H 127.0.0.1`; `npm run dev:lan` restores `0.0.0.0` (needed to reach the app from other devices; with accounts on the bridge is off anyway). `next start` still listens on all interfaces: use `next start -H 127.0.0.1` with the bridge. The Host gate stops other machines from driving the CLI, but anything on this computer can reach the app, the same as it can run `claude` itself.

## Claude API engine details

- `ANTHROPIC_API_KEY` is read from `process.env` on the server only; `DIAGRAM_AI_MODEL` overrides `claude-sonnet-5-5`. Adaptive thinking and `output_config.effort` are sent only to models that accept them (`supportsEffort`); no `temperature`.
- `createToolRegistry` (`src/server/mcp/registry.ts`) reuses `registerDiagramToolset`, so a tool added under `src/server/mcp/tools/` is available here with validation and truncation; its zod shape becomes `input_schema`. `ASSISTANT_EXCLUDED_TOOLS` (`tools.ts`, also applied to the CLI) holds `diagram_delete` and `diagram_export`; a test fails if a name goes stale.
- Many tools report failure as text starting `Error:`; the runner and `summary.ts` set `is_error` for those.
- System prompt = MCP `INSTRUCTIONS` + the editor brief (cached) + a dynamic block for the open diagram and selection. A second cache breakpoint follows the last block each turn; keep tool order deterministic and no ids or timestamps in the static block. History from the browser is text only, so the prompt says to `diagram_read` first.
- Limits: 15 model turns, 32k output tokens per turn, 40 messages / 10k characters each / 60k total, one run per diagram (409). `describeChatError` maps key, 401/403/404/429/529, billing and connection failures to actionable text.

## Testing

- Unit tests inject a scripted client (`testing.ts`); nothing touches the network. A stub on `ANTHROPIC_BASE_URL` can exercise the API path in a browser.
- `bridge/fixtures/claude-real-*.jsonl` are transcripts captured from Claude Code 2.1.296 (first turn, `--resume`, refused reads); `events.test.ts` maps them. `engines/claude-code.test.ts` drives the real engine against `fixtures/fake-claude.mjs` (a `.cmd` on Windows, so the shim path runs), including abort killing a grandchild.
- Not verified: the API engine against the real API (thinking and `output_config` acceptance, cache hit rates); macOS and Linux runs of the CLI (the same code paths run in tests with a stand-in).
- Not done: refusal fallbacks, persistence of conversations across reloads, per-person rate limits (the app trusts whoever can reach it).

`assistant.open` (`mod+j`) opens the panel and focuses the composer; Escape stops a running reply, Enter sends, Shift+Enter adds a line.
