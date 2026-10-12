import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The routes read packs from the data directory; keep it away from the real ./data.
vi.hoisted(() => {
  process.env.DIAGRAM_DATA_DIR = `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/diagram-ai-mode-${Date.now()}`;
});

import { getRepository } from "../context";
import { createPool } from "../db/database";

/**
 * Both modes through the real route handlers and PostgreSQL: `DATABASE_URL_TEST=... npm run test:db`.
 * Storage is the same throughout; only `DIAGRAM_AI_AUTH` changes.
 */
const url = process.env.DATABASE_URL_TEST;

const ORIGIN = "http://localhost:3000";

function request(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { host: "localhost:3000", ...init.headers };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  if (init.method && init.method !== "GET") headers.origin ??= ORIGIN;
  return new Request(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) });
}

const MCP_HEADERS = { accept: "application/json, text/event-stream" };
const listCall = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "diagram_list", arguments: {} } };

describe.skipIf(!url)("solo mode and accounts mode on one database", () => {
  const schema = `diagram_ai_mode_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let admin: Pool;
  let pool: Pool;
  const handlers: {
    diagrams: typeof import("@/app/api/diagrams/route");
    diagram: typeof import("@/app/api/diagrams/[id]/route");
    share: typeof import("@/app/api/diagrams/[id]/share/route");
    session: typeof import("@/app/api/auth/session/route");
    register: typeof import("@/app/api/auth/register/route");
    mcp: typeof import("@/app/api/mcp/[[...agent]]/route");
  } = {} as never;
  const ids: string[] = [];
  let ownerCookie = "";

  const auth = (mode: "on" | "off" | undefined) => {
    if (mode === undefined) delete process.env.DIAGRAM_AI_AUTH;
    else process.env.DIAGRAM_AI_AUTH = mode;
  };
  const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, unknown>, headers: response.headers });
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const mcpList = async (headers: Record<string, string> = {}) => {
    const response = await handlers.mcp.POST(request("/api/mcp", { method: "POST", json: listCall, headers: { ...MCP_HEADERS, ...headers } }), { params: Promise.resolve({}) });
    return { status: response.status, text: await response.text(), headers: response.headers };
  };

  beforeAll(async () => {
    admin = createPool(url as string, { max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(url as string, { options: `-c search_path=${schema}` });
    // The app's own connection (and its migrations) go to the same throw-away schema.
    process.env.DATABASE_URL = `${url}${url!.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
    handlers.diagrams = await import("@/app/api/diagrams/route");
    handlers.diagram = await import("@/app/api/diagrams/[id]/route");
    handlers.share = await import("@/app/api/diagrams/[id]/share/route");
    handlers.session = await import("@/app/api/auth/session/route");
    handlers.register = await import("@/app/api/auth/register/route");
    handlers.mcp = await import("@/app/api/mcp/[[...agent]]/route");
  });

  afterAll(async () => {
    await getRepository().flush();
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
    delete process.env.DATABASE_URL;
    auth(undefined);
  });

  it("DATABASE_URL alone: no login anywhere, MCP without a token, ownerless diagrams", async () => {
    auth(undefined);
    const session = await json(await handlers.session.GET(request("/api/auth/session")));
    expect(session.body).toMatchObject({ authRequired: false, user: null });

    for (const name of ["Solo one", "Solo two"]) {
      const created = await json(await handlers.diagrams.POST(request("/api/diagrams", { method: "POST", json: { name, type: "flowchart" } })));
      expect(created.status).toBe(201);
      ids.push((created.body.diagram as { id: string }).id);
    }
    const list = await json(await handlers.diagrams.GET(request("/api/diagrams")));
    expect(list.status).toBe(200);
    expect((list.body.diagrams as { id: string }[]).map((d) => d.id)).toEqual(expect.arrayContaining(ids));
    expect(list.body.access).toBeUndefined();

    const read = await json(await handlers.diagram.GET(request(`/api/diagrams/${ids[0]}`), params(ids[0])));
    expect(read.status).toBe(200);
    expect(read.body.viewer).toMatchObject({ role: "owner", user: null });

    const mcp = await mcpList();
    expect(mcp.status).toBe(200);
    expect(mcp.text).toContain(ids[0]);

    // Sharing endpoints degrade gracefully, and sign-up is refused with an explanation.
    const links = await json(await handlers.share.GET(request(`/api/diagrams/${ids[0]}/share`), params(ids[0])));
    expect(links.body).toEqual({ links: [] });
    const signup = await json(
      await handlers.register.POST(request("/api/auth/register", { method: "POST", json: { email: "a@example.com", name: "A", password: "correct horse battery" } })),
    );
    expect(signup.status).toBe(400);

    await getRepository().flush();
    const owners = await pool.query("SELECT owner_id FROM diagrams WHERE id = ANY($1)", [ids]);
    expect(owners.rows.map((row) => row.owner_id)).toEqual([null, null]);
  });

  it("DIAGRAM_AI_AUTH=off behaves the same as unset", async () => {
    auth("off");
    expect((await handlers.diagrams.GET(request("/api/diagrams"))).status).toBe(200);
    expect((await mcpList()).status).toBe(200);
  });

  it("turning accounts on: everything needs a caller, and the first account takes over the ownerless diagrams", async () => {
    auth("on");
    expect((await handlers.diagrams.GET(request("/api/diagrams"))).status).toBe(401);
    const noToken = await mcpList();
    expect(noToken.status).toBe(401);
    expect(noToken.headers.get("www-authenticate")).toMatch(/Bearer/);
    const session = await json(await handlers.session.GET(request("/api/auth/session")));
    expect(session.body).toMatchObject({ authRequired: true, user: null, signup: "first" });

    const registered = await handlers.register.POST(
      request("/api/auth/register", { method: "POST", json: { email: "first@example.com", name: "First Person", password: "correct horse battery" } }),
    );
    expect(registered.status).toBe(201);
    expect(await registered.clone().json()).toMatchObject({ first: true, user: { isAdmin: true } });
    ownerCookie = (registered.headers.getSetCookie().find((c) => c.startsWith("dai_session=")) ?? "").split(";")[0];
    expect(ownerCookie).toMatch(/^dai_session=.{40,}/);

    const userId = (await pool.query<{ id: string }>("SELECT id FROM users WHERE email = 'first@example.com'")).rows[0].id;
    const owners = await pool.query("SELECT owner_id FROM diagrams WHERE id = ANY($1)", [ids]);
    expect(owners.rows.map((row) => row.owner_id)).toEqual([userId, userId]);
    const members = await pool.query("SELECT role FROM diagram_members WHERE diagram_id = ANY($1) AND user_id = $2", [ids, userId]);
    expect(members.rows.map((row) => row.role)).toEqual(["owner", "owner"]);

    const list = await json(await handlers.diagrams.GET(request("/api/diagrams", { headers: { cookie: ownerCookie } })));
    expect(list.status).toBe(200);
    expect((list.body.diagrams as { id: string }[]).map((d) => d.id)).toEqual(expect.arrayContaining(ids));
    expect((list.body.access as Record<string, { role: string }>)[ids[0]].role).toBe("owner");

    // A visitor with no account sees nothing of them.
    const stranger = await handlers.diagram.GET(request(`/api/diagrams/${ids[0]}`), params(ids[0]));
    expect(stranger.status).toBe(401);
  });

  it("turning accounts off again changes nothing in the database: open to whoever reaches the app", async () => {
    auth(undefined);
    const list = await json(await handlers.diagrams.GET(request("/api/diagrams")));
    expect(list.status).toBe(200);
    expect((list.body.diagrams as { id: string }[]).map((d) => d.id)).toEqual(expect.arrayContaining(ids));
    expect((await mcpList()).text).toContain(ids[0]);
  });
});
