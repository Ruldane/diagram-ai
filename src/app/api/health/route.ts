import { connection } from "next/server";

import { getDatabase } from "@/server/context";
import { json, route } from "@/server/http";

/** Liveness plus which storage backend is active; never returns connection details. */
export const GET = route(async () => {
  await connection();
  const database = getDatabase();
  if (!database) return json({ ok: true, storage: "files", migrations: 0 });
  try {
    return json({ ok: true, storage: "postgres", migrations: await database.check() });
  } catch (error) {
    console.error("[diagram-ai] Health check: the database is not usable:", error instanceof Error ? error.message : error);
    return json({ ok: false, storage: "postgres", migrations: 0 }, { status: 503 });
  }
});
