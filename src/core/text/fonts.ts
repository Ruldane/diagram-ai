import type { FontFamily } from "../model/types";

export interface FontSpec {
  family: FontFamily;
  size: number;
  bold?: boolean;
  italic?: boolean;
}

interface FamilyDef {
  label: string;
  /** CSS / SVG family name of the bundled TTF. */
  css: string;
  /** Generic fallback appended in SVG output. */
  fallback: string;
  /** Font present on every Office machine, used for editable PowerPoint text. */
  office: string;
  filePrefix: string;
  /** Available variants: weight plus optional `i` for italic. */
  variants: readonly string[];
  boldWeight: number;
}

export const FONT_FAMILIES: Record<FontFamily, FamilyDef> = {
  sans: {
    label: "Sans",
    css: "IBM Plex Sans",
    fallback: "Arial, Helvetica, sans-serif",
    office: "Arial",
    filePrefix: "plex-sans",
    variants: ["400", "400i", "600", "600i"],
    boldWeight: 600,
  },
  serif: {
    label: "Serif",
    css: "IBM Plex Serif",
    fallback: "Georgia, 'Times New Roman', serif",
    office: "Georgia",
    filePrefix: "plex-serif",
    variants: ["400", "400i", "600"],
    boldWeight: 600,
  },
  mono: {
    label: "Mono",
    css: "IBM Plex Mono",
    fallback: "'Courier New', monospace",
    office: "Courier New",
    filePrefix: "plex-mono",
    variants: ["400", "400i", "600"],
    boldWeight: 600,
  },
  hand: {
    label: "Hand",
    css: "Kalam",
    fallback: "'Comic Sans MS', cursive",
    office: "Comic Sans MS",
    filePrefix: "kalam",
    variants: ["400", "700"],
    boldWeight: 700,
  },
};

export const FONT_FAMILY_KEYS = Object.keys(FONT_FAMILIES) as FontFamily[];

export interface FontVariant {
  /** Key into the metrics table, e.g. `sans-600i`. */
  key: string;
  /** File name under `/fonts`. */
  file: string;
  cssFamily: string;
  weight: number;
  /** Whether a real italic face backs this variant. */
  italic: boolean;
}

/** Resolves a font spec to the closest bundled TTF variant. */
export function fontVariant(spec: Pick<FontSpec, "family" | "bold" | "italic">): FontVariant {
  const family = FONT_FAMILIES[spec.family] ?? FONT_FAMILIES.sans;
  const familyKey = FONT_FAMILIES[spec.family] ? spec.family : "sans";
  const weight = spec.bold ? family.boldWeight : 400;
  const wantsItalic = Boolean(spec.italic);
  const italic = wantsItalic && family.variants.includes(`${weight}i`);
  const variant = `${weight}${italic ? "i" : ""}`;
  return {
    key: `${familyKey}-${variant}`,
    file: `${family.filePrefix}-${variant}.ttf`,
    cssFamily: family.css,
    weight,
    italic,
  };
}

/** Every bundled font file, for loaders that need the whole set. */
export function allFontVariants(): FontVariant[] {
  const out: FontVariant[] = [];
  for (const key of FONT_FAMILY_KEYS) {
    const family = FONT_FAMILIES[key];
    for (const variant of family.variants) {
      out.push({
        key: `${key}-${variant}`,
        file: `${family.filePrefix}-${variant}.ttf`,
        cssFamily: family.css,
        weight: parseInt(variant, 10),
        italic: variant.endsWith("i"),
      });
    }
  }
  return out;
}

export function cssFontFamily(family: FontFamily): string {
  const def = FONT_FAMILIES[family] ?? FONT_FAMILIES.sans;
  return `'${def.css}', ${def.fallback}`;
}
