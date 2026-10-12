import { ServiceError } from "../errors";

/**
 * Sliding-window failure counter. Kept in process memory (plain data on
 * `globalThis`, like the realtime hub): the app runs as one process, and a
 * restart only forgives failures, it never locks anybody out.
 */
export interface RateLimitState {
  hits: Map<string, number[]>;
}

export const createRateLimitState = (): RateLimitState => ({ hits: new Map() });

const MAX_KEYS = 50_000;

export class RateLimited extends ServiceError {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super("rate_limited", message);
  }
}

export class RateLimiter {
  constructor(
    private readonly state: RateLimitState,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string, windowMs: number): number[] {
    const cutoff = this.now() - windowMs;
    const list = (this.state.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (list.length) this.state.hits.set(key, list);
    else this.state.hits.delete(key);
    return list;
  }

  /** Seconds until the key may try again, or 0 when it is under the limit. */
  retryAfter(key: string, limit: number, windowMs: number): number {
    const list = this.recent(key, windowMs);
    if (list.length < limit) return 0;
    return Math.max(1, Math.ceil((list[list.length - limit] + windowMs - this.now()) / 1000));
  }

  /** Records one attempt. */
  hit(key: string): void {
    if (this.state.hits.size > MAX_KEYS) this.state.hits.clear(); // a flood of distinct keys must not grow memory without bound
    const list = this.state.hits.get(key) ?? [];
    list.push(this.now());
    this.state.hits.set(key, list);
  }

  reset(key: string): void {
    this.state.hits.delete(key);
  }

  /** Throws a 429 when `key` is over the limit. */
  assertAllowed(key: string, limit: number, windowMs: number, what = "attempts"): void {
    const wait = this.retryAfter(key, limit, windowMs);
    if (wait > 0) throw new RateLimited(`Too many ${what}. Try again in ${wait > 90 ? `${Math.ceil(wait / 60)} minutes` : `${wait} seconds`}.`, wait);
  }
}
