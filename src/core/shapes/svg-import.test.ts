import { describe, expect, it } from "vitest";

import { parseSvgPath, pathBounds } from "../geometry/path";
import { importSvg } from "./svg-import";

const svg = (body: string, attrs = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

function layersOf(source: string) {
  const { artwork } = importSvg(source);
  expect(artwork).not.toBeNull();
  return artwork!.layers;
}

const boundsOf = (d: string) => pathBounds(parseSvgPath(d))!;

describe("importSvg: elements", () => {
  it("reads paths with their fill", () => {
    const [layer] = layersOf(svg('<path d="M2 2h10v10H2z" fill="#ff0000"/>'));
    expect(layer.fill).toBe("#ff0000");
    expect(boundsOf(layer.d)).toMatchObject({ x: 2, y: 2, w: 10, h: 10 });
  });

  it("draws rects, including rounded ones", () => {
    const [plain, rounded] = layersOf(svg('<rect x="1" y="2" width="8" height="6" fill="#00f"/><rect x="10" y="2" width="8" height="6" rx="2" fill="#0f0"/>'));
    expect(boundsOf(plain.d)).toMatchObject({ x: 1, y: 2, w: 8, h: 6 });
    expect(plain.d).not.toContain("C");
    expect(rounded.d).toContain("C");
    expect(rounded.fill).toBe("#00ff00");
  });

  it("draws circles, ellipses, lines, polylines and polygons", () => {
    const layers = layersOf(
      svg(
        '<circle cx="12" cy="12" r="5" fill="#111111"/>' +
          '<ellipse cx="6" cy="6" rx="4" ry="2" fill="#222222"/>' +
          '<line x1="0" y1="0" x2="10" y2="10" stroke="#333333" stroke-width="2"/>' +
          '<polyline points="0,0 5,5 10,0" fill="none" stroke="#444444"/>' +
          '<polygon points="0,0 8,0 4,6" fill="#555555"/>',
      ),
    );
    expect(layers).toHaveLength(5);
    expect(boundsOf(layers[0].d)).toMatchObject({ x: 7, y: 7, w: 10, h: 10 });
    expect(boundsOf(layers[1].d)).toMatchObject({ w: 8, h: 4 });
    expect(layers[2]).toMatchObject({ fill: "none", stroke: "#333333", strokeWidth: 2 });
    expect(layers[3]).toMatchObject({ fill: "none", stroke: "#444444" });
    expect(layers[4].d.endsWith("Z")).toBe(true);
  });

  it("uses black when no fill is given, like SVG does", () => {
    expect(layersOf(svg('<path d="M0 0h5v5z"/>'))[0].fill).toBe("#000000");
  });

  it("skips shapes that paint nothing", () => {
    const result = importSvg(svg('<path d="M0 0h5v5z" fill="none"/><path d="M1 1h5v5z" fill="#123456"/><path d="M2 2h5v5z" display="none"/>'));
    expect(result.artwork!.layers).toHaveLength(1);
  });
});

describe("importSvg: transforms and viewBox", () => {
  it("applies translate, scale, rotate and matrix on groups", () => {
    const layers = layersOf(
      svg(
        '<g transform="translate(10 5)"><rect width="4" height="4" fill="#111111"/></g>' +
          '<g transform="scale(2)"><rect width="4" height="4" fill="#222222"/></g>' +
          '<g transform="rotate(90 6 6)"><rect x="4" y="2" width="4" height="8" fill="#333333"/></g>' +
          '<g transform="matrix(1 0 0 1 3 4)"><rect width="2" height="2" fill="#444444"/></g>',
      ),
    );
    expect(boundsOf(layers[0].d)).toMatchObject({ x: 10, y: 5, w: 4, h: 4 });
    expect(boundsOf(layers[1].d)).toMatchObject({ x: 0, y: 0, w: 8, h: 8 });
    const rotated = boundsOf(layers[2].d);
    expect(rotated.w).toBeCloseTo(8);
    expect(rotated.h).toBeCloseTo(4);
    expect(boundsOf(layers[3].d)).toMatchObject({ x: 3, y: 4, w: 2, h: 2 });
  });

  it("scales stroke widths with the transform", () => {
    const [layer] = layersOf(svg('<g transform="scale(3)"><path d="M0 0L5 0" stroke="#000000" stroke-width="2"/></g>'));
    expect(layer.strokeWidth).toBe(6);
  });

  it("anchors the artwork at the origin when the viewBox does not start there", () => {
    const { artwork } = importSvg(svg('<rect x="100" y="50" width="20" height="10" fill="#111111"/>', 'viewBox="100 50 20 10"'));
    expect(artwork!.viewBox).toEqual({ w: 20, h: 10 });
    expect(boundsOf(artwork!.layers[0].d)).toMatchObject({ x: 0, y: 0, w: 20, h: 10 });
  });

  it("falls back to width and height, then to the artwork's bounds", () => {
    expect(importSvg(svg('<rect width="30" height="20" fill="#111111"/>', 'width="64px" height="48px"')).artwork!.viewBox).toEqual({ w: 64, h: 48 });
    const bare = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="30" height="20" fill="#111111"/></svg>');
    expect(bare.artwork!.viewBox).toEqual({ w: 30, h: 20 });
  });
});

describe("importSvg: styles", () => {
  it("inherits fill from groups and lets children override", () => {
    const layers = layersOf(svg('<g fill="#ff0000"><path d="M0 0h5v5z"/><path d="M6 6h5v5z" fill="#0000ff"/></g>'));
    expect(layers.map((layer) => layer.fill)).toEqual(["#ff0000", "#0000ff"]);
  });

  it("reads inline style attributes and multiplies opacities", () => {
    const [layer] = layersOf(svg('<g opacity="0.5"><path d="M0 0h5v5z" style="fill:#00ff00;fill-opacity:0.5"/></g>'));
    expect(layer.fill).toBe("#00ff00");
    expect(layer.opacity).toBeCloseTo(0.25);
  });

  it("applies simple <style> rules by class, id and tag", () => {
    const layers = layersOf(
      svg('<defs><style>.a{fill:#ff0000}#b{fill:#00ff00}path{stroke:#0000ff}</style></defs><path class="a" d="M0 0h5v5z"/><path id="b" d="M6 6h5v5z"/>'),
    );
    expect(layers[0]).toMatchObject({ fill: "#ff0000", stroke: "#0000ff" });
    expect(layers[1]).toMatchObject({ fill: "#00ff00", stroke: "#0000ff" });
  });

  it("understands colour notations", () => {
    const layers = layersOf(
      svg(
        '<path d="M0 0h1v1z" fill="#f00"/><path d="M0 0h1v1z" fill="rgb(0, 128, 255)"/><path d="M0 0h1v1z" fill="navy"/><path d="M0 0h1v1z" fill="hsl(120, 100%, 50%)"/>',
      ),
    );
    expect(layers.map((layer) => layer.fill)).toEqual(["#ff0000", "#0080ff", "#000080", "#00ff00"]);
  });

  it("carries round caps and even-odd fill rules", () => {
    const [stroked, holed] = layersOf(
      svg('<path d="M0 0L5 5" stroke="#000000" stroke-linecap="round"/><path d="M0 0h8v8zM2 2h4v4z" fill="#111111" fill-rule="evenodd"/>'),
    );
    expect(stroked.round).toBe(true);
    expect(holed.evenOdd).toBe(true);
  });
});

describe("importSvg: use and defs", () => {
  it("instantiates <use> of a shape in defs and a symbol, with offset", () => {
    const layers = layersOf(
      svg(
        '<defs><rect id="r" width="4" height="4" fill="#111111"/><symbol id="s"><circle cx="2" cy="2" r="2" fill="#222222"/></symbol></defs>' +
          '<use href="#r" x="10" y="3"/><use xlink:href="#s" x="4" y="14"/>',
      ),
    );
    expect(layers).toHaveLength(2);
    expect(boundsOf(layers[0].d)).toMatchObject({ x: 10, y: 3 });
    expect(boundsOf(layers[1].d)).toMatchObject({ x: 4, y: 14 });
  });

  it("does not draw defs content by itself", () => {
    const result = importSvg(svg('<defs><rect width="4" height="4" fill="#111111"/></defs>'));
    expect(result.artwork).toBeNull();
  });
});

describe("importSvg: gradients and unsupported features", () => {
  it("flattens gradients to the mean stop colour and says so", () => {
    const result = importSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>' +
          '<rect width="10" height="10" fill="url(#g)"/>',
      ),
    );
    expect(result.artwork!.layers[0].fill).toBe("#808080");
    expect(result.warnings.join(" ")).toMatch(/gradient/i);
  });

  it("follows href chains for gradient stops", () => {
    const result = importSvg(
      svg('<defs><linearGradient id="a"><stop stop-color="#ff0000"/></linearGradient><linearGradient id="b" xlink:href="#a"/></defs><rect width="9" height="9" fill="url(#b)"/>'),
    );
    expect(result.artwork!.layers[0].fill).toBe("#ff0000");
  });

  it("skips images, text, filters, masks and clip paths with a warning", () => {
    const result = importSvg(
      svg(
        '<image href="data:image/png;base64,AAAA" width="5" height="5"/><text x="1" y="5">Hi</text>' +
          '<path d="M0 0h5v5z" fill="#123456" filter="url(#f)" clip-path="url(#c)" mask="url(#m)"/>',
      ),
    );
    expect(result.artwork!.layers).toHaveLength(1);
    const text = result.warnings.join(" ");
    expect(text).toMatch(/image/i);
    expect(text).toMatch(/text/i);
    expect(text).toMatch(/filter/i);
    expect(text).toMatch(/clipping/i);
    expect(text).toMatch(/mask/i);
  });

  it("reports unreadable input instead of throwing", () => {
    expect(importSvg("not xml at all").artwork).toBeNull();
    expect(importSvg("<html></html>").artwork).toBeNull();
    expect(importSvg(svg("")).warnings.length).toBeGreaterThan(0);
  });
});

