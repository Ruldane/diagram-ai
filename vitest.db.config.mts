import path from "node:path";
import { defineConfig } from "vitest/config";

import { loadEnvFiles } from "./scripts/load-env.mjs";

// Database tests: they need a real PostgreSQL and run only when DATABASE_URL_TEST points at one.
//   DATABASE_URL_TEST=postgres://diagram_ai:diagram_ai@127.0.0.1:5435/diagram_ai npm run test:db
// Each file works in its own throw-away schema, so a development database can be used safely.
// .env.local and .env are read too, so the variable can live there.
loadEnvFiles();
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is not set. Start the database with `npm run db:up` and set it, e.g. postgres://diagram_ai:diagram_ai@127.0.0.1:5435/diagram_ai");
}

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/server/store/postgres.test.ts", "src/server/db/**/*.db.test.ts", "src/server/auth/**/*.db.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
