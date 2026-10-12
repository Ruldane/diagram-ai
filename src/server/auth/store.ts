import type { Pool } from "pg";

import { isRole, type Role, type ShareRole } from "@/core/auth";

import { conflict } from "../errors";
import { inTransaction, rows, type Queryable } from "../db/sql";

/** Everything the auth layer reads and writes in PostgreSQL. Plain SQL, no rules: those live in `AuthService`. */

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_admin: boolean;
  created_at: Date;
  last_login_at: Date | null;
  disabled_at: Date | null;
}

const USER_COLUMNS = "id, email, name, password_hash, is_admin, created_at, last_login_at, disabled_at";

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  name: row.name,
  passwordHash: row.password_hash,
  isAdmin: row.is_admin,
  createdAt: row.created_at.toISOString(),
  lastLoginAt: row.last_login_at?.toISOString() ?? null,
  disabled: row.disabled_at !== null,
});

export interface SessionRecord {
  tokenHash: string;
  user: UserRecord;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface TokenRecord {
  id: string;
  user: UserRecord;
  scope: "read" | "write";
}

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface LinkRecord {
  id: string;
  diagramId: string;
  role: ShareRole;
  expiresAt: string | null;
  createdBy: string | null;
}

export interface LinkRow {
  id: string;
  role: ShareRole;
  hint: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface AccessRow {
  diagramId: string;
  role: Role;
  ownerId: string | null;
  ownerName: string | null;
  shared: boolean;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export class AuthStore {
  constructor(private readonly pool: Pool) {}

  /* ---------------------------------------------------------------- users */

  async countUsers(db: Queryable = this.pool): Promise<number> {
    const [row] = await rows<{ n: string }>(db, "SELECT count(*) AS n FROM users");
    return Number(row?.n ?? 0);
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await rows<UserRow>(this.pool, `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [email]);
    return row ? toUser(row) : null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const [row] = await rows<UserRow>(this.pool, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return row ? toUser(row) : null;
  }

  async listUsers(): Promise<UserRecord[]> {
    return (await rows<UserRow>(this.pool, `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at`)).map(toUser);
  }

  /**
   * Inserts a user. Serialised with an advisory lock so two simultaneous
   * first sign-ups cannot both become the administrator. `check` sees the
   * number of existing users and may refuse (it returns a message).
   *
   * The first user also claims every diagram that has no owner yet, which is
   * how diagrams imported from files or created before accounts get one.
   */
  async createUser(
    input: { id: string; email: string; name: string; passwordHash: string; admin?: boolean },
    check: (existing: number) => string | null,
  ): Promise<{ user: UserRecord; first: boolean; claimed: number }> {
    return inTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('diagram-ai:users'))");
      const existing = await this.countUsers(client);
      const refusal = check(existing);
      if (refusal) throw conflict(refusal);
      const first = existing === 0;
      try {
        const [row] = await rows<UserRow>(
          client,
          `INSERT INTO users (id, email, name, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5) RETURNING ${USER_COLUMNS}`,
          [input.id, input.email, input.name, input.passwordHash, first || Boolean(input.admin)],
        );
        let claimed = 0;
        if (first) {
          const result = await client.query(
            "UPDATE diagrams SET owner_id = $1 WHERE owner_id IS NULL OR owner_id NOT IN (SELECT id FROM users)",
            [input.id],
          );
          claimed = result.rowCount ?? 0;
          await client.query(
            `INSERT INTO diagram_members (diagram_id, user_id, role) SELECT id, $1, 'owner' FROM diagrams WHERE owner_id = $1
             ON CONFLICT (diagram_id, user_id) DO UPDATE SET role = 'owner'`,
            [input.id],
          );
        }
        return { user: toUser(row), first, claimed };
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw conflict("An account with that email already exists. Sign in instead.");
        throw error;
      }
    });
  }

  async touchLogin(userId: string): Promise<void> {
    await this.pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [userId, passwordHash]);
  }

  async updateName(userId: string, name: string): Promise<void> {
    await this.pool.query("UPDATE users SET name = $2 WHERE id = $1", [userId, name]);
  }

  async setDisabled(userId: string, disabled: boolean): Promise<void> {
    await this.pool.query("UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1", [userId, disabled]);
  }

  /* ------------------------------------------------------------- sessions */

  async createSession(input: { tokenHash: string; userId: string; expiresAt: Date; userAgent: string | null }): Promise<void> {
    await this.pool.query("INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)", [
      input.tokenHash,
      input.userId,
      input.expiresAt,
      input.userAgent?.slice(0, 300) ?? null,
    ]);
  }

  /** The live session for a cookie value hash, or null when it is unknown, expired, idle for too long or its user is disabled. */
  async findSession(tokenHash: string, idleMs: number): Promise<SessionRecord | null> {
    const [row] = await rows<UserRow & { token_hash: string; s_created: Date; s_used: Date }>(
      this.pool,
      `SELECT s.token_hash, s.created_at AS s_created, s.last_used_at AS s_used,
              u.id, u.email, u.name, u.password_hash, u.is_admin, u.created_at, u.last_login_at, u.disabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND s.last_used_at > now() - ($2 * interval '1 millisecond')
         AND u.disabled_at IS NULL`,
      [tokenHash, idleMs],
    );
    return row ? { tokenHash: row.token_hash, user: toUser(row), createdAt: row.s_created, lastUsedAt: row.s_used } : null;
  }

  /** Records activity, at most every few minutes so reads do not turn into writes. */
  async touchSession(tokenHash: string): Promise<void> {
    await this.pool.query("UPDATE sessions SET last_used_at = now() WHERE token_hash = $1 AND last_used_at < now() - interval '5 minutes'", [tokenHash]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  /** Ends all of a user's sessions, optionally keeping one (the one changing the password). */
  async deleteUserSessions(userId: string, keepHash?: string): Promise<number> {
    const result = await this.pool.query("DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)", [userId, keepHash ?? null]);
    return result.rowCount ?? 0;
  }

  /** Lets an old token live a little longer so requests already in flight with it still succeed. */
  async shortenSession(tokenHash: string, graceMs: number): Promise<void> {
    await this.pool.query("UPDATE sessions SET expires_at = LEAST(expires_at, now() + ($2 * interval '1 millisecond')) WHERE token_hash = $1", [tokenHash, graceMs]);
  }

  async purgeSessions(idleMs: number): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE expires_at < now() OR last_used_at < now() - ($1 * interval '1 millisecond')", [idleMs]);
  }

  /* ----------------------------------------------------- personal tokens */

  async createApiToken(input: { id: string; userId: string; name: string; tokenHash: string; prefix: string; scope: "read" | "write"; expiresAt: Date | null }): Promise<void> {
    await this.pool.query(
      "INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, scope, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [input.id, input.userId, input.name, input.tokenHash, input.prefix, input.scope, input.expiresAt],
    );
  }

  async listApiTokens(userId: string): Promise<ApiTokenRow[]> {
    const found = await rows<{ id: string; name: string; prefix: string; scope: "read" | "write"; created_at: Date; last_used_at: Date | null; expires_at: Date | null }>(
      this.pool,
      `SELECT id, name, prefix, scope, created_at, last_used_at, expires_at FROM api_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC`,
      [userId],
    );
    return found.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scope: row.scope,
      createdAt: row.created_at.toISOString(),
      lastUsedAt: iso(row.last_used_at),
      expiresAt: iso(row.expires_at),
    }));
  }

  async revokeApiToken(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async findApiToken(tokenHash: string): Promise<TokenRecord | null> {
    const [row] = await rows<UserRow & { token_id: string; scope: "read" | "write" }>(
      this.pool,
      `SELECT t.id AS token_id, t.scope, u.id, u.email, u.name, u.password_hash, u.is_admin, u.created_at, u.last_login_at, u.disabled_at
       FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now()) AND u.disabled_at IS NULL`,
      [tokenHash],
    );
    return row ? { id: row.token_id, user: toUser(row), scope: row.scope } : null;
  }

  async touchApiToken(id: string): Promise<void> {
    await this.pool.query("UPDATE api_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [id]);
  }

  /* -------------------------------------------------------------- access */

  /** The user's role on one diagram: owner by `owner_id`, otherwise their membership. Null when there is none (or no such diagram). */
  async roleOn(userId: string, diagramId: string): Promise<Role | null> {
    const [row] = await rows<{ role: string | null }>(
      this.pool,
      `SELECT CASE WHEN d.owner_id = $1 THEN 'owner' ELSE m.role END AS role
       FROM diagrams d LEFT JOIN diagram_members m ON m.diagram_id = d.id AND m.user_id = $1
       WHERE d.id = $2`,
      [userId, diagramId],
    );
    return row && isRole(row.role) ? row.role : null;
  }

  /** Every diagram the user can open, with the role, the owner and whether anyone else has access. */
  async accessList(userId: string): Promise<AccessRow[]> {
    const found = await rows<{ id: string; role: string; owner_id: string | null; owner_name: string | null; shared: boolean }>(
      this.pool,
      `SELECT d.id, CASE WHEN d.owner_id = $1 THEN 'owner' ELSE m.role END AS role, d.owner_id, o.name AS owner_name,
              (EXISTS (SELECT 1 FROM diagram_members x WHERE x.diagram_id = d.id AND x.user_id <> COALESCE(d.owner_id, ''))
               OR EXISTS (SELECT 1 FROM share_links l WHERE l.diagram_id = d.id AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now()))) AS shared
       FROM diagrams d
       LEFT JOIN diagram_members m ON m.diagram_id = d.id AND m.user_id = $1
       LEFT JOIN users o ON o.id = d.owner_id
       WHERE d.owner_id = $1 OR m.user_id = $1`,
      [userId],
    );
    return found.filter((row) => isRole(row.role)).map((row) => ({ diagramId: row.id, role: row.role as Role, ownerId: row.owner_id, ownerName: row.owner_name, shared: row.shared }));
  }

  /** Makes `userId` the owner of a diagram whose row exists. Returns false when there is no such row. */
  async setOwner(diagramId: string, userId: string): Promise<boolean> {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query("UPDATE diagrams SET owner_id = $2 WHERE id = $1", [diagramId, userId]);
      if (!result.rowCount) return false;
      await client.query(
        `INSERT INTO diagram_members (diagram_id, user_id, role) VALUES ($1, $2, 'owner')
         ON CONFLICT (diagram_id, user_id) DO UPDATE SET role = 'owner'`,
        [diagramId, userId],
      );
      return true;
    });
  }

  async listMembers(diagramId: string): Promise<MemberRow[]> {
    const found = await rows<{ id: string; name: string; email: string; role: string }>(
      this.pool,
      `SELECT u.id, u.name, u.email, CASE WHEN d.owner_id = u.id THEN 'owner' ELSE m.role END AS role
       FROM diagrams d
       JOIN users u ON u.id = d.owner_id OR u.id IN (SELECT user_id FROM diagram_members WHERE diagram_id = d.id)
       LEFT JOIN diagram_members m ON m.diagram_id = d.id AND m.user_id = u.id
       WHERE d.id = $1`,
      [diagramId],
    );
    const order: Record<string, number> = { owner: 0, editor: 1, viewer: 2 };
    return found
      .filter((row) => isRole(row.role))
      .map((row) => ({ userId: row.id, name: row.name, email: row.email, role: row.role as Role }))
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  }

  async setMember(diagramId: string, userId: string, role: Role): Promise<void> {
    await this.pool.query(
      `INSERT INTO diagram_members (diagram_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (diagram_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [diagramId, userId, role],
    );
  }

  /** Adds a member only when they have no access yet or a weaker one, so redeeming a link never demotes anyone. */
  async raiseMember(diagramId: string, userId: string, role: ShareRole): Promise<void> {
    await this.pool.query(
      `INSERT INTO diagram_members (diagram_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (diagram_id, user_id) DO UPDATE SET role = EXCLUDED.role
       WHERE diagram_members.role = 'viewer' AND EXCLUDED.role = 'editor'`,
      [diagramId, userId, role],
    );
  }

  async removeMember(diagramId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM diagram_members WHERE diagram_id = $1 AND user_id = $2", [diagramId, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  async ownerOf(diagramId: string): Promise<string | null> {
    const [row] = await rows<{ owner_id: string | null }>(this.pool, "SELECT owner_id FROM diagrams WHERE id = $1", [diagramId]);
    return row?.owner_id ?? null;
  }

  /* --------------------------------------------------------- share links */

  async createLink(input: { id: string; tokenHash: string; diagramId: string; role: ShareRole; hint: string; createdBy: string; expiresAt: Date | null }): Promise<void> {
    await this.pool.query(
      "INSERT INTO share_links (id, token_hash, diagram_id, role, hint, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [input.id, input.tokenHash, input.diagramId, input.role, input.hint, input.createdBy, input.expiresAt],
    );
  }

  async listLinks(diagramId: string): Promise<LinkRow[]> {
    const found = await rows<{ id: string; role: ShareRole; hint: string; created_at: Date; expires_at: Date | null }>(
      this.pool,
      `SELECT id, role, hint, created_at, expires_at FROM share_links
       WHERE diagram_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC`,
      [diagramId],
    );
    return found.map((row) => ({ id: row.id, role: row.role, hint: row.hint, createdAt: row.created_at.toISOString(), expiresAt: iso(row.expires_at) }));
  }

  async revokeLink(diagramId: string, id: string): Promise<boolean> {
    const result = await this.pool.query("UPDATE share_links SET revoked_at = now() WHERE id = $1 AND diagram_id = $2 AND revoked_at IS NULL", [id, diagramId]);
    return (result.rowCount ?? 0) > 0;
  }

  /** A link that is neither revoked nor expired. */
  async findLink(tokenHash: string): Promise<(LinkRecord & { diagramName: string }) | null> {
    const [row] = await rows<{ id: string; diagram_id: string; role: ShareRole; expires_at: Date | null; created_by: string | null; name: string }>(
      this.pool,
      `SELECT l.id, l.diagram_id, l.role, l.expires_at, l.created_by, d.name
       FROM share_links l JOIN diagrams d ON d.id = l.diagram_id
       WHERE l.token_hash = $1 AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now())`,
      [tokenHash],
    );
    return row ? { id: row.id, diagramId: row.diagram_id, role: row.role, expiresAt: iso(row.expires_at), createdBy: row.created_by, diagramName: row.name } : null;
  }

  /** The role a link token grants on one diagram, or null when it is invalid for it. */
  async linkRoleOn(tokenHash: string, diagramId: string): Promise<ShareRole | null> {
    const [row] = await rows<{ role: ShareRole }>(
      this.pool,
      `SELECT role FROM share_links
       WHERE token_hash = $1 AND diagram_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [tokenHash, diagramId],
    );
    return row?.role ?? null;
  }
}
