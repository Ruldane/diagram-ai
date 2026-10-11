# PostgreSQL storage

How diagrams are stored in PostgreSQL instead of JSON files: running it locally, schema and migrations, the write path, importing and backups. For the repository contract see `src/server/store/repository.ts`.

## Quick start

```bash
npm run db:up          # starts the container "diagram-ai-postgres" and waits until it is healthy
echo "DATABASE_URL=postgres://diagram_ai:diagram_ai@127.0.0.1:5435/diagram_ai" >> .env.local
npm run dev            # logs "Storage: PostgreSQL at 127.0.0.1:5435/diagram_ai"
curl localhost:3000/api/health      # {"ok":true,"storage":"postgres","migrations":1}
npm run db:import-files             # optional: copy the diagrams from ./data into the database
```

Without `DATABASE_URL` the app keeps using JSON files in `./data`, exactly as before. `DATABASE_URL` is read on every call to `getContext()` (`src/server/context.ts`), the one place that picks the repository.

| Command | Does |
| --- | --- |
| `npm run db:up` / `db:down` | Start / stop the container. Data stays in the volume `diagram-ai-pgdata`. |
| `npm run db:reset -- --yes` | Delete the volume, start an empty database and migrate it. Refuses without `--yes`. |
| `npm run db:migrate` | Apply pending migrations. `npx tsx scripts/db.ts status [--verify]` shows migrations, row counts and, with `--verify`, validates every stored document. |
| `npm run db:import-files` | See "Importing files". |

Ports 5432 to 5434 are commonly taken by other local databases, so the container publishes on **5435** (`DIAGRAM_AI_PG_PORT` changes it; keep `DATABASE_URL` in step). It is bound to `127.0.0.1` with the development credentials from `docker-compose.yml`; do not expose it. `scripts/db.ts` falls back to that URL when `DATABASE_URL` is unset and reads `.env.local` and `.env` itself.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | unset | Connection string. Set means PostgreSQL, unset means files. Add `?sslmode=require` for a hosted database. |
| `DIAGRAM_AI_AUTO_MIGRATE` | on | `0` skips migrating on first use; the app then refuses to start storage while migrations are pending. |
| `DIAGRAM_AI_PG_PORT` | `5435` | Host port of the bundled container. |
| `DATABASE_URL_TEST` | unset | Database for `npm run test:db`. |

## Schema and migrations

| Table | Holds |
| --- | --- |
| `diagrams` | One row per diagram: the whole `DiagramDoc` as `doc jsonb`, plus `name`, `type`, `version`, timestamps and the denormalised `node_count`, `edge_count`, `open_comments` that listings read. `owner_id` is reserved for accounts. |
| `diagram_snapshots` | Checkpoints, keyed `(diagram_id, id)`, newest `MAX_SNAPSHOTS` kept per diagram. |
| `diagram_review_bases` | The baseline agent changes are reviewed against. |
| `diagram_ops` | Append-only change log: `(diagram_id, version, actor, patch)`, newest `MAX_OPS_PER_DIAGRAM` (5,000) kept; trimmed every ~100 entries, so it may briefly exceed that. |
| `schema_migrations` | Applied migrations with a checksum. |

Rows reference `diagrams` with `ON DELETE CASCADE`: deleting a diagram removes its checkpoints, baseline and log.

**Adding a migration**: create `src/server/db/migrations/NNN_what_it_does.sql` with the next free number (lower-case, digits, underscores). That is all; it applies on the next start or `npm run db:migrate`.

- Each file runs in one transaction, in numeric order, under an advisory lock, so several processes can start at once.
- Never edit a migration that has been applied anywhere: the runner compares checksums and refuses (add a new migration; on a throw-away database use `db:reset`).
- No `CREATE INDEX CONCURRENTLY` or anything else that cannot run in a transaction.
- Migrations are plain SQL read from disk at run time, so the server must start from the project root.

## Write path

`save(doc)` returns immediately and keeps the document in memory; the database is written behind it (`src/server/store/postgres.ts`):

