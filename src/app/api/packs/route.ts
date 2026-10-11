import { assertSameOrigin, json, route } from "@/server/http";
import { invalid } from "@/server/errors";
import { createPack, listPacks, MAX_PACK_REQUEST_BYTES, packsVersion, readPack } from "@/server/packs/service";

/**
 * Installed icon packs: `{ packs, version }` with names and counts. `?full=1`
 * adds `full`, every pack with its icons, which is what the editor loads.
 */
export const GET = route(async (request: Request) => {
  const packs = await listPacks();
  const version = packsVersion(packs);
  if (new URL(request.url).searchParams.get("full") !== "1") return json({ packs, version });
  const full = await Promise.all(packs.map((summary) => readPack(summary.id)));
  return json({ packs, full, version });
});

/**
 * Installs a pack: a ready pack (`{ id, name, icons }`), SVG files
 * (`{ name, files: [{ name, content }] }`) or a base64 zip (`{ name, zip }`).
 * A pack with the same id is replaced.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_PACK_REQUEST_BYTES) throw invalid(`The upload is larger than ${MAX_PACK_REQUEST_BYTES / 1048576} MB.`);
  const result = await createPack(await request.json());
  return json(result, { status: result.replaced ? 200 : 201 });
});
