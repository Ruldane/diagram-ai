#!/usr/bin/env node
/**
 * Manages the bundled PostgreSQL container (docker-compose.yml, project "diagram-ai").
 *
 *   node scripts/db.mjs reset --yes   delete the database volume, start a fresh empty database, migrate it
 *
 * Only the compose project named below is ever touched; nothing is pruned.
 * Starting and stopping are plain `npm run db:up` / `db:down`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "diagram-ai";
const VOLUME = "diagram-ai-pgdata";
const compose = ["compose", "-p", PROJECT, "-f", path.join(root, "docker-compose.yml")];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(`Could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const [command, ...flags] = process.argv.slice(2);

if (command !== "reset") {
  console.error("Usage: node scripts/db.mjs reset --yes");
  process.exit(command ? 1 : 0);
}

if (!flags.includes("--yes")) {
  console.error(`This deletes the Docker volume "${VOLUME}": every diagram, checkpoint and change log stored in the bundled PostgreSQL.`);
  console.error("JSON files in ./data are not touched. Run again with --yes to confirm:  npm run db:reset -- --yes");
  process.exit(1);
}

console.log(`Removing container and volume of the "${PROJECT}" compose project…`);
run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
console.log("Starting a fresh database…");
run("docker", [...compose, "up", "-d", "--wait", "postgres"]);
console.log("Applying migrations…");
run(process.execPath, ["--import", "tsx", path.join(root, "scripts", "db.ts"), "migrate"]);
console.log("Done. The database is empty and migrated.");
