/**
 * Icon packs: sets of coloured SVG icons imported at runtime (the official AWS,
 * Azure and Google Cloud architecture icons, a company's own set…) and turned
 * into a shape library. The format is plain JSON so it can be stored, sent over
 * the API and rendered anywhere — see `svg-import.ts` and `pack-import.ts` for
 * how SVG files become packs.
 */
import { z } from "zod";

import { parseSvgPath, pathToSvg } from "../geometry/path";
import { slugify } from "../model/ids";
import { normalizeColor } from "../model/palette";
import { formatIssues } from "../model/schema";
import { glyphPrims, type GlyphLayer } from "./glyph";
import { glyphTile } from "./glyph-tile";
import type { ShapeDef, ShapeLibrary } from "./types";

/* ------------------------------------------------------------------- types */

/** One painted path. Same fields as `GlyphLayer`: colours are `#rrggbb` or `"none"`, sizes in viewBox units. */
export type PackLayer = GlyphLayer;

export interface PackIcon {
  /** Unique within the pack: lower-case words joined by hyphens. */
  id: string;
  /** Label shown in the palette and the default text of a node. */
  name: string;
  category?: string;
  viewBox: { w: number; h: number };
  layers: PackLayer[];
}

export interface IconPack {
  /** Library id: lower-case words joined by hyphens. Shapes are `<id>/<icon id>`. */
  id: string;
  name: string;
  description?: string;
  /** Where the icons came from (a vendor page, a file name). Informational. */
  source?: string;
  icons: PackIcon[];
}

/** What lists and the palette need to know without loading the icons. */
export interface PackInfo {
  id: string;
  name: string;
  description?: string;
  source?: string;
  iconCount: number;
  categories: string[];
  /** Approximate serialised size. */
  bytes: number;
}

/** `PackInfo` plus when the pack was stored; what `GET /api/packs` lists. */
export interface PackSummary extends PackInfo {
  updatedAt: string;
}

/* ------------------------------------------------------------------ limits */

export const PACK_LIMITS = {
  icons: 2000,
  /** Path data plus overhead of a single icon. */
  iconBytes: 200 * 1024,
  /** Everything in one pack. */
  totalBytes: 20 * 1024 * 1024,
  layers: 400,
  /** `pack id` + `/` + `icon id` has to stay within the document schema's shape id limit (80). */
  packId: 32,
  iconId: 47,
} as const;

const LAYER_OVERHEAD = 48;

/* ------------------------------------------------------------------ schema */

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Path data uses commands, numbers and separators only.
const PATH_DATA = /^\s*[Mm][MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;

const color = z
  .string()
  .refine((value) => normalizeColor(value) !== undefined, "Expected #rgb, #rrggbb or none")
  .transform((value) => normalizeColor(value) as string);

const layerSchema = z.object({
  d: z.string().min(1).max(PACK_LIMITS.iconBytes).regex(PATH_DATA, "Not SVG path data"),
  fill: color.optional(),
  stroke: color.optional(),
  strokeWidth: z.number().min(0).max(1000).optional(),
  opacity: z.number().min(0).max(1).optional(),
  round: z.boolean().optional(),
  evenOdd: z.boolean().optional(),
});

const iconSchema = z.object({
  id: z.string().min(1).max(PACK_LIMITS.iconId).regex(ID, "Use lower-case letters, digits and hyphens"),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().max(80).optional(),
  viewBox: z.object({ w: z.number().positive().max(100_000), h: z.number().positive().max(100_000) }),
  layers: z.array(layerSchema).min(1).max(PACK_LIMITS.layers),
});

export const packSchema = z.object({
  id: z.string().min(1).max(PACK_LIMITS.packId).regex(ID, "Use lower-case letters, digits and hyphens"),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  source: z.string().max(300).optional(),
  icons: z.array(iconSchema).min(1).max(PACK_LIMITS.icons),
});

export function iconBytes(icon: Pick<PackIcon, "layers">): number {
  return icon.layers.reduce((sum, layer) => sum + layer.d.length + LAYER_OVERHEAD, 0);
}

export function packBytes(pack: Pick<IconPack, "icons">): number {
  return pack.icons.reduce((sum, icon) => sum + iconBytes(icon) + 64, 0);
}

export type PackValidation = { ok: true; pack: IconPack } | { ok: false; error: string };

/** Validates untrusted input (a request body, a file) and returns it normalised. Never throws. */
export function validatePack(input: unknown): PackValidation {
  const parsed = packSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: formatIssues(parsed.error) };
  const pack = parsed.data as IconPack;

  const seen = new Set<string>();
  for (const icon of pack.icons) {
    if (seen.has(icon.id)) return { ok: false, error: `icons: duplicate icon id "${icon.id}"` };
    seen.add(icon.id);
    if (iconBytes(icon) > PACK_LIMITS.iconBytes) {
      return { ok: false, error: `Icon "${icon.id}" is larger than ${PACK_LIMITS.iconBytes / 1024} KB (too detailed; simplify it or leave it out).` };
    }
  }
  const total = packBytes(pack);
  if (total > PACK_LIMITS.totalBytes) {
    return { ok: false, error: `The pack is ${(total / 1048576).toFixed(1)} MB; the limit is ${PACK_LIMITS.totalBytes / 1048576} MB. Split it into several packs.` };
  }
  return { ok: true, pack };
}

