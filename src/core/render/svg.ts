import { expand, round } from "../geometry/basics";
import { pathToSvg, rectPath } from "../geometry/path";
import type { Color, Rect } from "../model/types";
import type { PathPrim, Prim, TextPrim } from "../shapes/types";
import { cssFontFamily, fontVariant, type FontVariant } from "../text/fonts";
import { layoutText } from "../text/layout";
import { safeLink } from "../model/url";
import { dashSpec, isPaint, type Scene } from "./scene";

export interface SvgOptions {
  /** Empty margin around the content, in px. */
  padding?: number;
  /** `"doc"` uses the diagram background; `"transparent"` omits it. */
  background?: "doc" | "transparent" | Color;
  /** Region to render instead of the content bounds (already in world space). */
  bounds?: Rect;
  /** Multiplier for the intrinsic width/height (the viewBox is unchanged). */
  scale?: number;
  /** `@font-face` rules to embed so the file renders without the app's fonts. */
  fontCss?: string;
  title?: string;
}

export interface SvgResult {
  svg: string;
  /** Intrinsic size in px, after `scale`. */
  width: number;
  height: number;
  viewBox: Rect;
}

const EMPTY_VIEW: Rect = { x: 0, y: 0, w: 480, h: 320 };

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const n = (value: number): number => round(value, 2);

function pathToElement(prim: PathPrim): string {
  const attrs: string[] = [`d="${pathToSvg(prim.d)}"`];
  attrs.push(`fill="${isPaint(prim.fill) ? prim.fill : "none"}"`);
  if (prim.evenOdd) attrs.push(`fill-rule="evenodd"`);
  if (isPaint(prim.stroke)) {
    const width = prim.strokeWidth ?? 1;
    attrs.push(`stroke="${prim.stroke}"`, `stroke-width="${n(width)}"`);
    const dash = dashSpec(prim.dash, width);
    if (dash) attrs.push(`stroke-dasharray="${dash.array.map(n).join(" ")}"`);
    if (prim.round || dash?.round) attrs.push(`stroke-linecap="round"`, `stroke-linejoin="round"`);
  }
  if (prim.opacity !== undefined && prim.opacity < 1) attrs.push(`opacity="${n(prim.opacity)}"`);
  return `<path ${attrs.join(" ")}/>`;
}

function textToElements(prim: TextPrim): string {
  const layout = layoutText(prim);
  const variant = fontVariant(prim.font);
  let out = "";
  if (prim.background) {
    out += `<path d="${pathToSvg(rectPath(prim.box.x, prim.box.y, prim.box.w, prim.box.h, 3))}" fill="${prim.background}"/>`;
  }
  const attrs = [
    `font-family="${escapeXml(cssFontFamily(prim.font.family))}"`,
    `font-size="${n(prim.font.size)}"`,
    variant.weight !== 400 ? `font-weight="${variant.weight}"` : "",
    prim.font.italic ? `font-style="italic"` : "",
    `fill="${prim.color}"`,
    layout.anchor !== "start" ? `text-anchor="${layout.anchor}"` : "",
    `xml:space="preserve"`,
  ].filter(Boolean);
  const spans = layout.lines
    .filter((line) => line.text.length > 0)
    .map((line) => `<tspan x="${n(line.x)}" y="${n(line.y)}">${escapeXml(line.text)}</tspan>`)
    .join("");
  if (spans) out += `<text ${attrs.join(" ")}>${spans}</text>`;

  if (prim.underline) {
    const thickness = Math.max(1, prim.font.size / 14);
    for (const line of layout.lines) {
      if (!line.text.trim()) continue;
      const left = layout.anchor === "start" ? line.x : layout.anchor === "end" ? line.x - line.width : line.x - line.width / 2;
      const y = line.y + prim.font.size * 0.14;
      out += `<path d="M${n(left)} ${n(y)}L${n(left + line.width)} ${n(y)}" fill="none" stroke="${prim.color}" stroke-width="${n(thickness)}"/>`;
    }
  }
  return out;
}

export function primToSvg(prim: Prim): string {
  return prim.kind === "path" ? pathToElement(prim) : textToElements(prim);
}

/** Font variants referenced by the scene, so callers embed only what is used. */
export function usedFonts(scene: Scene): FontVariant[] {
  const seen = new Map<string, FontVariant>();
  for (const layer of scene.layers) {
    for (const prim of layer.prims) {
      if (prim.kind !== "text") continue;
      const variant = fontVariant(prim.font);
      seen.set(variant.key, variant);
    }
  }
  return [...seen.values()];
}

/** Builds `@font-face` CSS from base64-encoded TTF data keyed by file name. */
export function fontFaceCss(variants: FontVariant[], base64ByFile: Record<string, string>): string {
  return variants
    .filter((v) => base64ByFile[v.file])
    .map(
      (v) =>
        `@font-face{font-family:'${v.cssFamily}';font-weight:${v.weight};font-style:${v.italic ? "italic" : "normal"};` +
        `src:url(data:font/ttf;base64,${base64ByFile[v.file]}) format('truetype');}`,
    )
    .join("");
}

/** Region rendered for a scene: the given bounds or the content, plus padding. */
export function sceneViewBox(scene: Scene, options: Pick<SvgOptions, "padding" | "bounds"> = {}): Rect {
  const content = options.bounds ?? scene.bounds;
  if (!content) return EMPTY_VIEW;
  return expand(content, options.padding ?? 24);
}

/** Serializes a scene to a standalone SVG document. */
export function renderSvg(scene: Scene, options: SvgOptions = {}): SvgResult {
  const view = sceneViewBox(scene, options);
  const scale = options.scale ?? 1;
  const width = n(view.w * scale);
  const height = n(view.h * scale);
  const background = options.background === undefined || options.background === "doc" ? scene.background : options.background;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}">`,
  ];
  if (options.title) parts.push(`<title>${escapeXml(options.title)}</title>`);
  if (options.fontCss) parts.push(`<defs><style>${options.fontCss}</style></defs>`);
  if (background !== "transparent" && isPaint(background)) {
    parts.push(`<rect x="${n(view.x)}" y="${n(view.y)}" width="${n(view.w)}" height="${n(view.h)}" fill="${background}"/>`);
  }

  for (const layer of scene.layers) {
    const attrs: string[] = [`data-id="${escapeXml(layer.id)}"`];
    if (layer.matrix) attrs.push(`transform="matrix(${layer.matrix.map((v) => round(v, 4)).join(" ")})"`);
    if (layer.opacity < 1) attrs.push(`opacity="${n(layer.opacity)}"`);
    const content = layer.prims.map(primToSvg).join("");
    const group = `<g ${attrs.join(" ")}>${content}</g>`;
    const href = safeLink(layer.link);
    parts.push(href ? `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer">${group}</a>` : group);
  }
  parts.push("</svg>");
  return { svg: parts.join(""), width, height, viewBox: view };
}
