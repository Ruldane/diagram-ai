import type { Actor } from "@/core/model/types";

import type { ResolvedBinary } from "../bridge/binary";
import { runChild, DEFAULT_TIMEOUT_MS } from "../bridge/child-process";
import type { BridgeMapper } from "../bridge/sink";
import type { EngineRun } from "./types";

/** Shorter than the hub's "working" window, so the agent pill stays on while the CLI is thinking. */
const PRESENCE_BEAT_MS = 4_000;

/** The run timeout; `DIAGRAM_AI_BRIDGE_TIMEOUT_MS` shortens or extends it. */
export function bridgeTimeoutMs(): number {
  const value = Number(process.env.DIAGRAM_AI_BRIDGE_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1_000 ? value : DEFAULT_TIMEOUT_MS;
}

export interface CliRun {
  input: EngineRun;
  /** How the CLI's work shows up on the canvas while it thinks. */
  actor: Actor;
  binary: ResolvedBinary;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  mapper: BridgeMapper;
}

/**
 * Runs one CLI process for a request: feeds its output through the mapper,
 * keeps the agent shown as working, stops the process on abort, on timeout,
 * or when the mapper says the tools never connected, and always lets the
 * mapper close the event stream.
 */
export async function runCli(run: CliRun): Promise<void> {
  const { input, mapper } = run;
  const stop = new AbortController();
  const forward = () => stop.abort();
  if (input.signal.aborted) stop.abort();
  else input.signal.addEventListener("abort", forward, { once: true });

  const touch = () => input.ctx.hub.touchAgent(run.actor, "thinking", input.doc.id);
  touch();
  const beat = setInterval(touch, PRESENCE_BEAT_MS);

  try {
    const result = await runChild({
      binary: run.binary,
      args: run.args,
      cwd: run.cwd,
      env: run.env,
      stdin: run.stdin,
      signal: stop.signal,
      timeoutMs: bridgeTimeoutMs(),
      onLine: (line) => {
        mapper.handleLine(line);
        if (mapper.fatal) stop.abort();
      },
    });
    mapper.finish({
      exitCode: result.exitCode,
      stderrTail: result.stderrTail,
      aborted: result.aborted || input.signal.aborted,
      timedOut: result.timedOut,
      spawnError: result.spawnError,
    });
  } finally {
    clearInterval(beat);
    input.signal.removeEventListener("abort", forward);
  }
}
