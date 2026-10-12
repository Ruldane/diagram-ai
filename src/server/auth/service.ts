import { isValidEmail, normalizeEmail, passwordProblem, NAME_MAX, type ApiTokenInfo, type MemberInfo, type PublicUser, type Role, type SessionInfo, type ShareLinkInfo, type ShareRole } from "@/core/auth";
import { randomId } from "@/core/model/ids";

import { SESSION_IDLE_MS, SESSION_MAX_AGE_MS, SESSION_ROTATE_MS } from "../config";
import { conflict, forbidden, invalid, notFound, unauthenticated } from "../errors";
import { DEFAULT_COST, dummyHash, hashPassword, verifyPassword, type ScryptCost } from "./password";
import { RateLimiter, type RateLimitState } from "./rate-limit";
import type { AccessRow, ApiTokenRow, AuthStore, LinkRow, MemberRow, UserRecord } from "./store";
import { API_TOKEN_PATTERN, hashToken, newApiToken, newSessionToken, newShareToken } from "./tokens";

/** What the service needs to know about the HTTP request. */
export interface ClientInfo {
  userAgent: string | null;
  /** Only set when the deployment sits behind a proxy it trusts. */
  ip: string | null;
}

export interface AuthOptions {
  /** `DIAGRAM_AI_SIGNUP`; `undefined` means "the first account, then by invitation". */
  signup?: "open" | "invite" | "closed";
  cost?: ScryptCost;
  now?: () => number;
}

export const toPublicUser = (user: Pick<UserRecord, "id" | "name" | "email" | "isAdmin">): PublicUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  isAdmin: user.isAdmin,
});

const FAILED_LOGIN_LIMIT = 8;
const FAILED_IP_LIMIT = 40;
const LOGIN_WINDOW_MS = 15 * 60_000;
const SIGNUP_IP_LIMIT = 10;
const SIGNUP_ALL_LIMIT = 200;
const SIGNUP_WINDOW_MS = 60 * 60_000;
const MAX_TOKENS_PER_USER = 25;
const MAX_LINKS_PER_DIAGRAM = 25;
/** An old session token keeps working this long after it was replaced, for requests already in flight. */
const ROTATION_GRACE_MS = 60_000;

const GENERIC_LOGIN_ERROR = "Wrong email or password.";

/**
 * Account rules: who may register, how credentials are checked, and what
 * sessions, tokens, members and share links may do. Storage is `AuthStore`;
 * which request is allowed to do what is decided by `Access` (`access.ts`).
 */
export class AuthService {
  private readonly limiter: RateLimiter;
  private readonly cost: ScryptCost;
  private readonly now: () => number;

  constructor(
    readonly store: AuthStore,
    limits: RateLimitState,
    private readonly options: AuthOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.limiter = new RateLimiter(limits, this.now);
    this.cost = options.cost ?? DEFAULT_COST;
  }

  /* -------------------------------------------------------------- sign up */

  /** Whether the sign-up form should be offered. */
  async signupMode(): Promise<SessionInfo["signup"]> {
    if ((await this.store.countUsers()) === 0) return "first";
    return this.options.signup ?? "invite";
  }

