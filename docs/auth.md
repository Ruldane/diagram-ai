# Accounts, sharing and presence

Who may open and change a diagram, and how people see each other on one. Code lives in `src/server/auth/` (rules, wrappers), `src/core/auth.ts` (roles, shared types) and `src/features/auth/` (sign-in pages, account menu).

## Two modes

Accounts are **opt-in**. Where diagrams are stored (files or PostgreSQL) and who may open them are independent switches, so working alone, with MCP and an assistant, never needs a login, database or not.

| Mode | When | Behaviour |
| --- | --- | --- |
| **Solo** (default) | `DIAGRAM_AI_AUTH` not `on`, or no `DATABASE_URL` | No login, no account menu, MCP without a token, the Ask panel and the Claude Code bridge work. Diagrams are ownerless and open to whoever reaches the app, in files or in PostgreSQL alike. `/login`, `/signup`, `/account` and `/s/<token>` say "Accounts are off". Presence (cursors, avatars) works. |
| **Accounts** | `DIAGRAM_AI_AUTH=on` **and** `DATABASE_URL` | Accounts required. Roles, sessions, tokens and share links are enforced. `authEnabled()` in `src/server/config.ts` is the one switch; `DIAGRAM_AI_AUTH=on` without a database logs a warning and stays solo. |

| Variable | Default | Meaning |
| --- | --- | --- |
| `DIAGRAM_AI_AUTH` | off | `on`, `1`, `true` or `yes` turns accounts on (needs `DATABASE_URL`). |
| `DIAGRAM_AI_SIGNUP` | unset | `open`: anyone may register. `invite`: only with a share link. `closed`: nobody (an administrator adds accounts). Unset: the first account registers freely, then `invite`. |
| `DIAGRAM_AI_TRUST_PROXY` | off | Read `X-Forwarded-For` / `X-Forwarded-Proto` (per-IP rate limits, `Secure` cookies behind a TLS proxy). Only set it when a proxy you control sets them. |

**Turning accounts on later.** The first account to register becomes the administrator and the owner of every diagram that has no owner (everything made solo, and anything from `db:import-files`), in one transaction, logged as `First account registered…`. Nothing is orphaned. Diagrams made *while accounts are off again later* have no owner and stay invisible to accounts until `npm run auth -- claim <email>` gives them to someone. Turning accounts off never deletes accounts: the tables stay, the diagrams are open to whoever reaches the app, and `owner_id` is ignored.

## Roles

| Role | Can | Granted by |
| --- | --- | --- |
| viewer | read, export, open the event stream, see other people's cursors | member, or a share link |
| editor | + patches, comments, checkpoints, layout, the in-app assistant, see the member list | member, or an editor link (signed in) |
| owner | + delete, members, share links | creating the diagram |

An anonymous visitor with a link is capped at viewer, even on an editor link. **Administrator** is separate: it manages accounts and installs icon packs; it does not see other people's diagrams.

## How a request is authorised

1. `requestContext(request)` (`auth/request.ts`) resolves a `Principal`: `Authorization: Bearer dai_…` (personal access token), else the session cookie, else anonymous. A bad bearer is a 401, never a fallback.
2. It returns a `DiagramService` and `Hub` **wrapped** by `auth/guard.ts`. The wrapper is the check: every `DiagramService` method has a rule (a `Record<Method, Rule>`, so a new method does not compile until it has one), unknown members do not exist on it, and human/agent actors in arguments are replaced by the ones the server vouches for.
3. Routes, the SSE route, the MCP endpoint and the in-app assistant all use that wrapper. `routes.test.ts` fails if a route under `src/app/api` neither calls it nor is on the reviewed public list.
4. Roles come from `AuthStore.roleOn`: `diagrams.owner_id`, else a `diagram_members` row, combined (strongest wins) with a share-link cookie for that diagram.

A diagram you may not see and one that does not exist answer identically (404 with the same text); anonymous callers get 401.

## Credentials

