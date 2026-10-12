import { atLeast, maxRole, minRole, type DiagramAccess, type Role } from "@/core/auth";
import type { Actor } from "@/core/model/types";

import { forbidden, notFound, unauthenticated } from "../errors";
import { parseCookies, SECURE_SESSION_COOKIE, SESSION_COOKIE, SHARE_COOKIE } from "./cookies";
import type { AuthService } from "./service";
import type { UserRecord } from "./store";
import { hashToken } from "./tokens";

/** Who is calling, after cookies and headers have been checked. */
export interface Principal {
  /**
   * `local`: accounts are off, the caller is trusted as the owner of everything.
   * `session`: a signed-in browser. `token`: a personal access token.
   * `anonymous`: nobody; may still hold a share-link cookie for a diagram.
   */
  via: "local" | "session" | "token" | "anonymous";
  user: UserRecord | null;
  sessionHash?: string;
  /** Age of the session, so the session endpoint can rotate it. */
  sessionAgeMs?: number;
  token?: { id: string; scope: "read" | "write" };
}

export const LOCAL_PRINCIPAL: Principal = { via: "local", user: null };

export function sessionTokenFrom(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  return cookies.get(SECURE_SESSION_COOKIE) ?? cookies.get(SESSION_COOKIE) ?? null;
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match ? match[1] : null;
}

/** Whether the request reached the server over HTTPS (directly, or via a proxy that says so and is trusted). */
export function isSecureRequest(request: Request, trustProxy: boolean): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return trustProxy && request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() === "https";
}

/**
 * Works out the caller from the request. A `Bearer` header always wins and is
 * never mixed with cookies; a bad one is a 401, not an anonymous request.
 */
export async function resolvePrincipal(request: Request, auth: AuthService): Promise<Principal> {
  const bearer = bearerFrom(request);
  if (bearer) {
    const found = await auth.userForApiToken(bearer);
    if (!found) throw unauthenticated("That access token is not valid (it may have been revoked or expired). Create a new one in your account settings.");
    return { via: "token", user: found.user, token: { id: found.tokenId, scope: found.scope } };
  }
  const cookie = sessionTokenFrom(request);
  if (cookie) {
    const found = await auth.userForSession(cookie);
    if (found) return { via: "session", user: found.user, sessionHash: found.hash, sessionAgeMs: found.age };
  }
  return { via: "anonymous", user: null };
}

/**
 * Browser requests that change something and rely on a cookie must come from
 * this site. `SameSite=Lax` already withholds the cookie from cross-site
 * POSTs; this also rejects a request that names no origin at all, which a
 * browser always does for `fetch` and forms.
 */
export function assertBrowserOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (host && originHost === host) return;
    throw forbidden("Cross-origin requests are not allowed.");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  throw forbidden("This request has no Origin header. Send the Origin of this site, or use a personal access token.");
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const isMutating = (request: Request): boolean => MUTATING.has(request.method.toUpperCase());

/**
 * One request's view of what its caller may do. Roles are looked up lazily and
 * remembered, so a route that checks a diagram and then calls the service
 * touches the database once.
 */
export class Access {
  private readonly roles = new Map<string, Role | null>();
  private preloaded: Map<string, DiagramAccess> | null = null;

  constructor(
    readonly principal: Principal,
    private readonly auth: AuthService | null,
    /** The share-link token this request carries for a diagram, if any. */
    private readonly shareToken: (diagramId: string) => string | null = () => null,
  ) {}

  get local(): boolean {
    return this.principal.via === "local";
  }

  get user(): UserRecord | null {
    return this.principal.user;
  }

  /** Throws a 401 unless a person (not a share link, not "anonymous") is signed in. Solo mode counts as signed in. */
  requireUser(): UserRecord | null {
    if (this.local) return null;
    if (!this.principal.user) throw unauthenticated();
    return this.principal.user;
  }

  /** Things that affect everybody on the server (icon packs) need an administrator; solo mode is its own administrator. */
  requireAdmin(): void {
    if (this.local) return;
    const user = this.requireUser();
    if (!user?.isAdmin) throw forbidden("Only an administrator can change this.");
  }

