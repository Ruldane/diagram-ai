import type { SessionInfo } from "@/core/auth";
import { authEnabled } from "@/server/config";
import { json, route } from "@/server/http";
import { resolvePrincipal } from "@/server/auth/access";
import { getAuthService, clientInfo } from "@/server/auth/request";
import { sessionCookie, withCookies } from "@/server/auth/session-cookie";
import { toPublicUser } from "@/server/auth/service";

/**
 * Who is signed in, and whether the app needs anybody to be. Public: the shell
 * calls it first to choose between the app and the sign-in page. A session
 * older than a day is replaced here (the old cookie keeps working for a
 * minute, for requests already in flight).
 */
export const GET = route(async (request: Request) => {
  if (!authEnabled()) return json({ authRequired: false, user: null, signup: "closed" } satisfies SessionInfo, { headers: { "Cache-Control": "no-store" } });

  const auth = await getAuthService();
  const principal = await resolvePrincipal(request, auth).catch(() => null);
  const signup = await auth.signupMode();
  const body: SessionInfo = { authRequired: true, user: principal?.user ? toPublicUser(principal.user) : null, signup };

  const rotate = principal?.via === "session" && principal.user && principal.sessionHash && (principal.sessionAgeMs ?? 0) > auth.rotateAfterMs;
  if (rotate && principal.user && principal.sessionHash) {
    const next = await auth.rotateSession(principal.sessionHash, principal.user.id, clientInfo(request));
    return withCookies(json(body), sessionCookie(request, next.token, next.expiresAt));
  }
  return json(body, { headers: { "Cache-Control": "no-store" } });
});
