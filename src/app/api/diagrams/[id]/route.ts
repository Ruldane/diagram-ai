import type { DiagramResponse } from "@/core/protocol";
import { assertSameOrigin, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

type Context = { params: Promise<{ id: string }> };

/** The document, and what the caller may do with it (`viewer` makes the editor read-only). */
export const GET = route(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const { service, access } = await requestContext(request);
  const diagram = await service.get(id);
  const role = await access.require(id, "viewer");
  const user = access.user;
  return json(
    { diagram, viewer: { role, user: user ? { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin } : null } } satisfies DiagramResponse,
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const DELETE = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { service } = await requestContext(request);
  await service.deleteDiagram(id);
  return json({ ok: true });
});
