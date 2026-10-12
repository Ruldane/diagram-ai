import { z } from "zod";

import { authEnabled } from "@/server/config";
import { invalid } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { clientInfo, getAuthService } from "@/server/auth/request";
import { toPublicUser } from "@/server/auth/service";
import { sessionCookie, withCookies } from "@/server/auth/session-cookie";
import { RateLimited } from "@/server/auth/rate-limit";

const bodySchema = z.object({ email: z.string().max(254), password: z.string().max(1024) });

/** Signs in. The same answer for an unknown email and a wrong password; failures are rate limited. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  if (!authEnabled()) throw invalid("Accounts are not enabled on this server.");
  const input = bodySchema.parse(await request.json());
  const auth = await getAuthService();
  try {
    const { user, token, expiresAt } = await auth.login(input, clientInfo(request));
    return withCookies(json({ user: toPublicUser(user) }), sessionCookie(request, token, expiresAt));
  } catch (error) {
    if (error instanceof RateLimited) {
      return json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    throw error;
  }
});
