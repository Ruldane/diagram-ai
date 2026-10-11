import type { Rect } from "../../model/types";

const CELL = 240;

/**
 * Uniform-grid bucket index over rectangles. Queries return rectangle indices
 * in ascending order, so everything built on it is deterministic.
 */
export class BoxIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly rects: Rect[] = [];
  private seen = new Int32Array(0);
  private tick = 0;

  get size(): number {
    return this.rects.length;
  }

  rect(index: number): Rect {
    return this.rects[index];
  }

  add(rect: Rect): number {
    const index = this.rects.length;
    this.rects.push(rect);
    const x0 = Math.floor(rect.x / CELL);
    const x1 = Math.floor((rect.x + rect.w) / CELL);
    const y0 = Math.floor(rect.y / CELL);
    const y1 = Math.floor((rect.y + rect.h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cx * 100003 + cy;
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(index);
        else this.cells.set(key, [index]);
      }
    }
    return index;
  }

  /** Indices of the rectangles whose interior overlaps `area`. */
  query(area: Rect): number[] {
    if (this.seen.length < this.rects.length) this.seen = new Int32Array(this.rects.length * 2);
    const tick = ++this.tick;
    const out: number[] = [];
    const x0 = Math.floor(area.x / CELL);
    const x1 = Math.floor((area.x + area.w) / CELL);
    const y0 = Math.floor(area.y / CELL);
    const y1 = Math.floor((area.y + area.h) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(cx * 100003 + cy);
        if (!bucket) continue;
        for (const index of bucket) {
          if (this.seen[index] === tick) continue;
          this.seen[index] = tick;
          const r = this.rects[index];
          if (r.x < area.x + area.w && r.x + r.w > area.x && r.y < area.y + area.h && r.y + r.h > area.y) out.push(index);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }
}
