import { z } from "zod";

import { requestContext } from "@/server/auth/request";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

const bodySchema = z.object({
  format: z.enum(["json", "drawio", "mermaid"]),
  content: z.string().min(1).max(20_000_000),
  name: z.string().max(200).optional(),
  clientId: z.string().max(80).optional(),
});

/** Creates a new diagram from a Diagram AI JSON file, a draw.io file or Mermaid text. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const { clientId, ...input } = bodySchema.parse(await request.json());
  const { service } = await requestContext(request);
  const { doc, warnings } = await service.importDiagram(input, humanActor(clientId));
  return json({ diagram: doc, warnings }, { status: 201 });
});
