import { z } from "zod";

import { assertSameOrigin, json, route } from "@/server/http";
import { sessionContext } from "@/server/auth/request";

const bodySchema = z.object({
  name: z.string().max(100),
  scope: z.enum(["read", "write"]).default("write"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** The caller's personal access tokens (never the secrets). */
export const GET = route(async (request: Request) => {
  const { access, auth } = await sessionContext(request);
  const user = access.requireSession();
  return json({ tokens: await auth.listApiTokens(user.id) }, { headers: { "Cache-Control": "no-store" } });
});

/** Creates a token. The secret is in this response only; the server keeps a hash. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const { access, auth } = await sessionContext(request);
  const user = access.requireSession();
  const input = bodySchema.parse(await request.json());
  return json({ token: await auth.createApiToken(user.id, input) }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
