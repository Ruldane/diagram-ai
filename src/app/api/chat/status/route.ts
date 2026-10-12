import { connection } from "next/server";

import type { ChatStatusResponse } from "@/core/protocol";
import { engineStatuses } from "@/server/chat/engines";
import { json, route } from "@/server/http";
import { requestContext } from "@/server/auth/request";

/**
 * Which engines can answer: the person's own Claude Code CLI (installed and
 * signed in, on this computer) and the Claude API (key set).
 * Reports names, availability and how each is billed, never a key or token.
 */
export const GET = route(async (request: Request) => {
  await connection();
  (await requestContext(request)).access.requireUser();
  return json((await engineStatuses(request)) satisfies ChatStatusResponse, { headers: { "Cache-Control": "no-store" } });
});
