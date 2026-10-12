import { invalid } from "@/server/errors";
import { assertSameOrigin, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

/** Revokes a link: it stops working at once, including for browsers that already opened it. Owner only. */
export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) => {
  assertSameOrigin(request);
  const { id, linkId } = await params;
  const { access, auth } = await requestContext(request);
  if (!auth) throw invalid("Share links need accounts: set DIAGRAM_AI_AUTH=on with DATABASE_URL.");
  await access.require(id, "owner");
  await auth.revokeShareLink(id, linkId);
  return json({ ok: true });
});
