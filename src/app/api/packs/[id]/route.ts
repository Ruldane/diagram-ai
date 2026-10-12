import { assertSameOrigin, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";
import { deletePack, readPack } from "@/server/packs/service";

type Params = { params: Promise<{ id: string }> };

/** One installed pack, in the same JSON format `POST /api/packs` accepts. */
export const GET = route(async (request: Request, { params }: Params) => {
  (await requestContext(request)).access.requireUser();
  const { id } = await params;
  return json(await readPack(id));
});

export const DELETE = route(async (request: Request, { params }: Params) => {
  assertSameOrigin(request);
  (await requestContext(request)).access.requireAdmin();
  const { id } = await params;
  await deletePack(id);
  return json({ ok: true });
});
