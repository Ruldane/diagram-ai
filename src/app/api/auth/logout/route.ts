import { authEnabled } from "@/server/config";
import { assertSameOrigin, json, route } from "@/server/http";
import { sessionTokenFrom } from "@/server/auth/access";
import { getAuthService } from "@/server/auth/request";
import { clearSessionCookies, withCookies } from "@/server/auth/session-cookie";

/** Ends this browser's session on the server and clears the cookie. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  if (authEnabled()) {
    const token = sessionTokenFrom(request);
    if (token) await (await getAuthService()).logout(token);
  }
  return withCookies(json({ ok: true }), clearSessionCookies(request));
});
