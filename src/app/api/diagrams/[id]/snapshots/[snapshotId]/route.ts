import type { SnapshotResponse } from "@/core/review/protocol";
import { requestContext } from "@/server/auth/request";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

type Context = { params: Promise<{ id: string; snapshotId: string }> };

/** One checkpoint with its document, so the browser can compare the diagram against it. */
export const GET = route(async (request: Request, { params }: Context) => {
  const { id, snapshotId } = await params;
  const { service } = await requestContext(request);
  const { id: snapshotKey, name, createdAt, doc } = await service.getSnapshot(id, snapshotId);
  return json({ snapshot: { id: snapshotKey, name, createdAt, doc } } satisfies SnapshotResponse, { headers: { "Cache-Control": "no-store" } });
});

/** Restores a checkpoint. The state being replaced is checkpointed first. */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id, snapshotId } = await params;
  const clientId = new URL(request.url).searchParams.get("client");
  const { service } = await requestContext(request);
  const diagram = await service.restoreSnapshot(id, snapshotId, humanActor(clientId));
  return json({ diagram });
});
