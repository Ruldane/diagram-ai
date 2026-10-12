import { z } from "zod";

import { requestContext } from "@/server/auth/request";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

type Context = { params: Promise<{ id: string }> };
const bodySchema = z.object({ name: z.string().max(120).optional(), clientId: z.string().max(80).optional() });

export const GET = route(async (request: Request, { params }: Context) => {
  const { id } = await params;
  const { service } = await requestContext(request);
  return json({ snapshots: await service.listSnapshots(id) });
});

export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { name, clientId } = bodySchema.parse(await request.json());
  const { service } = await requestContext(request);
  return json({ snapshot: await service.createSnapshot(id, name, humanActor(clientId)) }, { status: 201 });
});
