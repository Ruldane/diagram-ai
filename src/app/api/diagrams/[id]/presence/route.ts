import { z } from "zod";

import { atLeast } from "@/core/auth";
import { assertSameOrigin, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

const bodySchema = z.object({
  clientId: z.string().min(1).max(80),
  selection: z.array(z.string().max(64)).max(500),
  viewport: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  /** Pointer position in world coordinates; `null` when it left the canvas. */
  cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional(),
});

/**
 * What this tab is looking at. Editors' selection is what agents resolve "this"
 * to; everyone's pointer and selection are shown to the other people on the
 * diagram as live cursors.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { service, hub, access } = await requestContext(request);
  const role = await access.require(id, "viewer");
  const { clientId, selection, viewport, cursor } = bodySchema.parse(await request.json());

  if (atLeast(role, "editor")) service.setPresence(id, { clientId, selection, viewport });

  const user = access.user;
  const known = hub.listPeers(id).find((peer) => peer.id === clientId);
  const name = user?.name ?? known?.name ?? (access.local ? hub.nextTabName(id) : "Guest");
  hub.setPeer(id, { id: clientId, name, ...(user ? { userId: user.id } : {}), ...(cursor ? { cursor } : {}), selection: selection.slice(0, 100) }, user?.id ?? "local");
  return json({ ok: true });
});
