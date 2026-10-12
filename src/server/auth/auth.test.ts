import { describe, expect, it, vi } from "vitest";

import { atLeast, initialsOf, isValidEmail, maxRole, minRole, normalizeEmail, passwordProblem, type Role } from "@/core/auth";
import { createDoc } from "@/core/model/defaults";
import type { Actor, DiagramDoc, Patch } from "@/core/model/types";

import { Hub } from "../realtime/hub";
import type { DiagramService } from "../service";
import { Access, assertBrowserOrigin, bearerFrom, isSecureRequest, type Principal } from "./access";
import { attributePatch } from "./attribution";
import { clearedCookie, parseCookies, serializeCookie } from "./cookies";
import { GUARDED_METHODS, guardHub, guardService } from "./guard";
import { dummyHash, hashPassword, verifyPassword } from "./password";
import { RateLimited, RateLimiter, createRateLimitState } from "./rate-limit";
import type { AuthService } from "./service";
import type { UserRecord } from "./store";
import { API_TOKEN_PATTERN, hashToken, newApiToken, newSessionToken, newShareToken, safeEqual } from "./tokens";

/** Cheap parameters: these tests are about the format and the comparison, not the cost. */
const FAST = { logN: 10, r: 8, p: 1 };

describe("roles", () => {
  it("orders viewer < editor < owner", () => {
    expect(atLeast("owner", "editor")).toBe(true);
    expect(atLeast("editor", "editor")).toBe(true);
    expect(atLeast("viewer", "editor")).toBe(false);
    expect(atLeast(null, "viewer")).toBe(false);
    expect(maxRole("viewer", "editor")).toBe("editor");
    expect(maxRole(null, "viewer")).toBe("viewer");
    expect(maxRole(null, null)).toBeNull();
    expect(minRole("owner", "viewer")).toBe("viewer");
    expect(minRole(null, "viewer")).toBeNull();
  });

  it("validates emails and passwords", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
    expect(isValidEmail("ada@example.com")).toBe(true);
    expect(isValidEmail("ada@example")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("password123")).toMatch(/easy to guess/);
    expect(passwordProblem("aaaaaaaaaaaa")).toMatch(/easy to guess/);
    expect(passwordProblem("ada.lovelace@example.com", { email: "ada.lovelace@example.com" })).toMatch(/email/);
    expect(passwordProblem("correct horse battery staple")).toBeNull();
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("  ")).toBe("?");
  });
});

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse battery", FAST);
    expect(stored).toMatch(/^scrypt\$10\$8\$1\$[\w-]+\$[\w-]+$/);
    expect((await verifyPassword("correct horse battery", stored, FAST)).ok).toBe(true);
    expect((await verifyPassword("correct horse batterz", stored, FAST)).ok).toBe(false);
    expect((await verifyPassword("", stored, FAST)).ok).toBe(false);
  });

  it("salts every hash, so equal passwords differ", async () => {
    const [a, b] = await Promise.all([hashPassword("same password here", FAST), hashPassword("same password here", FAST)]);
    expect(a).not.toBe(b);
  });

  it("treats Unicode-equivalent passwords alike", async () => {
    const stored = await hashPassword("café au lait 123", FAST);
    expect((await verifyPassword("café au lait 123", stored, FAST)).ok).toBe(true);
  });

  it("asks for a rehash when the stored cost is below the current one", async () => {
    const stored = await hashPassword("a long enough password", FAST);
    const result = await verifyPassword("a long enough password", stored, { logN: 11, r: 8, p: 1 });
    expect(result).toEqual({ ok: true, needsRehash: true });
  });

  it("rejects malformed and hostile stored values without throwing", async () => {
    for (const bad of ["", "plain", "scrypt$1$2$3$a$b", "scrypt$99$8$1$AAAAAAAAAAAA$AAAA", "scrypt$10$8$1$AA$AA"]) {
      expect((await verifyPassword("whatever", bad, FAST)).ok).toBe(false);
    }
  });

  it("has a dummy hash so unknown accounts cost the same", async () => {
    const dummy = await dummyHash(FAST);
    expect(dummy).toMatch(/^scrypt\$/);
    expect((await verifyPassword("anything", dummy, FAST)).ok).toBe(false);
  });
});

