import { ASSISTANT_ACTOR, chatModel } from "@/server/chat/config";
import { assertAcknowledged, assertLocalRequest } from "@/server/chat/bridge/gating";
import { validateWorkdir } from "@/server/chat/bridge/workdir";
import { engineStatuses, getEngine } from "@/server/chat/engines";
import { describeChatError, MISSING_KEY_MESSAGE } from "@/server/chat/errors";
import { chatRequestSchema, normalizeHistory } from "@/server/chat/request";
import { claimChatRun } from "@/server/chat/run-lock";
import { ndjsonResponse } from "@/server/chat/stream";
import { requestContext } from "@/server/auth/request";
import { assertSameOrigin, json, route } from "@/server/http";

/**
 * The in-app assistant. Streams newline-delimited JSON `ChatStreamEvent`s
 * while an engine (the Claude API, or the person's own Claude Code CLI) drives
 * the same diagram tools MCP clients get, so the canvas updates live exactly
 * as it does for an external agent.
 */
export const POST = route(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(request);
  const { id } = await params;
  // Accounts on: the assistant edits the diagram, so it needs editor access; its changes are credited to this person.
  const { service, hub, access } = await requestContext(request);
  await access.require(id, "editor");
  const body = chatRequestSchema.parse(await request.json());
  const history = normalizeHistory(body.messages);

  const { engines, default: preferred } = await engineStatuses(request);
  const engineId = body.engine ?? preferred ?? "claude-api";
  const engine = getEngine(engineId);
  const status = engines.find((candidate) => candidate.id === engineId);

  if (engine.local) {
    // Throws a 403 unless this is the person on this computer, opted in, in single-user mode.
    assertLocalRequest(request);
    assertAcknowledged(request, engineId);
  }
  if (!status?.available) {
    const message = engineId === "claude-api" ? MISSING_KEY_MESSAGE : `${status?.label ?? engineId} is not available: ${status?.reason ?? "unknown reason"}`;
    return json({ error: message, code: "not_configured" }, { status: 503 });
  }
  const workdir = engine.local && body.workdir ? validateWorkdir(body.workdir) : undefined;

  const doc = await service.get(id);
  if (body.clientId && body.selection) {
    service.setPresence(id, { clientId: body.clientId, selection: body.selection, viewport: body.viewport });
  }
  const selection = hub.latestPresence(id)?.selection ?? [];

  const release = claimChatRun(id);
  try {
    const ctx = { service, hub, actor: access.agentActor(ASSISTANT_ACTOR), baseUrl: new URL(request.url).origin };
    return ndjsonResponse(request, async (emit, signal) => {
      try {
        await engine.run({ ctx, doc, history, selection, sessionId: body.sessionId, workdir, emit, signal });
      } catch (error) {
        const message = describeChatError(error, chatModel());
        if (message) emit({ type: "error", message });
        emit({ type: "done" });
      } finally {
        release();
      }
    });
  } catch (error) {
    release();
    throw error;
  }
});
