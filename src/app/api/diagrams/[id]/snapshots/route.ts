import { z } from "zod";

import { getService } from "@/server/context";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

type Context = { params: Promise<{ id: string }> };
const bodySchema = z.object({ name: z.string().max(120).optional(), clientId: z.string().max(80).optional() });

export const GET = route(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  return json({ snapshots: await getService().listSnapshots(id) });
});

export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { name, clientId } = bodySchema.parse(await request.json());
  return json({ snapshot: await getService().createSnapshot(id, name, humanActor(clientId)) }, { status: 201 });
});
