"use client";

import { memo, useMemo } from "react";

import { expand } from "@/core/geometry/basics";
import type { DNode } from "@/core/model/types";
import { nodePrims, primsBounds } from "@/core/render/scene";
import { primToSvg } from "@/core/render/svg";
import { getShape } from "@/core/shapes/registry";

/**
 * Miniature of a shape for palettes and pickers, rendered with the real shape
 * code so the preview is always truthful.
 */
export const ShapeThumb = memo(function ShapeThumb({ shapeId, size = 40, withText = false }: { shapeId: string; size?: number; withText?: boolean }) {
  const { markup, viewBox } = useMemo(() => {
    const def = getShape(shapeId);
    const node: DNode = { id: "thumb", shape: def.id, x: 0, y: 0, w: def.size.w, h: def.size.h, z: 0, text: withText ? def.text : undefined, data: def.data };
    const prims = nodePrims(node);
    const bounds = expand(primsBounds(prims) ?? { x: 0, y: 0, w: def.size.w, h: def.size.h }, 3);
    return { markup: prims.map(primToSvg).join(""), viewBox: `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}` };
  }, [shapeId, withText]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      className="shape-thumb pointer-events-none shrink-0 dark:[filter:invert(0.92)_hue-rotate(180deg)]"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
});
