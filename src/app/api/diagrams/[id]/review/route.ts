import { z } from "zod";

import type { ReviewResponse } from "@/core/review/protocol";
import { getService } from "@/server/context";
import { assertSameOrigin, json, route } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  action: z.literal("accept"),
  ids: z.union([z.literal("all"), z.array(z.string().min(1).max(64)).max(5000)]).optional(),
});

/** Whether agent changes are waiting for review, with the baseline the browser diffs against. */
export const GET = route(async (_request: Request, { params }: Context) => {
  const { id } = await params;
  const { review, base } = await getService().reviewState(id);
  return json({ review, base } satisfies ReviewResponse, { headers: { "Cache-Control": "no-store" } });
});

/** Marks agent changes as reviewed. The diagram is untouched; rejecting is an ordinary edit. */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { ids } = bodySchema.parse(await request.json());
  const { review, base } = await getService().acceptReview(id, ids ?? "all");
  return json({ review, base } satisfies ReviewResponse);
});
