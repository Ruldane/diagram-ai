import path from "node:path";

export const APP_NAME = "Diagram AI";
export const APP_VERSION = "0.1.0";
export const MCP_SERVER_NAME = "diagram-ai-mcp-server";

/**
 * Where diagrams, snapshots and agent exports are stored (plain JSON files).
 * These are runtime locations, so the bundler is told not to trace them into the build.
 */
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DIAGRAM_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
export const DIAGRAMS_DIR = path.join(/* turbopackIgnore: true */ DATA_DIR, "diagrams");
export const SNAPSHOTS_DIR = path.join(/* turbopackIgnore: true */ DATA_DIR, "snapshots");
export const REVIEW_DIR = path.join(/* turbopackIgnore: true */ DATA_DIR, "review");
export const EXPORTS_DIR = path.join(/* turbopackIgnore: true */ DATA_DIR, "exports");
export const FONTS_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "public", "fonts");

/** Agents are shown as "working" for this long after their last tool call. */
export const AGENT_WORKING_MS = 6_000;
export const MAX_SNAPSHOTS = 50;
export const ACTIVITY_LIMIT = 200;

/** PostgreSQL connection string. When set, diagrams live in the database instead of `DATA_DIR`. Read per call so tests and scripts can set it late. */
export const databaseUrl = (): string | undefined => process.env.DATABASE_URL?.trim() || undefined;
/** Apply pending database migrations the first time the database is used. Disable with `DIAGRAM_AI_AUTO_MIGRATE=0` to run `npm run db:migrate` by hand. */
export const autoMigrate = (): boolean => !["0", "false", "off", "no"].includes((process.env.DIAGRAM_AI_AUTO_MIGRATE ?? "").trim().toLowerCase());
/** Change-log entries kept per diagram in PostgreSQL. */
export const MAX_OPS_PER_DIAGRAM = 5_000;
