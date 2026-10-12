import { authEnabled, signupSetting, trustProxy } from "../config";
import { getContext, getDatabase, getRepository } from "../context";
import { unauthenticated } from "../errors";
import type { Hub } from "../realtime/hub";
import type { DiagramService } from "../service";
import { Access, assertBrowserOrigin, bearerFrom, isMutating, LOCAL_PRINCIPAL, resolvePrincipal } from "./access";
import { parseCookies, SHARE_COOKIE } from "./cookies";
import { guardHub, guardService } from "./guard";
import { createRateLimitState, type RateLimitState } from "./rate-limit";
import { AuthService, type ClientInfo } from "./service";
import { AuthStore } from "./store";

/** Plain data that must survive hot reloads, like the rest of the process state (`server/context.ts`). */
const globalRef = globalThis as typeof globalThis & { __diagramAiAuth?: { limits: RateLimitState } };

function limits(): RateLimitState {
  globalRef.__diagramAiAuth ??= { limits: createRateLimitState() };
  return globalRef.__diagramAiAuth.limits;
}

/** The account rules over the app's database. Only call with accounts on. */
export async function getAuthService(): Promise<AuthService> {
  const database = getDatabase();
  if (!database) throw new Error("Accounts need PostgreSQL: set DIAGRAM_AI_AUTH=on with DATABASE_URL.");
  await database.ready();
  return new AuthService(new AuthStore(database.pool), limits(), { signup: signupSetting() });
}

/** The caller's address (only when a proxy that sets it is trusted) and browser, for rate limits and the session list. */
export function clientInfo(request: Request): ClientInfo {
  const forwarded = trustProxy() ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() : undefined;
  return { ip: forwarded || null, userAgent: request.headers.get("user-agent") };
}

export interface RequestContext {
  /** With accounts on: the real service behind an authorization wrapper. In solo mode: the real service. */
  service: DiagramService;
  hub: Hub;
  access: Access;
  /** `null` in solo mode. */
  auth: AuthService | null;
}

export interface ContextOptions {
  /** MCP: only a personal access token counts; cookies are ignored so a browser can never drive the endpoint. */
  bearerOnly?: boolean;
}

/**
 * The one entry point for routes: works out who is calling and hands back a
 * service and hub they are allowed to use. In solo mode that is the plain
 * service and hub (nothing is checked); with accounts on every call is checked
 * against the caller's role on the diagram (`guard.ts`).
 */
export async function requestContext(request: Request, options: ContextOptions = {}): Promise<RequestContext> {
  const { service, hub } = getContext();
  if (!authEnabled()) return { service, hub, access: new Access(LOCAL_PRINCIPAL, null), auth: null };

  const auth = await getAuthService();
  if (options.bearerOnly && !bearerFrom(request)) {
    throw unauthenticated("This server needs a personal access token. Create one in Account settings and send it as 'Authorization: Bearer <token>'.");
  }
  const principal = await resolvePrincipal(request, auth);
  if (principal.via === "session" && isMutating(request)) assertBrowserOrigin(request);

  const cookies = parseCookies(request.headers.get("cookie"));
  const access = new Access(principal, auth, () => cookies.get(SHARE_COOKIE) ?? null);
  return {
    service: guardService(service, access, { settle: () => getRepository().flush(), claim: (diagramId, userId) => auth.store.setOwner(diagramId, userId) }),
    hub: guardHub(hub, access),
    access,
    auth,
  };
}

/** For routes about the account itself (tokens, settings): a signed-in person with a session cookie. */
export async function sessionContext(request: Request): Promise<RequestContext & { auth: AuthService }> {
  const context = await requestContext(request);
  if (!context.auth) throw unauthenticated("Accounts are not enabled on this server.");
  return context as RequestContext & { auth: AuthService };
}