describe("tokens", () => {
  it("hashes deterministically to hex and never equals the token", () => {
    const token = newSessionToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });

  it("makes long unguessable tokens (share links at least 128 bits)", () => {
    // base64url packs 6 bits per character
    expect(newShareToken().length * 6).toBeGreaterThanOrEqual(128);
    expect(newSessionToken().length * 6).toBeGreaterThanOrEqual(256);
    expect(newApiToken()).toMatch(API_TOKEN_PATTERN);
    expect(new Set(Array.from({ length: 50 }, newShareToken)).size).toBe(50);
  });

  it("compares in constant time with a plain boolean answer", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("cookies", () => {
  it("parses a Cookie header", () => {
    const cookies = parseCookies('a=1; dai_session=abc%3D; b="two words"; broken');
    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("dai_session")).toBe("abc%3D");
    expect(cookies.get("b")).toBe("two words");
    expect(cookies.has("broken")).toBe(false);
  });

  it("sets HttpOnly and SameSite=Lax always, Secure over HTTPS", () => {
    const plain = serializeCookie("dai_session", "t", { secure: false, maxAgeSeconds: 60 });
    expect(plain).toContain("HttpOnly");
    expect(plain).toContain("SameSite=Lax");
    expect(plain).toContain("Path=/");
    expect(plain).toContain("Max-Age=60");
    expect(plain).not.toContain("Secure");
    expect(serializeCookie("x", "t", { secure: true })).toContain("Secure");
    expect(clearedCookie("x", { secure: false })).toContain("Max-Age=0");
  });

  it("recognises HTTPS directly and through a trusted proxy only", () => {
    const direct = new Request("https://app.example/api/x");
    const proxied = new Request("http://app.example/api/x", { headers: { "x-forwarded-proto": "https" } });
    expect(isSecureRequest(direct, false)).toBe(true);
    expect(isSecureRequest(proxied, false)).toBe(false);
    expect(isSecureRequest(proxied, true)).toBe(true);
  });
});

describe("request checks", () => {
  const post = (headers: Record<string, string>) => new Request("http://localhost:3000/api/diagrams", { method: "POST", headers: { host: "localhost:3000", ...headers } });

  it("accepts same-origin browser requests and rejects the rest", () => {
    expect(() => assertBrowserOrigin(post({ origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => assertBrowserOrigin(post({ "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertBrowserOrigin(post({ origin: "https://evil.example" }))).toThrow(/Cross-origin/);
    expect(() => assertBrowserOrigin(post({}))).toThrow(/Origin/);
    expect(() => assertBrowserOrigin(post({ "sec-fetch-site": "cross-site" }))).toThrow();
  });

  it("reads a bearer token", () => {
    expect(bearerFrom(new Request("http://x", { headers: { authorization: "Bearer dai_abc" } }))).toBe("dai_abc");
    expect(bearerFrom(new Request("http://x", { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(bearerFrom(new Request("http://x"))).toBeNull();
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and frees the key when the window passes", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(createRateLimitState(), () => now);
    for (let i = 0; i < 3; i++) limiter.hit("k");
    expect(limiter.retryAfter("k", 3, 60_000)).toBeGreaterThan(0);
    expect(() => limiter.assertAllowed("k", 3, 60_000, "attempts")).toThrow(RateLimited);
    expect(limiter.retryAfter("other", 3, 60_000)).toBe(0);
    now += 61_000;
    expect(limiter.retryAfter("k", 3, 60_000)).toBe(0);
    limiter.hit("k");
    limiter.reset("k");
    expect(limiter.retryAfter("k", 1, 60_000)).toBe(0);
  });

  it("does not grow without bound", () => {
    const state = createRateLimitState();
    const limiter = new RateLimiter(state);
    for (let i = 0; i < 50_100; i++) limiter.hit(`ip:${i}`);
    expect(state.hits.size).toBeLessThan(50_100);
  });
});

describe("attributePatch", () => {
  const ana: Actor = { kind: "human", id: "u_ana", name: "Ana" };
  const mallory: Actor = { kind: "human", id: "u_mal", name: "Mallory" };
  const base: DiagramDoc = {
    ...createDoc({ id: "d1", name: "d" }),
    comments: { c1: { id: "c1", x: 0, y: 0, author: ana, text: "hello", createdAt: "2030-01-01T00:00:00.000Z", replies: [{ id: "r1", author: ana, text: "first", createdAt: "2030-01-01T00:00:00.000Z" }] } },
  };

  it("stamps new comments and replies with the trusted actor", () => {
    const patch: Patch = {
      comments: {
        set: [
          { id: "c2", x: 0, y: 0, author: { kind: "human", id: "x", name: "Ana (forged)" }, text: "hi", createdAt: "2030-01-02T00:00:00.000Z", replies: [] },
          { ...base.comments.c1, replies: [...base.comments.c1.replies, { id: "r2", author: ana, text: "forged reply", createdAt: "2030-01-02T00:00:00.000Z" }] },
        ],
      },
    };
    const out = attributePatch(base, patch, mallory);
    expect(out.comments!.set![0].author).toEqual(mallory);
    expect(out.comments!.set![1].author).toEqual(ana); // existing comment keeps its author
    expect(out.comments!.set![1].replies[0].author).toEqual(ana);
    expect(out.comments!.set![1].replies[1].author).toEqual(mallory);
  });

  it("keeps the author of existing comments and replies against rewriting", () => {
    const tampered: Patch = {
      comments: { set: [{ ...base.comments.c1, author: mallory, replies: [{ ...base.comments.c1.replies[0], author: mallory, text: "rewritten" }] }] },
    };
    const out = attributePatch(base, tampered, mallory);
    expect(out.comments!.set![0].author).toEqual(ana);
    expect(out.comments!.set![0].replies[0]).toEqual(base.comments.c1.replies[0]);
  });

  it("credits new nodes and leaves existing ones with their creator", () => {
    const doc: DiagramDoc = { ...base, nodes: { a: { id: "a", shape: "basic/rect", x: 0, y: 0, w: 10, h: 10, z: 0, createdBy: ana } } };
    const patch: Patch = {
      nodes: {
        set: [
          { id: "a", shape: "basic/rect", x: 5, y: 5, w: 10, h: 10, z: 0, createdBy: { kind: "human", id: "browser", name: "You" } },
          { id: "b", shape: "basic/rect", x: 0, y: 0, w: 10, h: 10, z: 1, createdBy: { kind: "human", id: "browser", name: "You" } },
        ],
      },
    };
    const out = attributePatch(doc, patch, mallory);
    expect(out.nodes!.set![0].createdBy).toEqual(ana);
    expect(out.nodes!.set![0].x).toBe(5);
    expect(out.nodes!.set![1].createdBy).toEqual(mallory);
  });

  it("returns the same patch when nothing needs rewriting", () => {
    const patch: Patch = { doc: { name: "renamed" } };
    expect(attributePatch(base, patch, mallory)).toBe(patch);
  });
});

/* ---------------------------------------------------------- authorization */

function user(id: string, name = id): UserRecord {
  return { id, email: `${id}@example.com`, name, passwordHash: "x", isAdmin: false, createdAt: "2030-01-01T00:00:00.000Z", lastLoginAt: null, disabled: false };
}

interface Fixture {
  access: Access;
  service: DiagramService;
  calls: { method: string; args: unknown[] }[];
  hub: Hub;
}

/**
 * A fake world: diagrams `a-doc` (owned by alice, bob is editor, carol viewer)
 * and `b-doc` (owned by bob). Links: token "viewer-link" opens `a-doc` as viewer.
 */
function world(principal: Principal, shareToken: string | null = null): Fixture {
  const roles: Record<string, Record<string, Role>> = {
    alice: { "a-doc": "owner" },
    bob: { "a-doc": "editor", "b-doc": "owner" },
    carol: { "a-doc": "viewer" },
  };
  const links: Record<string, Record<string, "viewer" | "editor">> = { [hashToken("viewer-link")]: { "a-doc": "viewer" }, [hashToken("editor-link")]: { "a-doc": "editor" } };
  const auth = {
    store: {
      roleOn: async (userId: string, diagramId: string) => roles[userId]?.[diagramId] ?? null,
      linkRoleOn: async (hash: string, diagramId: string) => links[hash]?.[diagramId] ?? null,
    },
    accessList: async (userId: string) => Object.entries(roles[userId] ?? {}).map(([diagramId, role]) => ({ diagramId, role, ownerId: "alice", ownerName: "Alice", shared: true })),
  } as unknown as AuthService;

  const calls: Fixture["calls"] = [];
  const hub = new Hub();
  const docs = new Map(["a-doc", "b-doc"].map((id) => [id, { ...createDoc({ id, name: id }), version: 1 }]));
  const record = (method: string, result: unknown) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ method, args });
      return typeof result === "function" ? (result as (...a: unknown[]) => unknown)(...args) : result;
    });
  const fake: Record<string, unknown> = { hub };
  for (const method of GUARDED_METHODS) fake[method] = record(method, undefined);
  fake.list = record("list", [...docs.values()].map((doc) => ({ id: doc.id, name: doc.name, type: "blank", nodeCount: 0, edgeCount: 0, openComments: 0, createdAt: doc.createdAt, updatedAt: doc.updatedAt, version: 1 })));
  fake.get = record("get", (id: string) => docs.get(id));
  fake.create = record("create", () => ({ ...createDoc({ id: "new-doc", name: "new" }), version: 1 }));
  fake.setPresence = vi.fn((...args: unknown[]) => void calls.push({ method: "setPresence", args }));

  const access = new Access(principal, auth, () => shareToken);
  const claimed: string[] = [];
  const service = guardService(fake as unknown as DiagramService, access, {
    settle: async () => undefined,
    claim: async (diagramId, userId) => {
      claimed.push(`${diagramId}:${userId}`);
      return true;
    },
  });
  return { access, service, calls, hub };
}

const asUser = (id: string, via: Principal["via"] = "session", token?: Principal["token"]): Principal => ({ via, user: user(id), ...(token ? { token } : {}) });
const anonymous: Principal = { via: "anonymous", user: null };
const human: Actor = { kind: "human", id: "browser", name: "You" };

describe("service guard", () => {
  it("has a rule for every DiagramService method (the type is exhaustive; this guards the runtime list)", () => {
    expect(GUARDED_METHODS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(GUARDED_METHODS).size).toBe(GUARDED_METHODS.length);
  });

  it("IDOR: a stranger cannot read, change, comment on, export or delete another person's diagram", async () => {
    const { service, calls } = world(asUser("carol"));
    // carol can see a-doc (viewer) but b-doc does not exist for her
    await expect(service.get("b-doc")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.commit("b-doc", { doc: { name: "pwned" } }, human)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.deleteDiagram("b-doc")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.export("b-doc", "svg")).rejects.toMatchObject({ code: "not_found" });
    await expect(service.addComment("b-doc", { text: "x" }, human)).rejects.toMatchObject({ code: "not_found" });
    await expect(service.listSnapshots("b-doc")).rejects.toMatchObject({ code: "not_found" });
    expect(calls).toEqual([]);
  });

  it("answers a missing diagram and a forbidden one the same way", async () => {
    const { service } = world(asUser("carol"));
    const forbidden = String(await service.get("b-doc").catch((e: Error) => e.message));
    const missing = String(await service.get("nope").catch((e: Error) => e.message));
    expect(forbidden.replace("b-doc", "ID")).toBe(missing.replace("nope", "ID"));
  });

  it("viewers read and export but cannot change anything", async () => {
    const { service, calls } = world(asUser("carol"));
    await expect(service.get("a-doc")).resolves.toBeTruthy();
    await expect(service.export("a-doc", "svg")).resolves.toBeUndefined();
    await expect(service.commit("a-doc", { doc: { name: "x" } }, human)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.addComment("a-doc", { text: "x" }, human)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.createSnapshot("a-doc", "x", human)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.layout("a-doc", human)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.deleteDiagram("a-doc")).rejects.toMatchObject({ code: "forbidden" });
    expect(calls.map((c) => c.method)).toEqual(["get", "export"]);
  });

  it("editors change content but cannot delete", async () => {
    const { service, calls } = world(asUser("bob"));
    await expect(service.commit("a-doc", { doc: { name: "x" } }, human)).resolves.toBeUndefined();
    await expect(service.deleteDiagram("a-doc")).rejects.toMatchObject({ code: "forbidden" });
    expect(calls.map((c) => c.method)).toContain("commit");
  });

  it("owners may delete", async () => {
    const { service, calls } = world(asUser("alice"));
    await service.deleteDiagram("a-doc");
    expect(calls.at(-1)?.method).toBe("deleteDiagram");
  });

  it("lists only the diagrams the caller can open", async () => {
    expect((await world(asUser("carol")).service.list()).map((d) => d.id)).toEqual(["a-doc"]);
    expect((await world(asUser("bob")).service.list()).map((d) => d.id).sort()).toEqual(["a-doc", "b-doc"]);
    expect(await world(asUser("dave")).service.list()).toEqual([]);
  });

  it("anonymous callers are asked to sign in, and a share link opens exactly one diagram", async () => {
    await expect(world(anonymous).service.get("a-doc")).rejects.toMatchObject({ code: "unauthenticated" });
    const viaLink = world(anonymous, "viewer-link");
    await expect(viaLink.service.get("a-doc")).resolves.toBeTruthy();
    await expect(viaLink.service.get("b-doc")).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(viaLink.service.commit("a-doc", { doc: { name: "x" } }, human)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("an editor link edits only for a signed-in person", async () => {
    await expect(world(anonymous, "editor-link").service.commit("a-doc", { doc: { name: "x" } }, human)).rejects.toMatchObject({ code: "forbidden" });
    await expect(world(asUser("dave"), "editor-link").service.commit("a-doc", { doc: { name: "x" } }, human)).resolves.toBeUndefined();
  });

  it("a revoked or foreign token grants nothing", async () => {
    await expect(world(asUser("dave"), "not-a-link").service.get("a-doc")).rejects.toMatchObject({ code: "not_found" });
  });

  it("a read-only access token cannot write even where the account can", async () => {
    const { service } = world(asUser("alice", "token", { id: "t1", scope: "read" }));
    await expect(service.get("a-doc")).resolves.toBeTruthy();
    await expect(service.commit("a-doc", { doc: { name: "x" } }, human)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.create({}, human)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("creating a diagram makes the caller its owner", async () => {
    const { service, access } = world(asUser("bob"));
    await service.create({ name: "x" }, human);
    expect(await access.role("new-doc")).toBe("owner");
  });

  it("credits human edits to the person and agent edits to the agent acting for them", async () => {
    const { service, calls } = world(asUser("bob", "session"));
    await service.commit("a-doc", { doc: { name: "x" } }, human);
    expect((calls.at(-1)!.args[2] as Actor).name).toBe("bob");
    expect((calls.at(-1)!.args[2] as Actor).kind).toBe("human");

    const agent = world(asUser("bob", "token", { id: "t", scope: "write" }));
    await agent.service.applyElements("a-doc", {}, { actor: { kind: "agent", id: "claude-code", name: "Claude Code" }, mode: "create" });
    const actor = (agent.calls.at(-1)!.args[2] as { actor: Actor }).actor;
    expect(actor).toMatchObject({ kind: "agent", ownerId: "bob", name: "Claude Code (bob)" });
    expect(actor.id).toBe("claude-code@bob");
  });

  it("does not expose anything outside the rule table", () => {
    const { service } = world(asUser("alice"));
    expect((service as unknown as Record<string, unknown>).repo).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).state).toBeUndefined();
    expect((service as unknown as Record<string, unknown>).constructor).toBeUndefined();
  });

  it("presence is synchronous and needs a known role", async () => {
    const f = world(asUser("carol"));
    expect(() => f.service.setPresence("a-doc", { clientId: "c", selection: [] })).toThrow(/No diagram/); // role not looked up yet
    await f.service.get("a-doc");
    expect(() => f.service.setPresence("a-doc", { clientId: "c", selection: [] })).not.toThrow();
  });
});

describe("hub guard", () => {
  it("blocks per-diagram methods for diagrams the caller was not granted", async () => {
    const { service, hub } = world(asUser("carol"));
    await service.get("a-doc");
    const guarded = service.hub;
    expect(() => guarded.log("a-doc", human, "read", "x")).not.toThrow();
    expect(() => guarded.log("b-doc", human, "read", "x")).toThrow(/No diagram/);
    expect(() => guarded.subscribe("b-doc", () => undefined)).toThrow(/No diagram/);
    expect(hub.recentActivity("b-doc")).toEqual([]);
  });

  it("does not let an agent show up on a diagram it may not use", async () => {
    const { access, hub } = world(asUser("carol"));
    await access.preload();
    const guarded = guardHub(hub, access);
    guarded.touchAgent({ kind: "agent", id: "claude@carol", name: "Claude" }, "diagram_read", "b-doc");
    expect(hub.listAgents("b-doc")).toEqual([]);
    guarded.touchAgent({ kind: "agent", id: "claude@carol", name: "Claude" }, "diagram_read", "a-doc");
    expect(hub.listAgents("a-doc")).toHaveLength(1);
  });

  it("hides other people's agents and has no workspace-wide methods", async () => {
    const { access, hub } = world(asUser("carol"));
    await access.preload();
    hub.touchAgent({ kind: "agent", id: "c@dave", name: "C", ownerId: "dave" }, "t", "b-doc");
    hub.touchAgent({ kind: "agent", id: "c@carol", name: "C", ownerId: "carol" }, "t");
    const guarded = guardHub(hub, access);
    expect(guarded.listAgents().map((agent) => agent.id)).toEqual(["c@carol"]);
    expect((guarded as unknown as Record<string, unknown>).subscribeWorkspace).toBeUndefined();
    expect((guarded as unknown as Record<string, unknown>).publishWorkspace).toBeUndefined();
  });
});

describe("hub peers", () => {
  it("shares cursors, names tabs and refuses to let another account move a tab", () => {
    const hub = new Hub();
    const seen: unknown[] = [];
    hub.subscribe("d", (event) => seen.push(event));
    const first = hub.setPeer("d", { id: "t1", name: "Ana", selection: [], cursor: { x: 1, y: 2 } }, "u_ana");
    expect(first).toMatchObject({ id: "t1", name: "Ana", cursor: { x: 1, y: 2 } });
    expect(hub.setPeer("d", { id: "t1", name: "Mallory", selection: [] }, "u_mal")).toBeNull();
    const second = hub.setPeer("d", { id: "t2", name: "Ben", selection: ["n1"] }, "u_ben");
    expect(second!.color).not.toBe(first!.color);
    expect(hub.listPeers("d")).toHaveLength(2);
    hub.removePeer("d", "t1");
    expect(seen.at(-1)).toEqual({ type: "peer-left", id: "t1" });
    expect(hub.nextTabName("d")).toBe("Tab 1");
  });
});
