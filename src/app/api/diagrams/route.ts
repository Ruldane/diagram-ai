import { connection } from "next/server";
import { z } from "zod";

import type { DiagramResponse, ListDiagramsResponse } from "@/core/protocol";
import { getService } from "@/server/context";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

const createSchema = z.object({
  name: z.string().max(200).optional(),
  type: z.string().max(80).optional(),
  description: z.string().max(4000).optional(),
  template: z.boolean().optional(),
  clientId: z.string().max(80).optional(),
});

export const GET = route(async () => {
  await connection();
  return json({ diagrams: await getService().list() } satisfies ListDiagramsResponse);
});

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const { clientId, ...input } = createSchema.parse(await request.json());
  const diagram = await getService().create(input, humanActor(clientId));
  return json({ diagram } satisfies DiagramResponse, { status: 201 });
});
