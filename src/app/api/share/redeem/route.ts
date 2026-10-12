import { z } from "zod";

import type { RedeemResponse } from "@/core/auth";
import { authEnabled } from "@/server/config";
import { invalid } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { resolvePrincipal } from "@/server/auth/access";
import { getAuthService } from "@/server/auth/request";
import { shareCookie, withCookies } from "@/server/auth/session-cookie";

const bodySchema = z.object({ token: z.string().min(8).max(200) });

/**
 * Opens a share link. A signed-in person is added to the diagram (it then
 * appears under "Shared with me"); anyone else gets read-only access through
 * a cookie scoped to that diagram's API path. Revoking the link ends the
 * cookie's effect at once, because the token is checked on every request.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  if (!authEnabled()) throw invalid("Share links are only used when accounts are enabled.");
  const { token } = bodySchema.parse(await request.json());
  const auth = await getAuthService();
  const principal = await resolvePrincipal(request, auth).catch(() => null);
  const { expiresAt, ...result } = await auth.redeem(token, principal?.user?.id ?? null);
  return withCookies(json(result satisfies RedeemResponse), [shareCookie(request, result.diagramId, token, expiresAt ? new Date(expiresAt) : null)]);
});
