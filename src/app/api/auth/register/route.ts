import { z } from "zod";

import { authEnabled } from "@/server/config";
import { getRepository } from "@/server/context";
import { invalid } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { clientInfo, getAuthService } from "@/server/auth/request";
import { toPublicUser } from "@/server/auth/service";
import { sessionCookie, withCookies } from "@/server/auth/session-cookie";

const bodySchema = z.object({
  email: z.string().max(254),
  name: z.string().max(200),
  password: z.string().max(1024),
  /** A share-link token: the invitation when sign-up is by invitation. */
  invite: z.string().max(200).optional(),
});

/** Creates an account and signs it in. The first account becomes the administrator. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  if (!authEnabled()) throw invalid("Accounts are not enabled on this server.");
  const input = bodySchema.parse(await request.json());
  // Writes are coalesced for a moment: let diagrams made just now reach the table the first account takes over.
  await getRepository().flush();
  const auth = await getAuthService();
  const { user, token, expiresAt, first } = await auth.register(input, clientInfo(request));
  return withCookies(json({ user: toPublicUser(user), first }, { status: 201 }), sessionCookie(request, token, expiresAt));
});
