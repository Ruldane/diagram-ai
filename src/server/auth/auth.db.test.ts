import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDoc } from "@/core/model/defaults";
import type { Actor } from "@/core/model/types";

// The service reads packs from the data directory; keep it away from the real ./data.
const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/diagram-ai-auth-${Date.now()}`;
  process.env.DIAGRAM_DATA_DIR = dir;
  return dir;
});

import { createDatabaseState, createPool } from "../db/database";
import { importFiles } from "../db/import-files";
import { migrate } from "../db/migrate";
import { Hub } from "../realtime/hub";
import { createServiceState, DiagramService } from "../service";
import { createPostgresState, PostgresRepository } from "../store/postgres";
import { Access, type Principal } from "./access";
import { guardService } from "./guard";
import { createRateLimitState } from "./rate-limit";
import { AuthService, type AuthOptions, type ClientInfo } from "./service";
import { AuthStore, type UserRecord } from "./store";
import { hashToken } from "./tokens";

/**
 * Accounts against a real PostgreSQL: `DATABASE_URL_TEST=... npm run test:db`.
 * Works in a throw-away schema, so it is safe on a development database.
 */
const url = process.env.DATABASE_URL_TEST;
const COST = { logN: 10, r: 8, p: 1 };
const PASSWORD = "correct horse battery staple";
const client: ClientInfo = { userAgent: "vitest", ip: null };
const human: Actor = { kind: "human", id: "browser", name: "You" };

describe.skipIf(!url)("accounts on PostgreSQL", () => {
  const schema = `diagram_ai_auth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let admin: Pool;
  let pool: Pool;
  let store: AuthStore;
  let repository: PostgresRepository;
  let service: DiagramService;
  let hub: Hub;
  let n = 0;
  const email = (name: string) => `${name}.${Date.now().toString(36)}${n++}@example.com`;

  const auth = (options: AuthOptions = {}, now?: () => number) => new AuthService(store, createRateLimitState(), { cost: COST, now, ...options });
  const count = async (sql: string, values: unknown[] = []) => Number((await pool.query<{ n: string }>(sql, values)).rows[0].n);

  /** Guarded view of the service for a signed-in user, the way a request gets it. */
  function as(user: UserRecord, extra: Partial<Principal> = {}) {
    const access = new Access({ via: "session", user, ...extra }, auth());
    const guarded = guardService(service, access, {
      settle: () => repository.flush(),
      claim: (diagramId, userId) => store.setOwner(diagramId, userId),
    });
    return { access, service: guarded };
  }

  beforeAll(async () => {
    admin = createPool(url as string, { max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = createPool(url as string, { options: `-c search_path=${schema}` });
    await migrate(pool);
    store = new AuthStore(pool);
    hub = new Hub();
    repository = new PostgresRepository(createPostgresState(createDatabaseState(pool, Promise.resolve(2))), { writeDelayMs: 10 });
    service = new DiagramService(repository, hub, createServiceState());
  });

  afterAll(async () => {
    await repository?.flush();
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.end();
    void dataDir;
  });

  /* ---------------------------------------------------------- the first user */

  it("makes the first account an administrator and gives it every unowned diagram", async () => {
    // Diagrams that exist before any account: imported files, or from before accounts were switched on.
    for (const id of ["legacy_a", "legacy_b"]) {
      await pool.query(
        `INSERT INTO diagrams (id, name, type, doc, version, owner_id, created_at, updated_at)
         VALUES ($1, $1, 'blank', '{}'::jsonb, 1, $2, now(), now())`,
        [id, id === "legacy_b" ? "local" : null],
      );
    }
    const service = auth();
    expect(await service.signupMode()).toBe("first");
    const { user, first, claimed } = await service.register({ email: email("root"), name: "Root User", password: PASSWORD }, client);
    expect(first).toBe(true);
    expect(user.isAdmin).toBe(true);
    expect(claimed).toBeGreaterThanOrEqual(2);
    expect(await store.roleOn(user.id, "legacy_a")).toBe("owner");
    expect(await store.roleOn(user.id, "legacy_b")).toBe("owner");
    expect((await store.listMembers("legacy_a"))[0]).toMatchObject({ userId: user.id, role: "owner" });
  });

  it("serialises simultaneous first sign-ups: exactly one administrator", async () => {
    const fresh = `${schema}_race`;
    await admin.query(`CREATE SCHEMA ${fresh}`);
    const racePool = createPool(url as string, { options: `-c search_path=${fresh}` });
    try {
      await migrate(racePool);
      const racers = Array.from({ length: 6 }, () => new AuthService(new AuthStore(racePool), createRateLimitState(), { cost: COST, signup: "open" }));
      const results = await Promise.allSettled(racers.map((s, i) => s.register({ email: `r${i}@example.com`, name: `R${i}`, password: PASSWORD }, client)));
      const ok = results.filter((r) => r.status === "fulfilled");
      expect(ok).toHaveLength(6);
      expect(await count(`SELECT count(*) AS n FROM ${fresh}.users WHERE is_admin`)).toBe(1);
    } finally {
      await racePool.end();
      await admin.query(`DROP SCHEMA ${fresh} CASCADE`);
    }
  });

  /* ------------------------------------------------------------- sign up */

  it("by default only the first account registers freely; later ones need an invitation", async () => {
    const service = auth();
    expect(await service.signupMode()).toBe("invite");
    await expect(service.register({ email: email("late"), name: "Late", password: PASSWORD }, client)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.register({ email: email("late"), name: "Late", password: PASSWORD, invite: "not-a-link" }, client)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("closed sign-up refuses even a valid invitation; open sign-up accepts anyone", async () => {
    const owner = (await store.listUsers())[0];
    await pool.query("INSERT INTO diagrams (id, name, type, doc, version, owner_id, created_at, updated_at) VALUES ('inv_doc', 'inv', 'blank', '{}'::jsonb, 1, $1, now(), now())", [owner.id]);
    const link = await auth().createShareLink("inv_doc", owner.id, { role: "viewer" });
    await expect(auth({ signup: "closed" }).register({ email: email("c"), name: "C", password: PASSWORD, invite: link.token }, client)).rejects.toMatchObject({ code: "forbidden" });
    expect(await auth({ signup: "open" }).register({ email: email("o"), name: "O", password: PASSWORD }, client)).toMatchObject({ first: false });
    expect(await auth().register({ email: email("i"), name: "I", password: PASSWORD, invite: link.token }, client)).toMatchObject({ first: false });
  });

  it("validates input and refuses a duplicate address without a stack trace", async () => {
    const service = auth({ signup: "open" });
    const address = email("dup");
    await service.register({ email: address, name: "Dup", password: PASSWORD }, client);
    await expect(service.register({ email: address.toUpperCase(), name: "Dup", password: PASSWORD }, client)).rejects.toMatchObject({ code: "conflict" });
    await expect(service.register({ email: "nope", name: "X", password: PASSWORD }, client)).rejects.toMatchObject({ code: "invalid" });
    await expect(service.register({ email: email("w"), name: "X", password: "short" }, client)).rejects.toMatchObject({ code: "invalid" });
  });

  /* -------------------------------------------------------------- sign in */

  it("signs in, resolves the session, and signs out", async () => {
    const service = auth({ signup: "open" });
    const address = email("ana");
    await service.register({ email: address, name: "Ana", password: PASSWORD }, client);
    const { token, user } = await service.login({ email: address.toUpperCase(), password: PASSWORD }, client);
    expect((await service.userForSession(token))?.user.id).toBe(user.id);
    await service.logout(token);
    expect(await service.userForSession(token)).toBeNull();
    expect(await service.userForSession("garbage")).toBeNull();
  });

  it("stores only hashes: no session cookie value, token or share token appears in the database", async () => {
    const service = auth({ signup: "open" });
    const address = email("hash");
    const { token: session, user } = await service.register({ email: address, name: "Hash", password: PASSWORD }, client);
    const api = await service.createApiToken(user.id, { name: "laptop", scope: "write" });
    await pool.query("INSERT INTO diagrams (id, name, type, doc, version, owner_id, created_at, updated_at) VALUES ('hash_doc', 'h', 'blank', '{}'::jsonb, 1, $1, now(), now())", [user.id]);
    const link = await service.createShareLink("hash_doc", user.id, { role: "viewer" });
    const dump = JSON.stringify([
      (await pool.query("SELECT * FROM sessions")).rows,
      (await pool.query("SELECT * FROM api_tokens")).rows,
      (await pool.query("SELECT * FROM share_links")).rows,
      (await pool.query("SELECT * FROM users WHERE id = $1", [user.id])).rows,
    ]);
    for (const secret of [session, api.token!, link.token!, PASSWORD]) expect(dump).not.toContain(secret);
    expect(dump).toContain(hashToken(session));
    expect(dump).toContain(hashToken(api.token!));
    expect(dump).toContain(hashToken(link.token!));
    expect((await pool.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0].password_hash).toMatch(/^scrypt\$/);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const service = auth({ signup: "open" });
    const address = email("same");
    await service.register({ email: address, name: "Same", password: PASSWORD }, client);
    const wrong = await service.login({ email: address, password: "not the password" }, client).catch((e: Error & { code: string }) => e);
    const unknown = await service.login({ email: email("ghost"), password: "not the password" }, client).catch((e: Error & { code: string }) => e);
    expect(wrong).toMatchObject({ code: "unauthenticated" });
    expect((wrong as Error).message).toBe((unknown as Error).message);
    expect((unknown as { code: string }).code).toBe("unauthenticated");
  });

  it("rate limits repeated failures per email and forgives after success", async () => {
    const service = auth({ signup: "open" });
    const address = email("rate");
    await service.register({ email: address, name: "Rate", password: PASSWORD }, client);
    for (let i = 0; i < 8; i++) await expect(service.login({ email: address, password: "wrong password!" }, client)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(service.login({ email: address, password: PASSWORD }, client)).rejects.toMatchObject({ code: "rate_limited" });
    // another address is unaffected
    const other = email("rate2");
    await service.register({ email: other, name: "Other", password: PASSWORD }, client);
    await expect(service.login({ email: other, password: PASSWORD }, client)).resolves.toBeTruthy();
  });

  it("expires sessions: absolute lifetime and idle time", async () => {
    let now = Date.now();
    const service = auth({ signup: "open" }, () => now);
    const address = email("exp");
    await service.register({ email: address, name: "Exp", password: PASSWORD }, client);
    const { token } = await service.login({ email: address, password: PASSWORD }, client);
    expect(await service.userForSession(token)).not.toBeNull();
    // Idle: the database clock is real, so age the row instead of the process clock.
    await pool.query("UPDATE sessions SET last_used_at = now() - interval '8 days' WHERE token_hash = $1", [hashToken(token)]);
    expect(await service.userForSession(token)).toBeNull();
    const second = (await service.login({ email: address, password: PASSWORD }, client)).token;
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hashToken(second)]);
    expect(await service.userForSession(second)).toBeNull();
    now += 1;
  });

  it("rotates a session: the new token works at once, the old one only briefly", async () => {
    const service = auth({ signup: "open" });
    const address = email("rot");
    await service.register({ email: address, name: "Rot", password: PASSWORD }, client);
    const { token, user } = await service.login({ email: address, password: PASSWORD }, client);
    const next = await service.rotateSession(hashToken(token), user.id, client);
    expect(next.token).not.toBe(token);
    expect(await service.userForSession(next.token)).not.toBeNull();
    expect(await service.userForSession(token)).not.toBeNull(); // grace period
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hashToken(token)]);
    expect(await service.userForSession(token)).toBeNull();
  });

  it("changing the password signs out other sessions", async () => {
    const service = auth({ signup: "open" });
    const address = email("pw");
    const { user } = await service.register({ email: address, name: "Pw", password: PASSWORD }, client);
    const keep = await service.login({ email: address, password: PASSWORD }, client);
    const other = await service.login({ email: address, password: PASSWORD }, client);
    const fresh = (await store.findUserById(user.id))!;
    await expect(service.changePassword(fresh, { current: "wrong wrong wrong", next: "another long password" }, hashToken(keep.token))).rejects.toMatchObject({ code: "forbidden" });
    await service.changePassword(fresh, { current: PASSWORD, next: "another long password" }, hashToken(keep.token));
    expect(await service.userForSession(keep.token)).not.toBeNull();
    expect(await service.userForSession(other.token)).toBeNull();
    await expect(service.login({ email: address, password: PASSWORD }, client)).rejects.toBeTruthy();
    await expect(service.login({ email: address, password: "another long password" }, client)).resolves.toBeTruthy();
  });

  it("a disabled account cannot sign in and its sessions end", async () => {
    const service = auth({ signup: "open" });
    const boss = (await store.listUsers())[0];
    const address = email("dis");
    const { user, token } = await service.register({ email: address, name: "Dis", password: PASSWORD }, client);
    await service.setDisabled(boss.id, user.id, true);
    expect(await service.userForSession(token)).toBeNull();
    await expect(service.login({ email: address, password: PASSWORD }, client)).rejects.toMatchObject({ code: "forbidden" });
    await service.setDisabled(boss.id, user.id, false);
    await expect(service.login({ email: address, password: PASSWORD }, client)).resolves.toBeTruthy();
  });

  /* ------------------------------------------------------- access tokens */

  it("personal access tokens authenticate until revoked or expired", async () => {
    const service = auth({ signup: "open" });
    const { user } = await service.register({ email: email("pat"), name: "Pat", password: PASSWORD }, client);
    const created = await service.createApiToken(user.id, { name: "claude code", scope: "read" });
    expect(created.token).toMatch(/^dai_/);
    expect(await service.userForApiToken(created.token!)).toMatchObject({ user: { id: user.id }, scope: "read" });
    expect((await service.listApiTokens(user.id)).map((t) => t.id)).toContain(created.id);
    expect(JSON.stringify(await service.listApiTokens(user.id))).not.toContain(created.token!);
    await service.revokeApiToken(user.id, created.id);
    expect(await service.userForApiToken(created.token!)).toBeNull();
    expect(await service.userForApiToken("dai_" + "x".repeat(43))).toBeNull();

    const expiring = await service.createApiToken(user.id, { name: "short", scope: "write", expiresInDays: 1 });
    await pool.query("UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id = $1", [expiring.id]);
    expect(await service.userForApiToken(expiring.token!)).toBeNull();
  });

  it("one account cannot revoke another account's token", async () => {
    const service = auth({ signup: "open" });
    const a = await service.register({ email: email("ta"), name: "A", password: PASSWORD }, client);
    const b = await service.register({ email: email("tb"), name: "B", password: PASSWORD }, client);
    const token = await service.createApiToken(a.user.id, { name: "mine", scope: "write" });
    await expect(service.revokeApiToken(b.user.id, token.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await service.userForApiToken(token.token!)).not.toBeNull();
  });

  /* ---------------------------------------------- diagrams, members, links */

  it("end to end: ownership, listing, IDOR, sharing by email and by link, revocation, deletion", async () => {
    const accounts = auth({ signup: "open" });
    const alice = (await accounts.register({ email: email("alice"), name: "Alice A", password: PASSWORD }, client)).user;
    const bob = (await accounts.register({ email: email("bob"), name: "Bob B", password: PASSWORD }, client)).user;
    const carol = (await accounts.register({ email: email("carol"), name: "Carol C", password: PASSWORD }, client)).user;

    // Alice creates a diagram: it is hers and nobody else sees it.
    const a = as(alice);
    const doc = await a.service.create({ name: "Alice's design" }, human);
    expect(await store.roleOn(alice.id, doc.id)).toBe("owner");
    expect((await pool.query("SELECT owner_id FROM diagrams WHERE id = $1", [doc.id])).rows[0].owner_id).toBe(alice.id);
    expect((await a.service.list()).map((d) => d.id)).toContain(doc.id);

    // Bob: cannot list, read, patch, comment, export, snapshot, or delete it (IDOR).
    const b = as(bob);
    expect((await b.service.list()).map((d) => d.id)).not.toContain(doc.id);
    await expect(b.service.get(doc.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(b.service.commit(doc.id, { doc: { name: "hijacked" } }, human)).rejects.toMatchObject({ code: "not_found" });
    await expect(b.service.deleteDiagram(doc.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(b.service.export(doc.id, "svg")).rejects.toMatchObject({ code: "not_found" });
    await expect(b.service.listSnapshots(doc.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await service.get(doc.id)).name).toBe("Alice's design");

    // Share by email as viewer: Bob reads but cannot write.
    await accounts.addMember(doc.id, bob.email, "viewer");
    const bobViewer = as(bob);
    expect((await bobViewer.service.get(doc.id)).id).toBe(doc.id);
    expect((await bobViewer.service.list()).map((d) => d.id)).toContain(doc.id);
    await expect(bobViewer.service.commit(doc.id, { doc: { name: "x" } }, human)).rejects.toMatchObject({ code: "forbidden" });
    await expect(bobViewer.service.deleteDiagram(doc.id)).rejects.toMatchObject({ code: "forbidden" });

    // Promote to editor: writes go through, credited to Bob, and deletion is still the owner's.
    await accounts.setMemberRole(doc.id, bob.id, "editor");
    const bobEditor = as(bob);
    await bobEditor.service.commit(doc.id, { doc: { name: "Bob's edit" } }, human);
    expect((await service.get(doc.id)).name).toBe("Bob's edit");
    await expect(bobEditor.service.deleteDiagram(doc.id)).rejects.toMatchObject({ code: "forbidden" });
    await repository.flush();
    const log = await pool.query<{ actor: Actor }>("SELECT actor FROM diagram_ops WHERE diagram_id = $1", [doc.id]);
    expect(log.rows.some((row) => row.actor.name === "Bob B" && row.actor.id === bob.id)).toBe(true);

    // Comment authorship cannot be forged by an editor.
    await bobEditor.service.commit(
      doc.id,
      { comments: { set: [{ id: "c_forged", x: 0, y: 0, author: { kind: "human", id: alice.id, name: "Alice A" }, text: "I am Alice", createdAt: new Date().toISOString(), replies: [] }] } },
      human,
    );
    expect((await service.get(doc.id)).comments.c_forged.author).toMatchObject({ id: bob.id, name: "Bob B" });

    // The owner cannot be demoted or removed; members can be.
    await expect(accounts.removeMember(doc.id, alice.id)).rejects.toMatchObject({ code: "conflict" });
    await expect(accounts.setMemberRole(doc.id, alice.id, "viewer")).rejects.toMatchObject({ code: "conflict" });
    await accounts.removeMember(doc.id, bob.id);
    await expect(as(bob).service.get(doc.id)).rejects.toMatchObject({ code: "not_found" });

    // Share links: anyone with the link reads; revoking ends it at once.
    const link = await accounts.createShareLink(doc.id, alice.id, { role: "viewer" });
    expect(link.token!.length * 6).toBeGreaterThanOrEqual(128);
    const redeemed = await accounts.redeem(link.token!, null);
    expect(redeemed).toMatchObject({ diagramId: doc.id, role: "viewer" });
    const stranger = new Access({ via: "anonymous", user: null }, accounts, () => link.token!);
    expect(await stranger.role(doc.id)).toBe("viewer");
    await accounts.revokeShareLink(doc.id, link.id);
    const strangerAfter = new Access({ via: "anonymous", user: null }, accounts, () => link.token!);
    expect(await strangerAfter.role(doc.id)).toBeNull();
    await expect(accounts.redeem(link.token!, carol.id)).rejects.toMatchObject({ code: "not_found" });

    // An editor link, redeemed while signed in, makes the person a member; anonymous it stays read-only.
    const editorLink = await accounts.createShareLink(doc.id, alice.id, { role: "editor", expiresInDays: 7 });
    expect((await accounts.redeem(editorLink.token!, null)).role).toBe("viewer");
    expect((await accounts.redeem(editorLink.token!, carol.id)).role).toBe("editor");
    expect(await store.roleOn(carol.id, doc.id)).toBe("editor");
    // Redeeming a weaker link never demotes.
    const viewerLink = await accounts.createShareLink(doc.id, alice.id, { role: "viewer" });
    expect((await accounts.redeem(viewerLink.token!, carol.id)).role).toBe("editor");
    // Expiry is enforced.
    await pool.query("UPDATE share_links SET expires_at = now() - interval '1 minute' WHERE id = $1", [editorLink.id]);
    await expect(accounts.redeem(editorLink.token!, null)).rejects.toMatchObject({ code: "not_found" });

    // The owner sees who has access; deleting the diagram removes members and links with it.
    expect((await accounts.members(doc.id)).map((m) => m.role)).toContain("owner");
    await a.service.deleteDiagram(doc.id);
    expect(await count("SELECT count(*) AS n FROM diagram_members WHERE diagram_id = $1", [doc.id])).toBe(0);
    expect(await count("SELECT count(*) AS n FROM share_links WHERE diagram_id = $1", [doc.id])).toBe(0);
  });

  it("listing reports the role and owner of each diagram", async () => {
    const accounts = auth({ signup: "open" });
    const ann = (await accounts.register({ email: email("ann"), name: "Ann", password: PASSWORD }, client)).user;
    const ben = (await accounts.register({ email: email("ben"), name: "Ben", password: PASSWORD }, client)).user;
    const own = await as(ann).service.create({ name: "ann's" }, human);
    const theirs = await as(ben).service.create({ name: "ben's" }, human);
    await accounts.addMember(theirs.id, ann.email, "viewer");
    const rows = await accounts.accessList(ann.id);
    const byId = new Map(rows.map((row) => [row.diagramId, row]));
    expect(byId.get(own.id)).toMatchObject({ role: "owner", shared: false });
    expect(byId.get(theirs.id)).toMatchObject({ role: "viewer", ownerName: "Ben", shared: true });
  });

  it("cannot add a member who has no account, nor the owner as a member", async () => {
    const accounts = auth({ signup: "open" });
    const owner = (await accounts.register({ email: email("own"), name: "Own", password: PASSWORD }, client)).user;
    const doc = await as(owner).service.create({ name: "x" }, human);
    await expect(accounts.addMember(doc.id, "nobody@example.com", "viewer")).rejects.toMatchObject({ code: "not_found" });
    await expect(accounts.addMember(doc.id, owner.email, "editor")).rejects.toMatchObject({ code: "conflict" });
  });

  it("imports files for an account given by email, and for nobody yet", async () => {
    const accounts = auth({ signup: "open" });
    const address = email("imp");
    const { user } = await accounts.register({ email: address, name: "Imp", password: PASSWORD }, client);
    const dir = await mkdtemp(path.join(tmpdir(), "diagram-ai-import-"));
    try {
      await mkdir(path.join(dir, "diagrams"));
      for (const id of ["imp_owned", "imp_unowned"]) await writeFile(path.join(dir, "diagrams", `${id}.json`), JSON.stringify(createDoc({ id, name: id })));
      await importFiles(pool, { dir, owner: address.toUpperCase() });
      expect(await store.roleOn(user.id, "imp_owned")).toBe("owner");
      expect((await pool.query("SELECT owner_id FROM diagrams WHERE id = 'imp_owned'")).rows[0].owner_id).toBe(user.id);
      await expect(importFiles(pool, { dir, owner: "nobody@example.com", overwrite: true })).rejects.toThrow(/No account uses/);
      // An id that is not an account is stored as given, to be claimed by the first account that registers.
      await importFiles(pool, { dir, owner: "local", overwrite: true });
      expect((await pool.query("SELECT owner_id FROM diagrams WHERE id = 'imp_unowned'")).rows[0].owner_id).toBe("local");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a diagram that cannot record its owner is not left behind", async () => {
    const accounts = auth({ signup: "open" });
    const owner = (await accounts.register({ email: email("fail"), name: "Fail", password: PASSWORD }, client)).user;
    const access = new Access({ via: "session", user: owner }, accounts);
    const broken = guardService(service, access, { settle: async () => undefined, claim: async () => false });
    const before = (await service.list()).length;
    await expect(broken.create({ name: "orphan" }, human)).rejects.toThrow(/could not be created/);
    expect((await service.list()).length).toBe(before);
  });
});
