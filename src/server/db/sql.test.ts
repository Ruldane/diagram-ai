import { EventEmitter } from "node:events";

import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { checkout, inTransaction } from "./sql";

/** A connection that records its statements and can be made to fail. */
function fakePool(fail: (text: string) => Error | null = () => null) {
  const client = Object.assign(new EventEmitter(), {
    statements: [] as string[],
    release: vi.fn(),
    query: async (text: string) => {
      client.statements.push(text);
      const error = fail(text);
      if (error) throw error;
      return { rows: [], rowCount: 0 };
    },
  });
  return { client, pool: { connect: async () => client } as unknown as Pool };
}

describe("checkout", () => {
  it("absorbs error events while the connection is checked out and stops listening on release", async () => {
    const { client, pool } = fakePool();
    const lease = await checkout(pool);
    // Without a listener this would throw: that is what took the process down when the database restarted.
    expect(() => client.emit("error", new Error("read ECONNRESET"))).not.toThrow();
    lease.release();
    expect(client.listenerCount("error")).toBe(0);
    expect(client.release).toHaveBeenCalledWith(false);
  });
});

describe("inTransaction", () => {
  it("commits what succeeded", async () => {
    const { client, pool } = fakePool();
    const result = await inTransaction(pool, async (c) => {
      await c.query("INSERT 1");
      return "done";
    });
    expect(result).toBe("done");
    expect(client.statements).toEqual(["BEGIN", "INSERT 1", "COMMIT"]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("rolls back and rethrows", async () => {
    const { client, pool } = fakePool((text) => (text === "INSERT 1" ? new Error("nope") : null));
    await expect(inTransaction(pool, (c) => c.query("INSERT 1"))).rejects.toThrow("nope");
    expect(client.statements).toEqual(["BEGIN", "INSERT 1", "ROLLBACK"]);
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("destroys a connection that cannot even roll back", async () => {
    const { client, pool } = fakePool((text) => (text === "INSERT 1" || text === "ROLLBACK" ? new Error("gone") : null));
    await expect(inTransaction(pool, (c) => c.query("INSERT 1"))).rejects.toThrow("gone");
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