  async register(
    input: { email: string; name: string; password: string; invite?: string },
    client: ClientInfo,
  ): Promise<{ user: UserRecord; token: string; expiresAt: Date; first: boolean; claimed: number }> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!isValidEmail(email)) throw invalid("Enter a valid email address.");
    if (!name || name.length > NAME_MAX) throw invalid(`Enter your name (up to ${NAME_MAX} characters).`);
    const problem = passwordProblem(input.password, { email, name });
    if (problem) throw invalid(problem);

    if (client.ip) this.limiter.assertAllowed(`register:ip:${client.ip}`, SIGNUP_IP_LIMIT, SIGNUP_WINDOW_MS, "sign-up attempts");
    this.limiter.assertAllowed("register:all", SIGNUP_ALL_LIMIT, SIGNUP_WINDOW_MS, "sign-ups");
    if (client.ip) this.limiter.hit(`register:ip:${client.ip}`);
    this.limiter.hit("register:all");

    // An invitation is a live share link; checked before the (slow) hash so a closed door is cheap.
    const invited = input.invite ? Boolean(await this.store.findLink(hashToken(input.invite))) : false;
    const setting = this.options.signup ?? "invite";
    const refusal = (existing: number): string | null => {
      if (existing === 0 || setting === "open") return null;
      if (setting === "closed") return "Sign-up is closed on this server. Ask an administrator for an account.";
      return invited ? null : "Sign-up is by invitation. Ask for a share link, then use it to create your account.";
    };
    if ((await this.store.countUsers()) > 0) {
      const message = refusal(1);
      if (message) throw forbidden(message);
    }

    const passwordHash = await hashPassword(input.password, this.cost);
    const { user, first, claimed } = await this.store.createUser({ id: randomId("u"), email, name, passwordHash }, refusal);
    if (first) console.info(`[diagram-ai] First account registered (${user.email}): administrator, and owner of ${claimed} existing diagram(s) that had no owner.`);
    const session = await this.openSession(user.id, client);
    return { user, ...session, first, claimed };
  }

  /** Account creation by an administrator; ignores the sign-up policy. */
  async createUserAsAdmin(input: { email: string; name: string; password: string }): Promise<UserRecord> {
    const email = normalizeEmail(input.email);
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!isValidEmail(email)) throw invalid("Enter a valid email address.");
    if (!name || name.length > NAME_MAX) throw invalid(`Enter a name (up to ${NAME_MAX} characters).`);
    const problem = passwordProblem(input.password, { email, name });
    if (problem) throw invalid(problem);
    const passwordHash = await hashPassword(input.password, this.cost);
    return (await this.store.createUser({ id: randomId("u"), email, name, passwordHash }, () => null)).user;
  }

  /* -------------------------------------------------------------- sign in */

  /**
   * Checks credentials. The same message and about the same time whether the
   * email is unknown or the password is wrong; failures are counted per
   * email (and per address behind a trusted proxy).
   */
  async login(input: { email: string; password: string }, client: ClientInfo): Promise<{ user: UserRecord; token: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const emailKey = `login:email:${email}`;
    const ipKey = client.ip ? `login:ip:${client.ip}` : null;
    this.limiter.assertAllowed(emailKey, FAILED_LOGIN_LIMIT, LOGIN_WINDOW_MS, "sign-in attempts");
    if (ipKey) this.limiter.assertAllowed(ipKey, FAILED_IP_LIMIT, LOGIN_WINDOW_MS, "sign-in attempts");

    const user = email.length <= 254 ? await this.store.findUserByEmail(email) : null;
    const check = await verifyPassword(input.password.slice(0, 1024), user?.passwordHash ?? (await dummyHash(this.cost)), this.cost);
    if (!user || !check.ok) {
      this.limiter.hit(emailKey);
      if (ipKey) this.limiter.hit(ipKey);
      throw unauthenticated(GENERIC_LOGIN_ERROR);
    }
    if (user.disabled) throw forbidden("This account has been disabled. Ask an administrator.");

    this.limiter.reset(emailKey);
    if (check.needsRehash) await this.store.updatePasswordHash(user.id, await hashPassword(input.password, this.cost));
    await this.store.touchLogin(user.id);
    void this.store.purgeSessions(SESSION_IDLE_MS).catch(() => undefined);
    return { user, ...(await this.openSession(user.id, client)) };
  }

  private async openSession(userId: string, client: ClientInfo): Promise<{ token: string; expiresAt: Date }> {
    const token = newSessionToken();
    const expiresAt = new Date(this.now() + SESSION_MAX_AGE_MS);
    await this.store.createSession({ tokenHash: hashToken(token), userId, expiresAt, userAgent: client.userAgent });
    return { token, expiresAt };
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteSession(hashToken(token));
  }

  /** The person behind a session cookie value, or null. */
  async userForSession(token: string): Promise<{ user: UserRecord; hash: string; age: number } | null> {
    if (!token || token.length > 200) return null;
    const hash = hashToken(token);
    const session = await this.store.findSession(hash, SESSION_IDLE_MS);
    if (!session) return null;
    void this.store.touchSession(hash).catch(() => undefined);
    return { user: session.user, hash, age: this.now() - session.createdAt.getTime() };
  }

  /** Replaces a session token that has grown old. The old one lingers for a minute (requests in flight). */
  async rotateSession(oldHash: string, userId: string, client: ClientInfo): Promise<{ token: string; expiresAt: Date }> {
    const next = await this.openSession(userId, client);
    await this.store.shortenSession(oldHash, ROTATION_GRACE_MS);
    return next;
  }

  /** Session age after which `rotateSession` should be called. */
  readonly rotateAfterMs = SESSION_ROTATE_MS;

  /** The person behind a `Bearer dai_…` personal access token. */
  async userForApiToken(token: string): Promise<{ user: UserRecord; tokenId: string; scope: "read" | "write" } | null> {
    if (!API_TOKEN_PATTERN.test(token)) return null;
    const found = await this.store.findApiToken(hashToken(token));
    if (!found) return null;
    void this.store.touchApiToken(found.id).catch(() => undefined);
    return { user: found.user, tokenId: found.id, scope: found.scope };
  }

  /* ------------------------------------------------------------- account */

  async changePassword(user: UserRecord, input: { current: string; next: string }, keepSessionHash: string | undefined): Promise<void> {
    this.limiter.assertAllowed(`password:${user.id}`, FAILED_LOGIN_LIMIT, LOGIN_WINDOW_MS, "password attempts");
    const check = await verifyPassword(input.current.slice(0, 1024), user.passwordHash, this.cost);
    if (!check.ok) {
      this.limiter.hit(`password:${user.id}`);
      throw forbidden("The current password is not right.");
    }
    const problem = passwordProblem(input.next, { email: user.email, name: user.name });
    if (problem) throw invalid(problem);
    await this.store.updatePasswordHash(user.id, await hashPassword(input.next, this.cost));
    // Whoever else had this account open (or a stolen cookie) is signed out.
    await this.store.deleteUserSessions(user.id, keepSessionHash);
  }

  async rename(userId: string, name: string): Promise<void> {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean || clean.length > NAME_MAX) throw invalid(`Enter a name (up to ${NAME_MAX} characters).`);
    await this.store.updateName(userId, clean);
  }

  /* ------------------------------------------------------ personal tokens */

  async createApiToken(userId: string, input: { name: string; scope: "read" | "write"; expiresInDays?: number }): Promise<ApiTokenInfo> {
    const name = input.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 60) throw invalid("Give the token a name (up to 60 characters), for example the machine or agent that will use it.");
    if ((await this.store.listApiTokens(userId)).length >= MAX_TOKENS_PER_USER) throw conflict(`You already have ${MAX_TOKENS_PER_USER} tokens. Revoke one you no longer use.`);
    const token = newApiToken();
    const id = randomId("tok");
    const expiresAt = input.expiresInDays ? new Date(this.now() + input.expiresInDays * 86_400_000) : null;
    await this.store.createApiToken({ id, userId, name, tokenHash: hashToken(token), prefix: token.slice(0, 8), scope: input.scope, expiresAt });
    return { id, name, prefix: token.slice(0, 8), scope: input.scope, createdAt: new Date(this.now()).toISOString(), lastUsedAt: null, expiresAt: expiresAt?.toISOString() ?? null, token };
  }

  async listApiTokens(userId: string): Promise<ApiTokenInfo[]> {
    return (await this.store.listApiTokens(userId)).map((row: ApiTokenRow) => ({ ...row }));
  }

  async revokeApiToken(userId: string, id: string): Promise<void> {
    if (!(await this.store.revokeApiToken(userId, id))) throw notFound("No such token.");
  }

  /* ------------------------------------------------------------- sharing */

  async members(diagramId: string): Promise<MemberInfo[]> {
    return (await this.store.listMembers(diagramId)).map((row: MemberRow) => ({ ...row }));
  }

  async addMember(diagramId: string, email: string, role: ShareRole): Promise<MemberInfo> {
    const user = await this.store.findUserByEmail(normalizeEmail(email));
    if (!user || user.disabled) throw notFound("Nobody has an account with that email address yet. Create a share link and send them that instead.");
    if ((await this.store.ownerOf(diagramId)) === user.id) throw conflict(`${user.name} owns this diagram already.`);
    await this.store.setMember(diagramId, user.id, role);
    return { userId: user.id, name: user.name, email: user.email, role };
  }

  async setMemberRole(diagramId: string, userId: string, role: ShareRole): Promise<void> {
    if ((await this.store.ownerOf(diagramId)) === userId) throw conflict("The owner's access cannot be changed.");
    if ((await this.store.roleOn(userId, diagramId)) === null) throw notFound("That person does not have access.");
    await this.store.setMember(diagramId, userId, role);
  }

  async removeMember(diagramId: string, userId: string): Promise<void> {
    if ((await this.store.ownerOf(diagramId)) === userId) throw conflict("The owner cannot be removed from their own diagram.");
    if (!(await this.store.removeMember(diagramId, userId))) throw notFound("That person does not have access.");
  }

  async createShareLink(diagramId: string, createdBy: string, input: { role: ShareRole; expiresInDays?: number }): Promise<ShareLinkInfo> {
    if ((await this.store.listLinks(diagramId)).length >= MAX_LINKS_PER_DIAGRAM) throw conflict("This diagram has many active links. Revoke some you no longer need.");
    const token = newShareToken();
    const id = randomId("lnk");
    const expiresAt = input.expiresInDays ? new Date(this.now() + input.expiresInDays * 86_400_000) : null;
    await this.store.createLink({ id, tokenHash: hashToken(token), diagramId, role: input.role, hint: token.slice(-4), createdBy, expiresAt });
    return { id, role: input.role, createdAt: new Date(this.now()).toISOString(), expiresAt: expiresAt?.toISOString() ?? null, hint: token.slice(-4), token };
  }

  async shareLinks(diagramId: string): Promise<ShareLinkInfo[]> {
    return (await this.store.listLinks(diagramId)).map((row: LinkRow) => ({ ...row }));
  }

  async revokeShareLink(diagramId: string, linkId: string): Promise<void> {
    if (!(await this.store.revokeLink(diagramId, linkId))) throw notFound("That link does not exist or was already revoked.");
  }

  /**
   * Opens a share link. A signed-in person is added to the diagram's members
   * (so it shows under "Shared with me"); anyone else gets read-only access
   * through a cookie.
   */
  async redeem(token: string, userId: string | null): Promise<{ diagramId: string; role: Role; linkRole: ShareRole; name: string; expiresAt: string | null }> {
    const link = token.length <= 100 ? await this.store.findLink(hashToken(token)) : null;
    if (!link) throw notFound("This link is no longer valid. Ask the owner for a new one.");
    if (!userId) return { diagramId: link.diagramId, role: "viewer", linkRole: link.role, name: link.diagramName, expiresAt: link.expiresAt };
    await this.store.raiseMember(link.diagramId, userId, link.role);
    const role = (await this.store.roleOn(userId, link.diagramId)) ?? link.role;
    return { diagramId: link.diagramId, role, linkRole: link.role, name: link.diagramName, expiresAt: link.expiresAt };
  }

  /* --------------------------------------------------------------- admin */

  async users(): Promise<(PublicUser & { createdAt: string; lastLoginAt: string | null; disabled: boolean })[]> {
    return (await this.store.listUsers()).map((user) => ({ ...toPublicUser(user), createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, disabled: user.disabled }));
  }

  async setDisabled(actingUserId: string, userId: string, disabled: boolean): Promise<void> {
    if (actingUserId === userId) throw conflict("You cannot disable your own account.");
    await this.store.setDisabled(userId, disabled);
    if (disabled) await this.store.deleteUserSessions(userId);
  }

  /** The diagrams a user can open, keyed by id. */
  async accessList(userId: string): Promise<AccessRow[]> {
    return this.store.accessList(userId);
  }
}
