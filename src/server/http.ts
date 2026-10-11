import { ZodError } from "zod";

import { formatIssues } from "@/core/model/schema";
import type { Actor } from "@/core/model/types";

import { HTTP_STATUS, ServiceError } from "./errors";

export const json = (data: unknown, init?: ResponseInit): Response => Response.json(data, init);

/** Maps thrown errors to JSON responses; unexpected ones are logged and hidden. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError) return json({ error: error.message }, { status: HTTP_STATUS[error.code] });
  if (error instanceof ZodError) return json({ error: `Invalid request: ${formatIssues(error)}` }, { status: 400 });
  if (error instanceof SyntaxError) return json({ error: "Request body is not valid JSON." }, { status: 400 });
  console.error("[diagram-ai] Unexpected error:", error);
  return json({ error: "Something went wrong on the server." }, { status: 500 });
}

/** Wraps a route handler with uniform error handling. */
export function route<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Blocks cross-site requests. The app runs on localhost without auth, so any
 * web page the user visits could otherwise call these endpoints (CSRF / DNS
 * rebinding). Requests without an Origin header (CLI agents, curl) are allowed.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host) throw new ServiceError("forbidden", "Cross-origin requests are not allowed.");
}

export function humanActor(clientId: string | null | undefined): Actor {
  return { kind: "human", id: clientId?.slice(0, 80) || "browser", name: "You" };
}

const encoder = new TextEncoder();

/**
 * Server-sent events response. `start` receives a `send` function and returns
 * a cleanup callback that runs when the client disconnects.
 */
export function eventStream(request: Request, start: (send: (event: unknown) => void) => () => void): Response {
  let cleanup: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        cleanup?.();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      cleanup = start((event) => write(`data: ${JSON.stringify(event)}\n\n`));
      // Comment frames keep proxies and the browser from timing the stream out.
      heartbeat = setInterval(() => write(": ping\n\n"), 20_000);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