- A burst of saves is coalesced: one upsert of the latest document after 150 ms of quiet, and at least every 2 s under constant editing. `flush()` waits for everything pending.
- A change-log entry (`appendOp`) is written in the same transaction as the version it belongs to.
- Connection loss, a restart or a deadlock is retried 4 times (0.25 s to 2 s), then every 15 s in the background. The document stays in memory and listings keep showing it. Errors that retrying cannot fix (bad data, missing table) are logged once and retried on the diagram's next change. Nothing is thrown into the request that saved.
- Checkpoints and review baselines first wait for the diagram row, so their foreign keys always hold.
- `list()` reads only the summary columns: about 15 to 20 ms for 2,000 diagrams, against 0.6 to 3 s for loading every document.
- Documents are cached (256, least recently used); one with unwritten changes is never dropped.

**Single process.** The in-memory copy is authoritative once loaded, exactly as with files, and the realtime `Hub` is in-memory too. Run one server process per database. Two processes would not see each other's live edits and could overwrite each other's saves. The path to several instances is not implemented: publish `Hub` events through `LISTEN/NOTIFY` (or Redis), drop or invalidate cached documents on notification, and guard the upsert with `WHERE diagrams.version < EXCLUDED.version`.

Things to know:

- A hard kill (no shutdown hook runs under `next dev`) loses at most the changes of the last ~150 ms.
- `jsonb` does not keep object key order: nodes and edges come back ordered by id length, then id. Rendering and layout sort by `z` then id (`src/core/model/queries.ts`), so only code that lists records in raw order (text listings for agents) can differ from the file storage.
- Rows are validated with `docSchema` when a document is read, not when listing. A row that fails is logged once, answers "not found" and disappears from listings. Find them with `status --verify`.
- Something other than this server writing rows (`import-files --overwrite`, SQL) is not noticed by a running server; restart it.

## Importing files

```bash
npm run db:import-files -- --dir ./data --owner local          # --owner is optional
npm run db:import-files -- --dir ./data --overwrite            # replace ids that already exist
```

Reads `<dir>/diagrams/*.json`, `<dir>/snapshots/<id>/*.json` and `<dir>/review/<id>.json`, validates each with `docSchema`, and writes one transaction per diagram. Ids that exist are skipped, so it can be run again safely; files that fail validation are listed in the summary and skipped. The source files are never modified.

## Backups

```bash
docker exec diagram-ai-postgres pg_dump -U diagram_ai -Fc diagram_ai > diagram-ai.dump
docker exec -i diagram-ai-postgres pg_restore -U diagram_ai -d diagram_ai --clean --if-exists < diagram-ai.dump
```

Stop the app before restoring. `docker compose down -v` (or `db:reset`) deletes the volume for good.

## Tests

`npx vitest run` covers the pure parts and the write path against a scripted fake pool; the database tests are skipped there. With a database running:

```bash
DATABASE_URL_TEST=postgres://diagram_ai:diagram_ai@127.0.0.1:5435/diagram_ai npm run test:db
```

Each run works in its own temporary schema and drops it, so pointing it at the development database is safe. For a throw-away server: `docker run --rm -d --name diagram-ai-test-pg -e POSTGRES_USER=diagram_ai -e POSTGRES_PASSWORD=diagram_ai -e POSTGRES_DB=diagram_ai --tmpfs /var/lib/postgresql/data -p 127.0.0.1::5432 postgres:17`, then `docker port diagram-ai-test-pg 5432` for the port.

## Reserved for accounts

Not implemented. The next phase adds these without changing existing tables beyond giving `diagrams.owner_id` a foreign key:

```sql
users            (id text PK, email text UNIQUE, name text, password_hash text NULL, created_at timestamptz)
diagram_members  (diagram_id text REFERENCES diagrams ON DELETE CASCADE, user_id text REFERENCES users ON DELETE CASCADE,
                  role text CHECK (role IN ('owner','editor','commenter','viewer')), PRIMARY KEY (diagram_id, user_id))
share_links      (token_hash text PK, diagram_id text REFERENCES diagrams ON DELETE CASCADE, role text,
                  created_by text REFERENCES users, expires_at timestamptz NULL, revoked_at timestamptz NULL)
```

- Store only a hash of share-link tokens. Authorisation lives in the service layer; repository reads gain a viewer filter (`WHERE owner_id = $1 OR id IN (SELECT diagram_id FROM diagram_members …)`, served by `diagrams_owner_idx`).
- Rows written before accounts have a null `owner_id`; assign them with `import-files --owner <id> --overwrite` or one `UPDATE`.
- Human `Actor.id` values already appear in `diagram_ops.actor` and checkpoint authors; map them to `users.id` when sessions exist.
