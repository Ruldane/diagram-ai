import { z } from "zod";

import { layoutSchema } from "@/core/model/schema";
import { getService } from "@/server/context";
import { assertSameOrigin, json, route } from "@/server/http";

const bodySchema = z.object({ options: layoutSchema.optional(), ids: z.array(z.string().max(64)).max(5000).optional() });

/**
 * Computes an automatic layout and returns it as a patch without saving it.
 * The editor applies the patch like any other edit, so it is undoable.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { options, ids } = bodySchema.parse(await request.json());
  return json({ patch: await getService().previewLayout(id, options, ids) });
});