export function packInfo(pack: IconPack): PackInfo {
  const categories = [...new Set(pack.icons.map((icon) => icon.category).filter((category): category is string => Boolean(category)))];
  return { id: pack.id, name: pack.name, description: pack.description, source: pack.source, iconCount: pack.icons.length, categories, bytes: packBytes(pack) };
}

/** `AWS Architecture Icons` → `aws-architecture-icons`, within the id limit. */
export function packIdFromName(name: string): string {
  const id = slugify(name, PACK_LIMITS.packId).replace(/-+$/, "");
  return id || "icons";
}

/* ----------------------------------------------------------------- preview */

const SAFE_COLOR = /^(?:#[0-9a-f]{6}|none)$/;

/**
 * SVG markup (the paths only, in the icon's viewBox units) for previews outside
 * the shape pipeline, such as the import dialog. Paths are re-serialised, so
 * the result is safe to inject whatever the icon came from.
 */
export function iconMarkup(icon: PackIcon): string {
  return icon.layers
    .map((layer) => {
      const attrs = [`d="${pathToSvg(parseSvgPath(layer.d), 3)}"`];
      const fill = layer.fill !== undefined && SAFE_COLOR.test(layer.fill) ? layer.fill : layer.stroke ? "none" : "#000000";
      attrs.push(`fill="${fill}"`);
      if (layer.stroke && SAFE_COLOR.test(layer.stroke) && layer.stroke !== "none") {
        attrs.push(`stroke="${layer.stroke}"`, `stroke-width="${Number(layer.strokeWidth ?? 1)}"`);
        if (layer.round) attrs.push('stroke-linecap="round"', 'stroke-linejoin="round"');
      }
      if (layer.opacity !== undefined && layer.opacity < 1) attrs.push(`opacity="${Number(layer.opacity)}"`);
      if (layer.evenOdd) attrs.push('fill-rule="evenodd"');
      return `<path ${attrs.join(" ")}/>`;
    })
    .join("");
}

/* ----------------------------------------------------------------- library */

const VENDOR_PREFIX = /^(?:amazon web services|amazon|aws|microsoft azure|azure|microsoft|google cloud|google|gcp)\s+/i;

const PREFIX_ALIASES: Record<string, string[]> = {
  aws: ["aws"],
  amazon: ["aws", "amazon"],
  azure: ["azure"],
  microsoft: ["azure", "microsoft"],
  google: ["gcp", "google"],
  gcp: ["gcp"],
};

/** Short names people type in front of a service name: `aws-lambda`, `gcp-pubsub`. */
function packPrefixes(packName: string): string[] {
  const first = slugify(packName.split(/\s+/)[0] ?? "", 12);
  return PREFIX_ALIASES[first] ?? (first.length >= 2 ? [first] : []);
}

function iconShape(pack: IconPack, icon: PackIcon, prefixes: string[]): ShapeDef {
  const short = slugify(icon.name.replace(VENDOR_PREFIX, ""), PACK_LIMITS.iconId) || icon.id;
  const aliases = new Set<string>([icon.id, short, ...prefixes.map((prefix) => `${prefix}-${short}`)]);
  aliases.delete("");
  return glyphTile({
    id: `${pack.id}/${icon.id}`,
    name: icon.name,
    aliases: [...aliases],
    keywords: [pack.name, ...(icon.category ? [icon.category] : [])],
    description: `${icon.name}${icon.category ? ` (${icon.category})` : ""} from the “${pack.name}” icon pack.`,
    art: (_ctx, box) => glyphPrims(icon.layers, icon.viewBox, box.x, box.y, box.w, box.h),
  });
}

/** Builds the shape library for a validated pack: one tile shape per icon, id `<pack id>/<icon id>`. */
export function packToLibrary(pack: IconPack): ShapeLibrary {
  const prefixes = packPrefixes(pack.name);
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description ?? `Imported icon pack with ${pack.icons.length} icons.`,
    shapes: pack.icons.map((icon) => iconShape(pack, icon, prefixes)),
  };
}
