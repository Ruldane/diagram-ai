/**
 * Database maintenance for the PostgreSQL storage (see docs/database.md).
 *
 *   npx tsx scripts/db.ts migrate
 *   npx tsx scripts/db.ts status [--verify]
 *   npx tsx scripts/db.ts import-files [--dir ./data] [--owner <id>] [--overwrite]
 *
 * Reads DATABASE_URL from the environment, `.env.local` or `.env`. Without it the bundled
 * Docker database (`npm run db:up`) is assumed.
 */
import path from "node:path";

import { loadEnvFiles } from "./load-env.mjs";

const USAGE = `Usage:
  tsx scripts/db.ts migrate                  apply pending migrations
  tsx scripts/db.ts status [--verify]        show migrations and row counts; --verify validates every document
  tsx scripts/db.ts import-files [--dir ./data] [--owner <id>] [--overwrite]
                                             copy JSON-file diagrams into the database (existing ids are skipped)`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["migrate", "status", "import-files"].includes(command)) {
    console.error(USAGE);
    return command ? 1 : 0;
  }

  // Server modules read the environment when they load, so import them only now.
  loadEnvFiles();
  const explicit = process.env.DATABASE_URL?.trim();
  const url = explicit || `postgres://diagram_ai:diagram_ai@127.0.0.1:${process.env.DIAGRAM_AI_PG_PORT ?? "5435"}/diagram_ai`;
  const { createPool, describeDatabase } = await import("../src/server/db/database");
  const { migrate, migrationStatus } = await import("../src/server/db/migrate");

  console.log(`Database: ${describeDatabase(url)}${explicit ? "" : " (DATABASE_URL is not set; using the bundled Docker database)"}`);
  const pool = createPool(url, { max: 2 });
  try {
    if (command === "migrate") {
      const result = await migrate(pool, { log: (message) => console.log(message) });
      console.log(result.applied.length ? `Applied ${result.applied.length} migration(s); ${result.total} in total.` : `Up to date (${result.total} migration(s) applied).`);
      return 0;
    }

    if (command === "status") {
      const status = await migrationStatus(pool);
      console.log(`Migrations: ${status.applied.length + status.unknown.length} applied, ${status.pending.length} pending`);
      for (const m of status.applied) console.log(`  applied  ${m.name}  (${m.appliedAt.toISOString()})`);
      for (const m of status.unknown) console.log(`  applied  ${m.name}  (not in this checkout)`);
      for (const m of status.pending) console.log(`  pending  ${m.name}`);
      if (status.pending.length) {
        console.log('Run "npm run db:migrate" to apply them.');
        return 0;
      }
      const { rows } = await pool.query<{ diagrams: number; snapshots: number; review_bases: number; ops: number; size: string }>(
        `SELECT (SELECT count(*) FROM diagrams)::int AS diagrams,
                (SELECT count(*) FROM diagram_snapshots)::int AS snapshots,
                (SELECT count(*) FROM diagram_review_bases)::int AS review_bases,
                (SELECT count(*) FROM diagram_ops)::int AS ops,
                pg_size_pretty(pg_database_size(current_database())) AS size`,
      );
      const counts = rows[0];
      console.log(`Rows: ${counts.diagrams} diagrams, ${counts.snapshots} checkpoints, ${counts.review_bases} review baselines, ${counts.ops} change-log entries (${counts.size} on disk)`);
      if (args.includes("--verify")) return await verify(pool);
      return 0;
    }

    // import-files
    await migrate(pool, { log: (message) => console.log(message) });
    const dirArg = option(args, "--dir") ?? process.env.DIAGRAM_DATA_DIR ?? "data";
    const dir = path.resolve(dirArg);
    const { importFiles } = await import("../src/server/db/import-files");
    const owner = option(args, "--owner");
    const overwrite = args.includes("--overwrite");
    console.log(`Importing from ${dir}${owner ? ` as owner "${owner}"` : ""}${overwrite ? ", replacing existing diagrams" : ""}…`);
    const summary = await importFiles(pool, { dir, owner, overwrite });
    console.log(
      `Imported ${summary.imported} diagram(s)` +
        (summary.replaced ? `, replaced ${summary.replaced}` : "") +
        `, skipped ${summary.skipped} already present; ${summary.snapshots} checkpoint(s), ${summary.reviewBases} review baseline(s).`,
    );
    if (summary.problems.length) {
      console.log(`${summary.problems.length} file(s) could not be imported:`);
      for (const problem of summary.problems) console.log(`  ${problem}`);
    }
    if (summary.replaced > 0) console.log("A running server keeps documents in memory: restart it to see the replaced diagrams.");
    return 0;
  } finally {
    await pool.end();
  }
}

/** Validates every stored document against the schema, in pages so memory stays flat. */
async function verify(pool: import("pg").Pool): Promise<number> {
  const { docSchema, formatIssues } = await import("../src/core/model/schema");
  let last = "";
  let checked = 0;
  const broken: string[] = [];
  for (;;) {
    const { rows } = await pool.query<{ id: string; doc: unknown }>("SELECT id, doc FROM diagrams WHERE id > $1 ORDER BY id LIMIT 50", [last]);
    if (!rows.length) break;
    for (const row of rows) {
      const parsed = docSchema.safeParse(row.doc);
      if (!parsed.success) broken.push(`${row.id}: ${formatIssues(parsed.error)}`);
      checked += 1;
      last = row.id;
    }
  }
  console.log(`Verified ${checked} document(s): ${checked - broken.length} valid, ${broken.length} invalid.`);
  for (const line of broken) console.log(`  ${line}`);
  return broken.length ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
