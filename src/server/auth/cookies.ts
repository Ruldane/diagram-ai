/** Cookie helpers over plain `Request`/`Headers`, so they work the same in route handlers and in tests. */

export const SESSION_COOKIE = "dai_session";
/** Used instead when the connection is HTTPS: the `__Host-` prefix makes browsers insist on Secure, Path=/ and no Domain. */
export const SECURE_SESSION_COOKIE = "__Host-dai_session";
/** Share links: one cookie per diagram, scoped to that diagram's API path, holding the link token. */
export const SHARE_COOKIE = "dai_share";

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (name && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  path?: string;
  secure: boolean;
}

/** A `Set-Cookie` value. Always HttpOnly and SameSite=Lax. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, `Path=${options.path ?? "/"}`, "HttpOnly", "SameSite=Lax"];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export const clearedCookie = (name: string, options: Pick<CookieOptions, "path" | "secure">): string =>
  serializeCookie(name, "", { ...options, maxAgeSeconds: 0 });
