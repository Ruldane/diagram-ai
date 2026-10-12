import { z } from "zod";

import { SHARE_ROLES } from "@/core/auth";
import { invalid } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

type Context = { params: Promise<{ id: string; userId: string }> };

const bodySchema = z.object({ role: z.enum(SHARE_ROLES) });

/** Changes a member's role. Owner only. */
export const PATCH = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id, userId } = await params;
  const { access, auth } = await requestContext(request);
  if (!auth) throw invalid("Sharing needs accounts: set DIAGRAM_AI_AUTH=on with DATABASE_URL.");
  await access.require(id, "owner");
  await auth.setMemberRole(id, userId, bodySchema.parse(await request.json()).role);
  return json({ ok: true });
});

/** Removes a member, or lets a member leave. Owner only, except that anyone may remove themselves. */
export const DELETE = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id, userId } = await params;
  const { access, auth } = await requestContext(request);
  if (!auth) throw invalid("Sharing needs accounts: set DIAGRAM_AI_AUTH=on with DATABASE_URL.");
  const own = access.user?.id === userId;
  await access.require(id, own ? "viewer" : "owner");
  await auth.removeMember(id, userId);
  return json({ ok: true });
});
