import type { ElkLike } from "./layout";

let instance: Promise<ElkLike> | null = null;

/**
 * Lazily loads the ELK layout engine. It is a large module, so it is only
 * imported the first time a layout is requested (browser and server alike).
 */
export function loadElk(): Promise<ElkLike> {
  instance ??= import("elkjs/lib/elk.bundled.js").then((mod) => {
    const Elk = (mod.default ?? mod) as unknown as new () => ElkLike;
    return new Elk();
  });
  return instance;
}
