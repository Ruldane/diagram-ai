import { readFile } from "node:fs/promises";
import path from "node:path";

import { allFontVariants } from "@/core/text/fonts";

import { FONTS_DIR } from "../config";

/** Absolute paths of every bundled TTF, for the rasteriser. */
export const fontFilePaths = (): string[] => allFontVariants().map((variant) => path.join(FONTS_DIR, variant.file));

let base64Cache: Promise<Record<string, string>> | null = null;

/** Bundled fonts as base64, keyed by file name (embedded into SVG and PDF output). */
export function fontsBase64(): Promise<Record<string, string>> {
  base64Cache ??= (async () => {
    const entries = await Promise.all(
      allFontVariants().map(async (variant) => {
        const data = await readFile(path.join(FONTS_DIR, variant.file));
        return [variant.file, data.toString("base64")] as const;
      }),
    );
    return Object.fromEntries(entries);
  })();
  return base64Cache;
}
