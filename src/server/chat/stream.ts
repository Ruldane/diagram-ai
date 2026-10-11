import type { ChatStreamEvent } from "@/core/protocol";

const encoder = new TextEncoder();

/** Blank lines keep idle connections open while the model thinks; clients skip them. */
const HEARTBEAT_MS = 15_000;

/**
 * Streams newline-delimited JSON `ChatStreamEvent`s. `run` gets an `emit`
 * function and a signal that aborts when the browser disconnects, so a closed
 * tab stops the model (and its spend) instead of finishing unseen.
 */
export function ndjsonResponse(request: Request, run: (emit: (event: ChatStreamEvent) => void, signal: AbortSignal) => Promise<void>): Response {
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  let heartbeat: NodeJS.Timeout | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          output.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
          controller.abort();
        }
      };
      heartbeat = setInterval(() => write("\n"), HEARTBEAT_MS);

      run((event) => write(`${JSON.stringify(event)}\n`), controller.signal)
        .catch((error: unknown) => {
          console.error("[diagram-ai] Assistant stream failed:", error instanceof Error ? error.message : "unknown error");
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (closed) return;
          closed = true;
          try {
            output.close();
          } catch {
            // already closed by the client
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
