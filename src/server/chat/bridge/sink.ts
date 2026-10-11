import type { ChatStreamEvent, ChatUsage } from "@/core/protocol";

import type { ToolResult } from "../../mcp/registry";
import { summarizeToolCall } from "../summary";

/** How a CLI process ended, as far as the mapper needs to know. */
export interface ProcessEnd {
  exitCode: number | null;
  stderrTail: string;
  aborted: boolean;
  timedOut: boolean;
  spawnError?: string;
}

/** Turns one CLI's output into `ChatStreamEvent`s. */
export interface BridgeMapper {
  handleLine(line: string): void;
  /** The process ended: report anything the transcript did not, then close the event stream. */
  finish(end: ProcessEnd): void;
  /** Set when continuing is pointless (the tools never connected); the runner stops the process. */
  readonly fatal: boolean;
}

/** The last bit of stderr, cleaned for a one-line message. Never contains more than a few hundred characters. */
export function tailMessage(text: string, max = 300): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const joined = lines.slice(-3).join(" ");
  return joined.length > max ? `…${joined.slice(-max)}` : joined;
}

/** `{"a":1}` text as an object, for tools whose result the CLI reports as the structured JSON. */
export function parseStructured(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Shared bookkeeping for the mappers: text paragraphs stay separated, a tool
 * call is announced once, nothing is left "running", and the stream ends with
 * exactly one `done`.
 */
export class EventSink {
  private wrote = false;
  private ended = false;
  private readonly open = new Map<string, string>();
  private readonly inputs = new Map<string, unknown>();

  constructor(readonly emit: (event: ChatStreamEvent) => void) {}

  get finished(): boolean {
    return this.ended;
  }

  /** A streamed fragment of the reply. */
  text(delta: string): void {
    if (!delta || this.ended) return;
    this.wrote = true;
    this.emit({ type: "text", delta });
  }

  /** A new block of text starts: keep it apart from what came before. */
  textBlockStart(): void {
    if (this.wrote && !this.ended) this.emit({ type: "text", delta: "\n\n" });
  }

  /** A whole message at once (no partial deltas were available). */
  paragraph(text: string): void {
    const body = text.trim();
    if (!body) return;
    this.textBlockStart();
    this.text(body);
  }

  toolRunning(id: string, name: string, input?: unknown): void {
    if (input !== undefined) this.inputs.set(id, input);
    if (this.open.has(id) || this.ended) return;
    this.open.set(id, name);
    this.emit({ type: "tool", id, name, status: "running" });
  }

  inputOf(id: string): unknown {
    return this.inputs.get(id);
  }

  toolDone(id: string, name: string, result: ToolResult): void {
    if (this.ended) return;
    const outcome = summarizeToolCall(name, this.inputs.get(id) ?? {}, result);
    this.open.delete(id);
    this.emit({ type: "tool", id, name, status: outcome.status, summary: outcome.summary, detail: outcome.detail });
  }

  /** A tool the CLI ran without going through the app's tools (read a file, ran a command). */
  toolDoneWith(id: string, name: string, status: "done" | "error", summary: string, detail?: string): void {
    if (this.ended) return;
    this.open.delete(id);
    this.emit({ type: "tool", id, name, status, summary, ...(detail ? { detail } : {}) });
  }

  usage(usage: ChatUsage): void {
    if (this.ended || !(usage.inputTokens || usage.outputTokens)) return;
    this.emit({ type: "usage", ...usage });
  }

  /** Ends the stream. Calls still shown as running are closed out; an error message goes first. */
  end(error?: string): void {
    if (this.ended) return;
    for (const [id, name] of this.open) this.emit({ type: "tool", id, name, status: "error", summary: "Not run" });
    this.open.clear();
    if (error) this.emit({ type: "error", message: error });
    this.ended = true;
    this.emit({ type: "done" });
  }
}

/** The message for a process that ended without a final result line. Exit codes alone are not trusted. */
export function endedWithoutResult(label: string, end: ProcessEnd): string | undefined {
  if (end.aborted) return undefined;
  if (end.timedOut) return `${label} took too long and was stopped. Try a smaller request.`;
  if (end.spawnError) return `${label} could not be started (${tailMessage(end.spawnError, 160)}). Check that it is installed and runnable.`;
  const detail = tailMessage(end.stderrTail);
  return `${label} ended without an answer${end.exitCode ? ` (exit code ${end.exitCode})` : ""}${detail ? `: ${detail}` : "."}`;
}
