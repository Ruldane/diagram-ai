import { assertSameOrigin, json, route } from "@/server/http";
import { sessionContext } from "@/server/auth/request";

/** Revokes one of the caller's tokens. It stops working immediately. */
export const DELETE = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { access, auth } = await sessionContext(request);
  const user = access.requireSession();
  const { id } = await params;
  await auth.revokeApiToken(user.id, id);
  return json({ ok: true });
});
