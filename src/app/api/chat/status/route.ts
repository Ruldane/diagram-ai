import { connection } from "next/server";

import type { ChatStatusResponse } from "@/core/protocol";
import { engineStatuses } from "@/server/chat/engines";
import { json, route } from "@/server/http";

/**
 * Which engines can answer: the person's own Claude Code and Codex CLIs
 * (installed and signed in, on this computer) and the Claude API (key set).
 * Reports names, availability and how each is billed, never a key or token.
 */
export const GET = route(async (request: Request) => {
  await connection();
  return json((await engineStatuses(request)) satisfies ChatStatusResponse, { headers: { "Cache-Control": "no-store" } });
});
