import type { Point } from "../../model/types";

/** Two runs closer than this are one channel. */
const SAME_LINE = 1;

/**
 * Axis-aligned runs of connectors that are already routed, hashed by their
 * line so "does this candidate run share a channel with another connector"
 * is a handful of map lookups.
 */
export class RoutedIndex {
  private readonly horizontal = new Map<number, number[]>();
  private readonly vertical = new Map<number, number[]>();
  /** Number of runs stored; zero lets callers skip overlap checks entirely. */
  count = 0;

  add(points: Point[]): void {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx < 1 && dy < 1) continue;
      if (dy <= dx) this.put(this.horizontal, (a.y + b.y) / 2, Math.min(a.x, b.x), Math.max(a.x, b.x));
      else this.put(this.vertical, (a.x + b.x) / 2, Math.min(a.y, b.y), Math.max(a.y, b.y));
    }
  }

  private put(map: Map<number, number[]>, coord: number, lo: number, hi: number): void {
    const key = Math.round(coord);
    const list = map.get(key);
    if (list) list.push(coord, lo, hi);
    else map.set(key, [coord, lo, hi]);
    this.count++;
  }

  /** Length of [lo, hi] on the line `coord` that is already used by another connector. */
  overlap(horizontal: boolean, coord: number, lo: number, hi: number): number {
    const map = horizontal ? this.horizontal : this.vertical;
    const key = Math.round(coord);
    let total = 0;
    for (let k = key - 1; k <= key + 1; k++) {
      const list = map.get(k);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 3) {
        if (Math.abs(list[i] - coord) > SAME_LINE) continue;
        const shared = Math.min(hi, list[i + 2]) - Math.max(lo, list[i + 1]);
        if (shared > 0) total += shared;
      }
    }
    return total;
  }
}
