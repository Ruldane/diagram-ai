import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const API = path.join(process.cwd(), "src", "app", "api");

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routes(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** Routes that are public on purpose, each with the reason. Everything else must check who is calling. */
const PUBLIC: Record<string, string> = {
  "health/route.ts": "liveness; returns no data",
  "auth/session/route.ts": "tells the shell who is signed in (resolves the principal itself)",
  "auth/register/route.ts": "creates an account (governed by the sign-up policy and rate limits)",
  "auth/login/route.ts": "signs in (rate limited)",
  "auth/logout/route.ts": "clears the caller's own cookie",
  "share/redeem/route.ts": "turns a share-link token into access (resolves the principal itself)",
};

const GUARDS = ["requestContext(", "sessionContext(", "adminContext(", "getAuthService("];

describe("every API route decides who may call it", () => {
  const files = routes(API).map((file) => ({ file, relative: path.relative(API, file).split(path.sep).join("/") }));

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { file, relative } of files) {
    it(`${relative}`, () => {
      const source = readFileSync(file, "utf8");
      if (relative in PUBLIC) return; // reviewed above
      expect(GUARDS.some((guard) => source.includes(guard)), `${relative} must call requestContext() (or sessionContext()) before touching diagrams`).toBe(true);
    });
  }

  it("never reaches the service or the hub without the request-scoped wrapper", () => {
    for (const { file, relative } of files) {
      const source = readFileSync(file, "utf8");
      // `getHub` is allowed only in the workspace stream, which filters its events itself.
      const direct = /\b(getService|getContext)\s*\(/.test(source) || (/\bgetHub\s*\(/.test(source) && relative !== "events/route.ts");
      expect(direct, `${relative} bypasses the authorization wrapper`).toBe(false);
    }
  });

  it("mutating routes keep the same-origin guard", () => {
    for (const { file, relative } of files) {
      const source = readFileSync(file, "utf8");
      if (/export const (POST|PATCH|DELETE|PUT)\b/.test(source) && !relative.startsWith("mcp/")) {
        expect(source.includes("assertSameOrigin("), `${relative} changes state without assertSameOrigin`).toBe(true);
      }
    }
  });
});
