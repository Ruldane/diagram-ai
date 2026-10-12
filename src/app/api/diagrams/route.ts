import { z } from "zod";

import type { DiagramAccess } from "@/core/auth";
import type { DiagramResponse, ListDiagramsResponse } from "@/core/protocol";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

const createSchema = z.object({
  name: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
  description: z.string().max(4000).optional(),
  template: z.boolean().optional(),
  clientId: z.string().max(80).optional(),
});

/** The diagrams the caller can open. With accounts on `access` says how (owner, editor, viewer) and whose they are. */
export const GET = route(async (request: Request) => {
  const { service, access } = await requestContext(request);
  access.requireUser();
  const diagrams = await service.list();
  const response: ListDiagramsResponse = { diagrams };
  if (!access.local) {
    const visible = await access.preload();
    response.access = Object.fromEntries(diagrams.flatMap((diagram) => (visible.has(diagram.id) ? [[diagram.id, visible.get(diagram.id) as DiagramAccess]] : [])));
  }
  return json(response, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const { clientId, ...input } = createSchema.parse(await request.json());
  const { service, access } = await requestContext(request);
  access.requireUser();
  const diagram = await service.create(input, humanActor(clientId));
  return json({ diagram } satisfies DiagramResponse, { status: 201 });
});