  /** Session-only operations (account settings, tokens) are not available to a personal access token. */
  requireSession(): UserRecord {
    const user = this.principal.user;
    if (!user || this.principal.via !== "session") throw unauthenticated("Sign in to continue.");
    return user;
  }

  /** The caller's role on a diagram, or null for none. */
  async role(diagramId: string): Promise<Role | null> {
    if (this.local) return "owner";
    const cached = this.roles.get(diagramId);
    if (cached !== undefined) return cached;
    const role = await this.resolveRole(diagramId);
    this.roles.set(diagramId, role);
    return role;
  }

  private async resolveRole(diagramId: string): Promise<Role | null> {
    const auth = this.auth;
    if (!auth) return null;
    const { user, token } = this.principal;
    let role: Role | null = null;
    if (user) {
      role = await auth.store.roleOn(user.id, diagramId);
      if (token?.scope === "read") role = minRole(role, "viewer");
    }
    const link = this.shareToken(diagramId);
    if (link) {
      const granted = await auth.store.linkRoleOn(hashToken(link), diagramId);
      // A link grants editing only to a signed-in person; anyone else is a reader.
      const effective: Role | null = granted === "editor" && !(user && token?.scope !== "read") ? "viewer" : granted;
      role = maxRole(role, effective);
    }
    return role;
  }

  /** The role last looked up for a diagram: `undefined` when it has not been asked about yet. */
  cached(diagramId: string): Role | null | undefined {
    return this.local ? "owner" : this.roles.get(diagramId);
  }

  /** Throws unless the caller has at least `needed`. Missing and forbidden diagrams look the same to a stranger. */
  async require(diagramId: string, needed: Role): Promise<Role> {
    const role = await this.role(diagramId);
    if (atLeast(role, needed)) return role as Role;
    if (!role) {
      if (!this.principal.user) throw unauthenticated();
      throw notFound(`No diagram with id "${diagramId}". Use diagram_list to see available diagrams.`);
    }
    const what = needed === "owner" ? "Only the owner can do that." : needed === "editor" ? "You have view-only access to this diagram." : "You do not have access to this diagram.";
    throw forbidden(what);
  }

  /** Loads every diagram the caller can open, so synchronous checks (the hub guard) have the answer. */
  async preload(): Promise<Map<string, DiagramAccess>> {
    if (this.preloaded) return this.preloaded;
    const map = new Map<string, DiagramAccess>();
    const user = this.principal.user;
    if (user && this.auth) {
      for (const row of await this.auth.accessList(user.id)) {
        const role = this.principal.token?.scope === "read" ? minRole(row.role, "viewer") : row.role;
        if (!role) continue;
        map.set(row.diagramId, { role, shared: row.shared, ...(row.ownerId && row.ownerId !== user.id && row.ownerName ? { ownerName: row.ownerName } : {}) });
        this.roles.set(row.diagramId, role);
      }
    }
    this.preloaded = map;
    return map;
  }

  /** Remember the role of a diagram just created by the caller. */
  grantLocally(diagramId: string, role: Role): void {
    this.roles.set(diagramId, role);
    this.preloaded?.set(diagramId, { role, shared: false });
  }

  /** Authorship for edits made over REST: the person's name instead of the browser's "You". */
  humanActor(actor: Actor): Actor {
    const user = this.principal.user;
    if (!user || actor.kind !== "human") return actor;
    return { kind: "human", id: user.id, name: user.name };
  }

  /** Authorship for an agent: attributed to the account whose token it used. */
  agentActor(actor: Actor): Actor {
    const user = this.principal.user;
    if (!user || actor.kind === "human") return actor;
    const first = user.name.split(" ")[0];
    return { kind: actor.kind, id: `${actor.id}@${user.id}`.slice(0, 80), name: `${actor.name} (${first})`.slice(0, 80), ownerId: user.id };
  }

  /** Rewrites an actor the caller supplied into the one the server vouches for. */
  actor(actor: Actor): Actor {
    if (this.local) return actor;
    return actor.kind === "human" ? this.humanActor(actor) : actor.ownerId === this.principal.user?.id ? actor : this.agentActor({ ...actor, ownerId: undefined });
  }
}

export { SHARE_COOKIE };
