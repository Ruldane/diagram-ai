import { exportPages } from "@/core/export/pages";
import { requestContext } from "@/server/auth/request";
import { route } from "@/server/http";
import { pagePng } from "@/server/render/export";

const MAX_SIDE = 640;

/** Small PNG preview for the diagram gallery. The URL carries the version, so it can be cached. */
export const GET = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { service } = await requestContext(request);
  const doc = await service.get(id);
  const page = exportPages(doc, { kind: "all" }, 32)[0];
  const scale = Math.min(1.5, MAX_SIDE / Math.max(page.view.w, page.view.h));
  const png = await pagePng(page, { scale, background: "transparent" });
  return new Response(Buffer.from(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400", Vary: "Cookie" },
  });
});
