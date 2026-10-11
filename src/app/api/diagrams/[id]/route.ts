import type { DiagramResponse } from "@/core/protocol";
import { getService } from "@/server/context";
import { assertSameOrigin, json, route } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  return json({ diagram: await getService().get(id) } satisfies DiagramResponse);
});

export const DELETE = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id } = await params;
  await getService().deleteDiagram(id);
  return json({ ok: true });
});
