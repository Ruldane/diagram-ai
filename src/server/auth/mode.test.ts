import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { currentBridgeEnvironment, bridgeDisabledReason } from "../chat/bridge/gating";
import { authEnabled, authRequestedWithoutDatabase } from "../config";
import { requestContext } from "./request";

const KEYS = ["DATABASE_URL", "DIAGRAM_AI_AUTH", "DIAGRAM_AI_LOCAL_AGENTS"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const DB = "postgres://diagram_ai:diagram_ai@127.0.0.1:1/never_connected";

describe("accounts are opt-in", () => {
  it("storage and accounts are independent switches", () => {
    expect(authEnabled()).toBe(false); // files, nothing set
    process.env.DATABASE_URL = DB;
    expect(authEnabled()).toBe(false); // PostgreSQL alone does not force a login
    for (const value of ["on", "1", "true", "yes", " ON "]) {
      process.env.DIAGRAM_AI_AUTH = value;
      expect(authEnabled(), value).toBe(true);
    }
    for (const value of ["off", "0", "false", "", "maybe"]) {
      process.env.DIAGRAM_AI_AUTH = value;
      expect(authEnabled(), value).toBe(false);
    }
  });

  it("accounts need the database: on without one is reported, and stays off", () => {
    process.env.DIAGRAM_AI_AUTH = "on";
    expect(authEnabled()).toBe(false);
    expect(authRequestedWithoutDatabase()).toBe(true);
    process.env.DATABASE_URL = DB;
    expect(authRequestedWithoutDatabase()).toBe(false);
  });

  it("the Claude Code bridge follows accounts, not storage", () => {
    process.env.DATABASE_URL = DB;
    expect(currentBridgeEnvironment().multiUser).toBe(false);
    expect(bridgeDisabledReason()).toBeNull(); // PostgreSQL, accounts off: available
    process.env.DIAGRAM_AI_AUTH = "on";
    expect(currentBridgeEnvironment().multiUser).toBe(true);
    expect(bridgeDisabledReason()).toMatch(/accounts and sharing/);
    process.env.DIAGRAM_AI_LOCAL_AGENTS = "on";
    expect(bridgeDisabledReason()).toMatch(/accounts and sharing/); // not overridable
  });

  it("with PostgreSQL and accounts off a request is the owner of everything, with no credentials", async () => {
    process.env.DATABASE_URL = DB;
    const context = await requestContext(new Request("http://localhost:3000/api/diagrams"));
    expect(context.auth).toBeNull();
    expect(context.access.local).toBe(true);
    expect(await context.access.role("any-diagram")).toBe("owner");
    expect(() => context.access.requireUser()).not.toThrow();
    expect(() => context.access.requireAdmin()).not.toThrow();
  });

  it("an MCP request needs no token when accounts are off", async () => {
    process.env.DATABASE_URL = DB;
    const context = await requestContext(new Request("http://localhost:3000/api/mcp", { method: "POST" }), { bearerOnly: true });
    expect(context.access.local).toBe(true);
  });
});
