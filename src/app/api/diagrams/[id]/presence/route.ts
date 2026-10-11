import { z } from "zod";

import { getService } from "@/server/context";
import { assertSameOrigin, json, route } from "@/server/http";

const bodySchema = z.object({
  clientId: z.string().min(1).max(80),
  selection: z.array(z.string().max(64)).max(500),
  viewport: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});

/** The browser reports what its human has selected so agents can act on "this". */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { id } = await params;
  getService().setPresence(id, bodySchema.parse(await request.json()));
  return json({ ok: true });
});
