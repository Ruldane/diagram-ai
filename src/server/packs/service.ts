import { z } from "zod";

import { IMPORT_LIMITS, importIconFiles, importIconZip, type ImportOptions, type ImportReport } from "@/core/shapes/pack-import";
import { packIdFromName, validatePack, type IconPack } from "@/core/shapes/packs";
import { getLibrary, isRuntimeLibrary } from "@/core/shapes/registry";

import { invalid, notFound } from "../errors";
import { packsChanged } from "./runtime";
import { getPackStore, isPackId, type PackSummary } from "./store";

/** Largest request body accepted by `POST /api/packs`, in bytes (a base64 zip of ~50 MB). */
export const MAX_PACK_REQUEST_BYTES = 72 * 1024 * 1024;

const meta = {
  id: z.string().max(32).optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  source: z.string().max(300).optional(),
};

const filesRequest = z.object({
  ...meta,
  files: z
    .array(z.object({ name: z.string().min(1).max(400), content: z.string().max(IMPORT_LIMITS.fileBytes) }))
    .min(1)
    .max(IMPORT_LIMITS.files),
});

const zipRequest = z.object({ ...meta, zip: z.string().min(8).max(MAX_PACK_REQUEST_BYTES) });

export interface CreatePackResult {
  pack: PackSummary;
  warnings: string[];
  skipped: ImportReport["skipped"];
  /** An existing pack with this id was replaced. */
  replaced: boolean;
}

/** A library id derived from a name that is not already taken by a built-in library. */
export function availablePackId(derived: string): string {
  const taken = getLibrary(derived) !== undefined && !isRuntimeLibrary(derived);
  return taken ? `${derived.slice(0, 27)}-pack` : derived;
}

function importOptions(body: { id?: string; name: string; description?: string; source?: string }): ImportOptions {
  if (body.id !== undefined && !isPackId(body.id)) throw invalid(`"${body.id}" is not a valid pack id: use lower-case words joined by hyphens (up to 32 characters).`);
  return { id: body.id ?? availablePackId(packIdFromName(body.name)), name: body.name, description: body.description, source: body.source };
}

/** Accepts a ready pack, SVG file contents, or a base64 zip; validates, stores and activates it. */
export async function createPack(input: unknown): Promise<CreatePackResult> {
  if (typeof input !== "object" || input === null) throw invalid("Send a JSON object.");
  const body = input as Record<string, unknown>;

  let report: ImportReport;
  if ("icons" in body) {
    const checked = validatePack(body);
    if (!checked.ok) throw invalid(`Not a valid icon pack: ${checked.error}`);
    report = { pack: checked.pack, warnings: [], skipped: [] };
  } else if ("zip" in body) {
    const request = zipRequest.parse(body);
    report = importIconZip(new Uint8Array(Buffer.from(request.zip, "base64")), importOptions(request));
  } else if ("files" in body) {
    const request = filesRequest.parse(body);
    report = importIconFiles(
      request.files.map((file) => ({ path: file.name, data: file.content })),
      importOptions(request),
    );
  } else {
    throw invalid("Send an icon pack (`icons`), SVG files (`name` and `files`) or a base64 zip (`name` and `zip`).");
  }
  const { pack, warnings, skipped } = report;
  if (!pack) throw invalid(warnings.join(" ") || "No icons could be read.");

  if (getLibrary(pack.id) && !isRuntimeLibrary(pack.id)) {
    throw invalid(`"${pack.id}" is the id of a built-in shape library. Give the pack another name or id.`);
  }
  const store = getPackStore();
  const replaced = (await store.get(pack.id)) !== null;
  const summary = await store.save(pack);
  await packsChanged();
  return { pack: summary, warnings, skipped, replaced };
}

export async function listPacks(): Promise<PackSummary[]> {
  return getPackStore().list();
}

export async function readPack(id: string): Promise<IconPack> {
  const pack = await getPackStore().get(id);
  if (!pack) throw notFound(`No icon pack with id "${id}".`);
  return pack;
}

export async function deletePack(id: string): Promise<void> {
  if (!(await getPackStore().delete(id))) throw notFound(`No icon pack with id "${id}".`);
  await packsChanged();
}

/** Identifies the set of installed packs and their versions; changes whenever any pack is added, replaced or removed. */
export const packsVersion = (packs: Pick<PackSummary, "id" | "updatedAt">[]): string => packs.map((pack) => `${pack.id}@${pack.updatedAt}`).join(",");
