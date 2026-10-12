import { z } from "zod";

import { SHARE_ROLES } from "@/core/auth";
import { invalid } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ role: z.enum(SHARE_ROLES), expiresInDays: z.number().int().min(1).max(365).optional() });

/** The diagram's active share links (without their tokens). Owner only. */
export const GET = route(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const { access, auth } = await requestContext(request);
  if (!auth) return json({ links: [] });
  await access.require(id, "owner");
  return json({ links: await auth.shareLinks(id) }, { headers: { "Cache-Control": "no-store" } });
});

/** Creates a link. The token is in this response only; the server keeps a hash. Owner only. */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { access, auth } = await requestContext(request);
  if (!auth) throw invalid("Share links need accounts: set DIAGRAM_AI_AUTH=on with DATABASE_URL.");
  await access.require(id, "owner");
  const user = access.requireSession();
  const link = await auth.createShareLink(id, user.id, bodySchema.parse(await request.json()));
  return json({ link }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
