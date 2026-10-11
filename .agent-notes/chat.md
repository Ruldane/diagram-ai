# chat agent — hand-off (stopped mid-bridge by the user, 2026-10-11)

Done: Claude-API assistant (Ask panel, NDJSON stream, tools via shared registry, 45+ tests), docs/assistant.md.
Mid-work, compiles and tests pass: Claude Code bridge under src/server/chat/bridge + engines (binary resolution,
child env stripping, gating, stream-json mapping, fixtures, UI picker/ack dialog).

Decisions from the user:
- NO Codex engine (policy risk). `engines/index.ts` no longer registers it. Still to DELETE: engines/codex.ts,
  bridge/codex-events.ts and its test cases, Codex branches in args.ts/binary.ts/child-env.ts/login.ts, request.ts,
  api/chat/status route, UI (AckDialog, AskPanel, EnginePicker, prefs, SetupCard), `ChatEngineId` in core/protocol.ts.
  Replace the Codex section of docs/assistant.md with: Codex is not bridged on purpose; use it in its own terminal with the MCP server.
- Claude Code bridge stays: own login, unmodified binary, loopback only, off in multi-user mode, ack dialog, never touch tokens.

Remaining: real `claude -p` run against a scratch server (init `mcp_servers` status, tools called); verify Windows
.cmd shim path; docs/assistant.md legal section + troubleshooting; .env.example vars (DIAGRAM_AI_CLAUDE_PATH,
DIAGRAM_AI_CLAUDE_MODEL, DIAGRAM_AI_LOCAL_AGENTS, DIAGRAM_AI_BRIDGE_WORKDIR).
Tests: `npx vitest run src/server/chat`. route.test.ts pins DIAGRAM_AI_LOCAL_AGENTS=off so an installed CLI is not the default.
