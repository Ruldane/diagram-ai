import { z } from "zod";

import { patchSchema } from "@/core/model/schema";
import type { Patch } from "@/core/model/types";
import type { OpsResponse } from "@/core/protocol";
import { requestContext } from "@/server/auth/request";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

const bodySchema = z.object({ clientId: z.string().min(1).max(80), patch: patchSchema });

/** Changes made in the browser. The server validates, applies and rebroadcasts them. */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { clientId, patch } = bodySchema.parse(await request.json());
  const { service } = await requestContext(request);
  const doc = await service.commit(id, patch as Patch, humanActor(clientId), { origin: clientId });
  return json({ version: doc.version } satisfies OpsResponse);
});
