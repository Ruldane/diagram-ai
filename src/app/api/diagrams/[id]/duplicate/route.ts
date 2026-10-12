import { requestContext } from "@/server/auth/request";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { service } = await requestContext(request);
  const diagram = await service.duplicate(id, humanActor(new URL(request.url).searchParams.get("client")));
  return json({ diagram }, { status: 201 });
});
