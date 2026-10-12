# Setup on a new machine

Runbook for an agent installing Diagram AI somewhere else. Every step ends on a check; move on once it passes.

## 0. What is not in git

| Not in the repo | Why | What to do |
| --- | --- | --- |
| `data/` (the diagrams) | git-ignored, belongs to the person running the app | Copy the folder over, or export each diagram as JSON from the UI and import it again |
| `.env.local` | holds machine-specific settings and keys | Re-create it from `.env.example` (step 3) |
| `node_modules/`, `.next/` | generated | `npm ci` |
| Docker volume `diagram-ai-pgdata` | the PostgreSQL data | `pg_dump` / `pg_restore` (see [database.md](database.md#backups)) |

Everything else (fonts, font metrics, shape and brand icon data, the skill in `.claude/skills/`, `.mcp.json`) is committed.

## 1. Prerequisites

| Need | Check | Notes |
| --- | --- | --- |
| Node.js 20.9 or newer | `node -v` | Next.js 16 minimum. LTS is fine. |
| npm | `npm -v` | Ships with Node. Use `npm ci`, the lockfile is committed. |
| Docker with Compose v2 | `docker compose version` | Only for PostgreSQL storage. Skip it to keep JSON files. |
| Claude Code CLI | `claude --version` | Only for the in-app Ask panel without an API key, and for using the MCP server from a terminal. |

## 2. Install and run (single machine, files)

```bash
git clone https://github.com/Ruldane/diagram-ai.git
cd diagram-ai
npm ci
npm run dev                         # http://localhost:3000, bound to 127.0.0.1
```

Check: `curl http://127.0.0.1:3000/api/health` answers `{"ok":true,"storage":"files","migrations":0}`.

Diagrams are JSON files in `./data` (`DIAGRAM_DATA_DIR` moves them). Use `npm run build && npm start` for a production run; `npm run dev:lan` binds `0.0.0.0` and exposes an app that has no login in this mode, so keep it for a trusted network.

## 3. Configuration

```bash
cp .env.example .env.local          # PowerShell: Copy-Item .env.example .env.local
```

Every variable is optional and commented in `.env.example`:

| Variable | Set it when |
| --- | --- |
| `DATABASE_URL` | You want PostgreSQL storage (step 4) |
| `DIAGRAM_DATA_DIR` | Diagrams should live outside `./data` |
| `ANTHROPIC_API_KEY`, `DIAGRAM_AI_MODEL` | The Ask panel should use the Claude API instead of the Claude Code CLI |
| `DIAGRAM_AI_LOCAL_AGENTS=off`, `DIAGRAM_AI_CLAUDE_PATH`, `DIAGRAM_AI_CLAUDE_MODEL`, `DIAGRAM_AI_BRIDGE_WORKDIR` | Tuning or disabling the Claude Code bridge ([assistant.md](assistant.md)) |

Restart `npm run dev` after editing `.env.local`.

## 4. PostgreSQL with Docker (optional)

```bash
npm run db:up                        # container diagram-ai-postgres on 127.0.0.1:5435, waits until healthy
echo "DATABASE_URL=postgres://diagram_ai:diagram_ai@127.0.0.1:5435/diagram_ai" >> .env.local
npm run dev
npm run db:import-files              # optional: copy ./data into the database
```

Checks:

1. The dev server logs `Storage: PostgreSQL at 127.0.0.1:5435/diagram_ai`.
2. `curl http://127.0.0.1:3000/api/health` answers `"storage":"postgres"` and `"migrations"` of at least 1.

The URL in `.env.example` is the credentials in `docker-compose.yml` (user, password and database `diagram_ai`, port 5435). Migrations run on first use; `npm run db:migrate` applies them by hand. Commands, backups, resetting and the schema are in [database.md](database.md).

Port 5435 busy: set `DIAGRAM_AI_PG_PORT=<port>` and change the port in `DATABASE_URL` to match. Never reuse another project's container.

The database does not add a login: on your own you keep drawing, using MCP and using the Ask panel without an account. Accounts, sharing and personal access tokens are a separate switch, `DIAGRAM_AI_AUTH=on` together with `DATABASE_URL` ([auth.md](auth.md)).

## 5. Connect an agent (MCP)

The endpoint is `http://localhost:3000/api/mcp`; a name after it (`/api/mcp/my-agent`) labels the agent on the canvas.

| Client | Command |
| --- | --- |
| Claude Code | Started inside this folder it reads `.mcp.json` automatically. Elsewhere: `claude mcp add --transport http diagram-ai http://localhost:3000/api/mcp` |
| Codex | `codex mcp add diagram-ai --url http://localhost:3000/api/mcp/codex` |
| Others | `{ "mcpServers": { "diagram-ai": { "url": "http://localhost:3000/api/mcp" } } }` |

Another port or host: change the URL everywhere above (and `.mcp.json`).

Check: with the app running, `npm run mcp:smoke` ends with `Done. Open http://localhost:3000/d/<id>`. In a client, list tools and expect `diagram_create`, `diagram_add_elements`, `diagram_preview`.

Install the skill for use from any project: copy `.claude/skills/diagram-ai` to `~/.claude/skills/` ([agent-skill.md](agent-skill.md)).

## 6. The Ask panel (in-app assistant)

It needs one of two engines; nothing else in the app depends on it.

| Engine | Setup | Check |
| --- | --- | --- |
| Claude Code (your plan) | Install the CLI, run `claude` once and sign in | `claude auth status` exits 0 |
| Claude API | `ANTHROPIC_API_KEY` in `.env.local` | The panel shows the engine as Ready |

The Claude Code engine only runs when the app is opened at `localhost` / `127.0.0.1` on the same machine, and is off when accounts are on (`DIAGRAM_AI_AUTH=on`), because your CLI login is for your own use. Policy, platform notes and troubleshooting: [assistant.md](assistant.md). Codex is not bridged on purpose; use it in its own terminal over MCP.

## 7. Verify the whole install

```bash
npm run typecheck && npm run lint && npm test
npm run test:db                      # only with the database running
```

The first line is green on a clean clone (checked on Windows with Node 24). Visual checks and galleries: [testing.md](testing.md).

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `EADDRINUSE :3000` | Another process holds the port. `npm run dev -- -p 3001`, then use that port in every MCP URL. |
| Agent connects but tools are missing | The URL must end in `/api/mcp` (or `/api/mcp/<name>`) and the app must be running. |
| `db:up` hangs or fails | Docker is not running, or the port is taken (`DIAGRAM_AI_PG_PORT`). |
| App starts but still shows file storage | `DATABASE_URL` is in `.env.local`, not `.env.example`; restart the dev server. |
| `tsconfig.json` shows extra `.next-*` includes | A scratch dev server (`NEXT_DIST_DIR=.next-x`) added them; delete the entries and the folder. |
| Tests about the skill or guide fail on a Windows clone | Files were checked out with CRLF. `.gitattributes` forces LF; re-checkout after pulling it (`git rm --cached -r . && git reset --hard`). |
| `Cannot find name 'PageProps'` / `'LayoutProps'` | Next generates those types. `npm run typecheck` runs `next typegen` first; running bare `tsc` on a clean clone needs `npx next typegen` once. |
| npm warns `install-scripts … unrs-resolver` | Harmless for this project; lint and tests pass without approving it. |
| `claude` not found by the Ask panel | Set `DIAGRAM_AI_CLAUDE_PATH` to the full path of `claude.exe` / `claude`. |
