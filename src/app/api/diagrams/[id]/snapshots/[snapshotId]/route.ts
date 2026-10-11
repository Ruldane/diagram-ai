import type { SnapshotResponse } from "@/core/review/protocol";
import { getService } from "@/server/context";
import { assertSameOrigin, humanActor, json, route } from "@/server/http";

type Context = { params: Promise<{ id: string; snapshotId: string }> };

/** One checkpoint with its document, so the browser can compare the diagram against it. */
export const GET = route(async (_request: Request, { params }: Context) => {
  const { id, snapshotId } = await params;
  const { id: snapshotKey, name, createdAt, doc } = await getService().getSnapshot(id, snapshotId);
  return json({ snapshot: { id: snapshotKey, name, createdAt, doc } } satisfies SnapshotResponse, { headers: { "Cache-Control": "no-store" } });
});

/** Restores a checkpoint. The state being replaced is checkpointed first. */
export const POST = route(async (request: Request, { params }: Context) => {
  assertSameOrigin(request);
  const { id, snapshotId } = await params;
  const clientId = new URL(request.url).searchParams.get("client");
  const diagram = await getService().restoreSnapshot(id, snapshotId, humanActor(clientId));
  return json({ diagram });
});
