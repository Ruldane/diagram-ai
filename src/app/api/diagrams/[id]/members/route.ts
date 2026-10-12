import { z } from "zod";

import { SHARE_ROLES, type MemberInfo } from "@/core/auth";
import { invalid } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ email: z.string().max(254), role: z.enum(SHARE_ROLES) });

/** Who has access. Editors see names; only the owner sees addresses. Solo mode has no accounts, so no members. */
export const GET = route(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const { access, auth } = await requestContext(request);
  if (!auth) return json({ members: [] satisfies MemberInfo[], role: "owner" });
  const role = await access.require(id, "editor");
  const members = await auth.members(id);
  return json({ members: role === "owner" ? members : members.map((member) => ({ ...member, email: "" })), role }, { headers: { "Cache-Control": "no-store" } });
});

/** Gives an existing account access. Owner only. */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { access, auth } = await requestContext(request);
  if (!auth) throw invalid("Sharing needs accounts: set DIAGRAM_AI_AUTH=on with DATABASE_URL.");
  await access.require(id, "owner");
  const { email, role } = bodySchema.parse(await request.json());
  return json({ member: await auth.addMember(id, email, role) }, { status: 201 });
});
