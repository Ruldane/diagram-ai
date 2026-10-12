import { z } from "zod";

import { EXPORT_FORMATS } from "@/core/protocol";
import { requestContext } from "@/server/auth/request";
import { route } from "@/server/http";

const querySchema = z.object({
  format: z.enum(EXPORT_FORMATS).default("svg"),
  scale: z.coerce.number().min(0.1).max(8).optional(),
  background: z.enum(["doc", "transparent"]).optional(),
  pageSize: z.enum(["fit", "a4", "a3", "letter", "legal", "tabloid"]).optional(),
  slideLayout: z.enum(["16:9", "4:3"]).optional(),
  slideMode: z.enum(["editable", "image"]).optional(),
  scope: z.enum(["all", "frames"]).optional(),
  inline: z.string().optional(),
});

/** Server-rendered export, for scripts, agents and direct links. */
export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { format, scope, inline, ...options } = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const { service } = await requestContext(request);
  const file = await service.export(id, format, { ...options, scope: { kind: scope ?? "all" } });
  const body = typeof file.data === "string" ? file.data : Buffer.from(file.data);
  return new Response(body, {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
});
