import { getService } from "@/server/context";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const diagram = await getService().duplicate(id, humanActor(new URL(request.url).searchParams.get("client")));
  return json({ diagram }, { status: 201 });
});
