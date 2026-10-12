import type { DiagramEvent } from "@/core/protocol";
import { eventStream, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

/** Live stream of everything that happens to one diagram (server-sent events). Needs at least view access. */
export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { service, hub } = await requestContext(request);
  const doc = await service.get(id);
  const { review } = await service.reviewState(id);
  const clientId = new URL(request.url).searchParams.get("client");

  return eventStream(
    request,
    (send) => {
      const hello: DiagramEvent = {
        type: "hello",
        version: doc.version,
        agents: hub.listAgents(id),
        activity: hub.recentActivity(id),
        review,
        peers: hub.listPeers(id),
      };
      send(hello);
      const unsubscribe = hub.subscribe(id, send);
      return () => {
        unsubscribe();
        if (clientId) {
          hub.clearPresence(id, clientId);
          hub.removePeer(id, clientId);
        }
      };
    },
    // Access can be taken away while a tab is open (link revoked, member removed, signed out elsewhere).
    async () => {
      try {
        const fresh = await requestContext(request);
        await fresh.access.require(id, "viewer");
        return true;
      } catch {
        return false;
      }
    },
  );
});
