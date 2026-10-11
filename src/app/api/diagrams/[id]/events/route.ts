import type { DiagramEvent } from "@/core/protocol";
import { getContext } from "@/server/context";
import { eventStream, route } from "@/server/http";

/** Live stream of everything that happens to one diagram (server-sent events). */
export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { service, hub } = getContext();
  const doc = await service.get(id);
  const { review } = await service.reviewState(id);
  const clientId = new URL(request.url).searchParams.get("client");

  return eventStream(request, (send) => {
    const hello: DiagramEvent = {
      type: "hello",
      version: doc.version,
      agents: hub.listAgents(id),
      activity: hub.recentActivity(id),
      review,
    };
    send(hello);
    const unsubscribe = hub.subscribe(id, send);
    return () => {
      unsubscribe();
      if (clientId) hub.clearPresence(id, clientId);
    };
  });
});
