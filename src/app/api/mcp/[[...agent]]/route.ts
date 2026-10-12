import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { assertSameOrigin, errorResponse } from "@/server/http";
import { requestContext } from "@/server/auth/request";
import { identifyAgent } from "@/server/mcp/identity";
import { createMcpServer } from "@/server/mcp/server";

/**
 * MCP endpoint (Streamable HTTP, stateless JSON).
 *
 *   http://localhost:3000/api/mcp            — agent name detected automatically
 *   http://localhost:3000/api/mcp/codex      — or stated explicitly in the URL
 *
 * Each request gets its own server + transport, which keeps callers isolated
 * and means there is no session to lose when the dev server restarts.
 *
 * Accounts on: every request must carry `Authorization: Bearer
 * dai_…`, a personal access token. The tools then see, and may change, only
 * what that account can (see `server/auth/guard.ts`); changes are credited to
 * the agent "on behalf of" the account.
 */
export async function POST(request: Request, { params }: { params: Promise<{ agent?: string[] }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { agent } = await params;
    const body: unknown = await request.json();
    const { service, hub, access } = await requestContext(request, { bearerOnly: true });
    // The hub guard answers synchronously, so what the account can open is looked up once, here.
    if (!access.local) await access.preload();

    const server = createMcpServer({
      service,
      hub,
      actor: access.agentActor(identifyAgent(request, agent?.[0], body)),
      baseUrl: new URL(request.url).origin,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: body });
    void server.close().catch(() => undefined);
    return response;
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 401) response.headers.set("WWW-Authenticate", 'Bearer realm="diagram-ai"');
    return response;
  }
}

const methodNotAllowed = (): Response =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This MCP endpoint is stateless: use POST." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
