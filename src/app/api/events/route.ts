import type { WorkspaceEvent } from "@/core/protocol";
import { eventStream, route } from "@/server/http";
import { getHub } from "@/server/context";
import { requestContext } from "@/server/auth/request";

/**
 * Workspace-level stream: diagram list changes and agent activity, for the home
 * page. With accounts on a person only hears about agents that act for them or
 * work on a diagram they can open; list changes carry no data (the page
 * refetches its own, filtered list).
 */
export const GET = route(async (request: Request) => {
  const { access } = await requestContext(request);
  access.requireUser();
  const hub = getHub();
  const visible = access.local ? null : await access.preload();
  const mine = (ownerId: string | undefined, diagramId: string | undefined): boolean =>
    visible === null || ownerId === access.user?.id || (diagramId !== undefined && visible.has(diagramId));

  return eventStream(request, (send) => {
    send({ type: "hello", agents: hub.listAgents().filter((agent) => mine(agent.ownerId, agent.diagramId)) } satisfies WorkspaceEvent);
    return hub.subscribeWorkspace((event) => {
      if (event.type === "agent" && !mine(event.agent.ownerId, event.agent.diagramId)) return;
      send(event);
    });
  });
});
