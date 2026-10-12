# Server

`DiagramService`, the realtime hub, storage and the HTTP surface under `src/server/` and `src/app/api/`.

## `DiagramService` (`src/server/service.ts`)

The only place diagrams change. REST handlers and MCP tools are thin adapters over its methods, so a person in the browser and an agent go through the same rules.

- **Locking.** `withLock(id, task)` serialises changes per diagram; every mutating method uses it. Never call the repository's `save` from outside the service.
- **`apply`** (private) is the single write path: integrity completion → `applyPatch` → version bump → `repo.save` → publish `patch` → optional activity entry. A no-op patch publishes nothing.
- **Agent-friendly methods**: `applyElements` (spec → patch → placement), `buildSequence`, `layout`, `remove`, comments, snapshots, `export`, `preview`, `importDiagram`. They take an `Actor`, which decides how the browser animates the result.
- **Placement.** `applyElements` runs a full layout while the diagram is still machine-arranged (`settings.autoLayout`), otherwise `placeNear` puts new nodes beside their neighbours.

## Realtime hub (`src/server/realtime/hub.ts`)

In-process pub/sub plus ephemeral state: SSE listeners per diagram and for the workspace, an activity ring buffer (200 entries), per-tab presence (selection, viewport), and agent status (`working` for a few seconds after each tool call).

Single-process assumption: a second server instance would not see the first's events. The path to scaling out is Postgres `LISTEN/NOTIFY` behind this class's interface ([database.md](database.md)).

## Process-wide state (`src/server/context.ts`)

Next dev reloads modules and compiles routes separately, so plain-data state (maps, pools) lives on `globalThis` and the classes (`Hub`, `DiagramService`, repositories) are created fresh from it on every `getContext()`. A class instance cached on `globalThis` would keep running stale code after an edit.

## HTTP surface

| Route | Purpose |
| --- | --- |
| `GET/POST /api/diagrams`, `GET/DELETE /api/diagrams/[id]` | list, create, read, delete |
| `POST …/[id]/ops` | browser patches |
| `GET …/[id]/events` | SSE: `hello`, `patch`, `activity`, `agent`, `peer`, `peer-left`, `highlight`, `reset`, `deleted` |
| `POST …/[id]/presence`, `…/layout` | selection/viewport/pointer (shown to others as `peer` events); computed layout patch (not saved) |
| `…/[id]/snapshots[/id]`, `…/duplicate`, `…/export`, `…/thumbnail` | checkpoints, copy, server-rendered files, gallery PNG |
| `POST /api/import`, `GET /api/events` | create from JSON/draw.io/Mermaid; workspace SSE |
| `/api/auth/*`, `/api/admin/users`, `…/[id]/members`, `…/[id]/share`, `/api/share/redeem` | accounts, tokens, members, share links (accounts on; [auth.md](auth.md)) |
| `POST /api/mcp/[[...agent]]` | MCP endpoint ([mcp.md](mcp.md)) |

## Adding an endpoint

1. Add or reuse a `DiagramService` method; keep business rules there.
2. Create `src/app/api/.../route.ts`; wrap handlers with `route()` from `src/server/http.ts` (maps `ServiceError` and zod errors to JSON), validate bodies with zod, call `assertSameOrigin(request)` on anything that mutates.
3. Throw `ServiceError` (`src/server/errors.ts`) for expected failures with a message a user or agent can act on.
4. Streaming: `eventStream()` in `http.ts` handles heartbeat and cleanup.

## Security model

No accounts in solo mode (the default, files or PostgreSQL): whoever can reach the server can edit. `assertSameOrigin` blocks cross-site browser requests (a web page cannot drive the local app); requests without an `Origin` header (CLI agents, curl) pass. Input is validated at every boundary with the schemas in `src/core/model/schema.ts` (ids are path-safe, colours normalised, links limited to http(s)/mailto/relative).

With accounts on (`authEnabled()`: `DIAGRAM_AI_AUTH=on` and `DATABASE_URL`) every route starts with `requestContext(request)` from `src/server/auth/request.ts` and uses the service and hub it returns: they are wrapped so a call is checked against the caller's role on the diagram. Use it in any new route and never call `getService()` / `getContext()` from `src/app/api`; `src/server/auth/routes.test.ts` fails otherwise. Rules, credentials and the checklist: [auth.md](auth.md).

## Storage

`DiagramRepository` (`src/server/store/repository.ts`) is the seam: `FileRepository` writes JSON under `DIAGRAM_DATA_DIR` (default `./data`) with coalesced atomic writes; the PostgreSQL implementation is described in [database.md](database.md).
