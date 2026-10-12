import { trustProxy } from "../config";
import { isSecureRequest } from "./access";
import { clearedCookie, SECURE_SESSION_COOKIE, serializeCookie, SESSION_COOKIE, SHARE_COOKIE } from "./cookies";

/** `Set-Cookie` values that start a browser session. Over HTTPS the name carries the `__Host-` prefix. */
export function sessionCookie(request: Request, token: string, expiresAt: Date, now = Date.now()): string[] {
  const secure = isSecureRequest(request, trustProxy());
  const maxAgeSeconds = Math.max(0, (expiresAt.getTime() - now) / 1000);
  const name = secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  const cookies = [serializeCookie(name, token, { secure, maxAgeSeconds })];
  // The other name (left from before the site moved to HTTPS, or the reverse) must not shadow this one.
  cookies.push(clearedCookie(secure ? SESSION_COOKIE : SECURE_SESSION_COOKIE, { secure }));
  return cookies;
}

export function clearSessionCookies(request: Request): string[] {
  const secure = isSecureRequest(request, trustProxy());
  return [clearedCookie(SESSION_COOKIE, { secure }), ...(secure ? [clearedCookie(SECURE_SESSION_COOKIE, { secure })] : [])];
}

/** The cookie that carries a share-link token for one diagram: scoped to that diagram's API path only. */
export function shareCookie(request: Request, diagramId: string, token: string, expiresAt: Date | null): string {
  const secure = isSecureRequest(request, trustProxy());
  const days30 = 30 * 86_400;
  const maxAgeSeconds = expiresAt ? Math.min(days30, Math.max(0, (expiresAt.getTime() - Date.now()) / 1000)) : days30;
  return serializeCookie(SHARE_COOKIE, token, { secure, maxAgeSeconds, path: `/api/diagrams/${encodeURIComponent(diagramId)}` });
}

/** A response with extra `Set-Cookie` headers. */
export function withCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