describe("importSvg: backgrounds", () => {
  it("drops a full-size white or transparent rectangle", () => {
    const white = importSvg(svg('<rect width="24" height="24" fill="#ffffff"/><path d="M4 4h8v8z" fill="#ff0000"/>'));
    expect(white.artwork!.layers).toHaveLength(1);
    const named = importSvg(svg('<rect width="24" height="24" fill="white"/><path d="M4 4h8v8z" fill="#ff0000"/>'));
    expect(named.artwork!.layers).toHaveLength(1);
    const clear = importSvg(svg('<rect width="24" height="24" fill="none"/><path d="M4 4h8v8z" fill="#ff0000"/>'));
    expect(clear.artwork!.layers).toHaveLength(1);
  });

  it("keeps a coloured square behind a white glyph: that is the icon", () => {
    const layers = layersOf(svg('<rect width="24" height="24" fill="#ed7100"/><path d="M6 6h12v12z" fill="#ffffff"/>'));
    expect(layers.map((layer) => layer.fill)).toEqual(["#ed7100", "#ffffff"]);
  });

  it("keeps a white rectangle that is only part of the artwork", () => {
    expect(layersOf(svg('<rect x="4" y="4" width="10" height="10" fill="#ffffff"/>'))).toHaveLength(1);
  });

  it("keeps an outlined full-size frame", () => {
    expect(layersOf(svg('<rect width="24" height="24" fill="#ffffff" stroke="#000000"/>'))).toHaveLength(1);
  });
});