- **Passwords**: scrypt (`node:crypto`), N=2^16, random salt per password, parameters stored in the hash so cost can rise later; Unicode-normalised; length rules (10 to 200) rather than composition rules; constant-time compare; unknown emails verify a dummy hash so timing does not reveal accounts.
- **Sessions**: 256-bit random cookie value, only its SHA-256 stored (`sessions`). Absolute life 30 days, idle 7 days, replaced when older than a day (`GET /api/auth/session`; the old value lives 60 s for requests in flight). Changing the password ends every other session.
- **Cookie**: `dai_session` (`__Host-dai_session` over HTTPS), `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when the request is HTTPS.
- **Personal access tokens** (`dai_…`, 256 bits): created in Account settings, shown once, stored hashed, optional expiry, `read` or `write` scope. A token cannot manage accounts or tokens (session only).
- **Share links**: 192-bit token, hash stored, `viewer` or `editor`, optional expiry, revocable. `/s/<token>` calls `POST /api/share/redeem`, which signs a member up to the diagram (shows under "Shared with me") or sets a `dai_share` cookie scoped to `/api/diagrams/<id>`. The token is re-checked on every request, so revoking ends open tabs within a heartbeat (20 s; `eventStream`'s `stillAllowed`).
- **Rate limits** (`auth/rate-limit.ts`, in memory): 8 failed sign-ins per email and 40 per address per 15 minutes; 10 sign-ups per address and 200 overall per hour.

## MCP with accounts on

`POST /api/mcp[/name]` requires `Authorization: Bearer dai_<token>`; cookies are ignored. The agent sees and edits only what its account can, and its changes are attributed to it on that account's behalf (`Actor.ownerId`, id `claude-code@<user>`, name "Claude Code (Ana)"). `ConnectAgent` shows the header form when accounts are on:
`claude mcp add --transport http diagram-ai <url>/api/mcp --header "Authorization: Bearer $DIAGRAM_AI_TOKEN"`.

## Presence

`POST /api/diagrams/[id]/presence` carries selection, viewport and pointer. `Hub.setPeer` assigns a colour, names the tab (account name, "Guest", or "Tab N" in solo mode), and publishes `peer`; closing the stream publishes `peer-left`. Another account cannot move a tab it does not own. The editor shows avatars in the top bar (`PeerAvatars`), pointers and selection outlines on the canvas (`PeerLayer`); the sender throttles to ~12 posts per second and only while others are present. Agents appear as agents, not peers. Only editors' selections drive an agent's "this".

## Security checklist

| Item | Where | Test |
| --- | --- | --- |
| No account enumeration on sign-in | same message and time for unknown email and wrong password | `auth.db.test.ts`, smoke |
| Timing-safe compare, hashes at rest | `password.ts`, `tokens.ts`; no secret appears in any table | `auth.db.test.ts` |
| Cookie flags | `session-cookie.ts` | `auth.test.ts` |
| CSRF | `SameSite=Lax` + `assertSameOrigin`; cookie-authenticated writes also need an `Origin` (or `Sec-Fetch-Site`) | `auth.test.ts` |
| Authorization on SSE, export, thumbnail, snapshots | guard wrapper | smoke IDOR matrix |
| IDOR | user B cannot read, patch, delete, export, comment on A's diagram by id | `auth.test.ts`, `auth.db.test.ts` |
| Authorship cannot be forged | `attribution.ts` rewrites comment, reply and `createdBy` fields | `auth.test.ts` |
| MCP bearer enforced | `requestContext({ bearerOnly })` | smoke |
| Listing filtered | `list` rule + `accessList` | `auth.db.test.ts` |
| Share tokens at least 128 bits | `newShareToken` (192) | `auth.test.ts` |

Known gaps: no email (no verification, no self-service reset: use `npm run auth -- reset-password <email>` with `DIAGRAM_AI_NEW_PASSWORD`); rate limits and presence are per process; sign-up reveals whether an address is taken; adding a member by email tells an owner whether an account exists.

## Operating it

- The first account is the administrator and **claims every diagram without a valid owner** (files imported earlier, or created before accounts). `npm run db:import-files -- --owner <email or id>` makes them that account's.
- `npm run auth -- list | reset-password <email> | make-admin <email> | claim <email>`. Administrators add or disable accounts under Account settings → People.
- Diagram storage, `diagram_ops.actor` and checkpoint authors now carry real user ids and names.
- Run one server process; see [database.md](database.md).
