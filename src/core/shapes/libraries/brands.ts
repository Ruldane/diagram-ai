import { luminance, readableTextOn, INK } from "../../model/palette";
import type { Color } from "../../model/types";
import { BRAND_DATA, type BrandData } from "../brand-data";
import { glyphTile } from "../glyph-tile";
import { brandPrims, icon, type ShapeDef, type ShapeLibrary } from "../kit";

/** Below this contrast against the tile, a brand colour is replaced by ink (pale yellows, near-black marks). */
const MIN_CONTRAST = 2;
const NEAR_BLACK = 0.02;

/** The brand colour when it reads on the tile's fill, otherwise the readable ink for that fill. */
function glyphColor(hex: Color, fill: Color): Color {
  const background = fill === "none" ? "#ffffff" : fill;
  const lb = luminance(background);
  const lc = luminance(hex);
  const contrast = (Math.max(lb, lc) + 0.05) / (Math.min(lb, lc) + 0.05);
  if (lc < NEAR_BLACK) return readableTextOn(background);
  return contrast >= MIN_CONTRAST ? hex : readableTextOn(background) === "#ffffff" ? "#ffffff" : INK;
}

function brandShape(slug: string, brand: BrandData): ShapeDef {
  const names = new Set([slug, brand.title, ...(brand.aliases ?? []), `${slug}-logo`, `${brand.title} logo`]);
  return glyphTile({
    id: `brands/${slug}`,
    name: brand.title,
    aliases: [...names],
    keywords: [brand.group, "logo", "brand"],
    description: `${brand.title} logo (${brand.group.toLowerCase()}). Use when the diagram should show the real product rather than a generic ${brand.group === "Data & storage" ? "database" : "component"}.`,
    art: (ctx, box) => {
      const color = glyphColor(brand.hex, ctx.style.fill);
      // Brands missing from simple-icons carry a stroke glyph instead of artwork.
      if (!brand.path) return icon(ctx, brand.icon ?? "cloud", box.x, box.y, box.w, color);
      return brandPrims(brand.path, box.x, box.y, box.w, color);
    },
  });
}

/**
 * Technology brand logos (CC0 geometry from simple-icons; the marks belong to
 * their owners). Generated data: `npm run icons:brands`, see `docs/icons.md`.
 */
export const brandsLibrary: ShapeLibrary = {
  id: "brands",
  name: "Brand logos",
  description:
    "Logos of common technologies as tiles with the product name: cloud providers, databases, messaging, observability, CI, languages, frameworks, AI and SaaS. Address them as `brands/<slug>` (brands/postgresql, brands/apachekafka) or `<name>-logo` (postgres-logo, kafka-logo): bare product names such as `postgres` or `kafka` mean the generic infra tile.",
  shapes: Object.entries(BRAND_DATA).map(([slug, brand]) => brandShape(slug, brand)),
};
