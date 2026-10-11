import type { WorkspaceEvent } from "@/core/protocol";
import { getHub } from "@/server/context";
import { eventStream, route } from "@/server/http";

/** Workspace-level stream: diagram list changes and agent activity, for the home page. */
export const GET = route(async (request: Request) => {
  const hub = getHub();
  return eventStream(request, (send) => {
    send({ type: "hello", agents: hub.listAgents() } satisfies WorkspaceEvent);
    return hub.subscribeWorkspace(send);
  });
});
