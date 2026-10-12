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

/* ------------------------------------------------------------ accounts */

const ON = ["1", "true", "on", "yes"];

/**
 * Accounts and sharing are on: "team mode". It is opt-in and needs the
 * database, so it takes both `DIAGRAM_AI_AUTH=on` and `DATABASE_URL`.
 * Everything else is solo mode with no login, including PostgreSQL storage
 * with `DIAGRAM_AI_AUTH` unset: where diagrams are stored and who may open
 * them are independent choices.
 */
export const authEnabled = (): boolean => Boolean(databaseUrl()) && ON.includes((process.env.DIAGRAM_AI_AUTH ?? "").trim().toLowerCase());

/** `DIAGRAM_AI_AUTH=on` without a database: accounts cannot work, which `server/context.ts` reports once at startup. */
export const authRequestedWithoutDatabase = (): boolean => ON.includes((process.env.DIAGRAM_AI_AUTH ?? "").trim().toLowerCase()) && !databaseUrl();

/** `DIAGRAM_AI_SIGNUP`. Unset means the first account may register and everyone after needs an invite link. */
export function signupSetting(): "open" | "invite" | "closed" | undefined {
  const value = (process.env.DIAGRAM_AI_SIGNUP ?? "").trim().toLowerCase();
  return value === "open" || value === "invite" || value === "closed" ? value : undefined;
}

/** Trust `X-Forwarded-*` headers (the app runs behind a reverse proxy that sets them). */
export const trustProxy = (): boolean => ["1", "true", "on", "yes"].includes((process.env.DIAGRAM_AI_TRUST_PROXY ?? "").trim().toLowerCase());

/** Cookie sessions end this long after sign-in, whatever the activity. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** ...or this long after the last request. */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60_000;
/** The session token is replaced when it is older than this. */
export const SESSION_ROTATE_MS = 24 * 60 * 60_000;
