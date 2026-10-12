import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

import type { ResolvedBinary } from "./binary";

/** Turns a byte stream into lines: UTF-8, partial lines buffered, `\r\n` and a leading BOM handled, blanks skipped. */
export class LineSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private first = true;

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: Buffer | string): void {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      this.emit(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
    }
  }

  /** Flushes a final line that had no trailing newline. */
  end(): void {
    this.buffer += this.decoder.end();
    if (this.buffer) this.emit(this.buffer);
    this.buffer = "";
  }

  private emit(raw: string): void {
    let line = raw;
    if (this.first) {
      line = line.replace(/^﻿/, "");
      this.first = false;
    }
    line = line.replace(/\r$/, "");
    if (line.trim()) this.onLine(line);
  }
}

export interface ChildSpec {
  binary: ResolvedBinary;
  /** Passed as an argument array. Through a shell (npm `.cmd` shims) every entry must be plain text, see `quoteForCmd`. */
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /** Written to stdin, which is then closed. Prompts go here, never in argv. */
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?: (line: string) => void;
}

export interface ChildResult {
  exitCode: number | null;
  /** Last few KB of stderr, for error messages. */
  stderrTail: string;
  timedOut: boolean;
  aborted: boolean;
  /** The process could not be started at all. */
  spawnError?: string;
}

const STDERR_TAIL = 4096;
const KILL_GRACE_MS = 3000;
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Characters that are safe in a `cmd.exe` command line without any escaping. */
const PLAIN = /^[A-Za-z0-9_.:\\/=,+@-]+$/;
/**
 * Inside double quotes cmd.exe treats these literally. Letters of any script
 * are allowed because a profile folder is often named after the person
 * ("C:\Users\José\AppData"); `%` (variable expansion), `"`, `^`, `!`, `&|<>`
 * and line breaks stay refused.
 */
const QUOTABLE = /^[\p{L}\p{N}_.:\\/=,+@*()[\]#~' -]*$/u;

/**
 * Quotes one argument for `cmd.exe`. Only arguments built from a conservative
 * character set are accepted; anything else throws rather than being escaped,
 * because cmd.exe quoting rules are not something to improvise.
 */
export function quoteForCmd(arg: string): string {
  if (arg !== "" && PLAIN.test(arg)) return arg;
  if (QUOTABLE.test(arg)) return `"${arg}"`;
  throw new Error("An argument contains characters that cannot be passed safely through a shell.");
}

const live = new Set<ChildProcess>();

function killTreeSync(child: ChildProcess, force: boolean): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    }
  } catch {
    // already gone
  }
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    // Without a shell this is the whole tree: cmd.exe shims, node, and whatever they started.
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.on("error", () => undefined);
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) killTreeSync(child, true);
  }, KILL_GRACE_MS).unref();
}

const globalRef = globalThis as typeof globalThis & { __diagramAiBridgeExitHook?: boolean };

/** Children never outlive the server. */
function ensureExitHook(): void {
  if (globalRef.__diagramAiBridgeExitHook) return;
  globalRef.__diagramAiBridgeExitHook = true;
  process.once("exit", () => {
    for (const child of live) killTreeSync(child, true);
  });
}

/** Number of CLI processes currently running, for tests and diagnostics. */
export const runningChildren = (): number => live.size;

/**
 * Runs a CLI to completion, streaming stdout lines to `onLine`. Never uses a
 * shell for a real executable. On abort or timeout the whole process tree is
 * killed. Resolves (never rejects) with how it ended.
 */
export function runChild(spec: ChildSpec): Promise<ChildResult> {
  ensureExitHook();
  const win = process.platform === "win32";
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ChildResult>((resolve) => {
    if (spec.signal?.aborted) return resolve({ exitCode: null, stderrTail: "", timedOut: false, aborted: true });

    let child: ChildProcess;
    try {
      const options = { cwd: spec.cwd, env: spec.env as NodeJS.ProcessEnv, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"] };
      if (spec.binary.kind === "shim") {
        const line = [spec.binary.path, ...spec.args].map(quoteForCmd).join(" ");
        child = spawn(line, [], { ...options, shell: true });
      } else {
        child = spawn(spec.binary.path, spec.args, { ...options, shell: false, detached: !win });
      }
    } catch (error) {
      return resolve({ exitCode: null, stderrTail: "", timedOut: false, aborted: false, spawnError: error instanceof Error ? error.message : "could not start the program" });
    }

    live.add(child);
    let stderrTail = "";
    let timedOut = false;
    let aborted = false;
    let spawnError: string | undefined;
    let settled = false;

    const lines = new LineSplitter((line) => spec.onLine?.(line));
    child.stdout?.on("data", (chunk: Buffer) => lines.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL);
    });

    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    spec.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      live.delete(child);
      lines.end();
      resolve({ exitCode, stderrTail, timedOut, aborted, spawnError });
    };

    child.on("error", (error) => {
      spawnError = error.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));

    // The prompt goes to stdin. A program that exits early closes the pipe: that is not our error.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(spec.stdin ?? "");
  });
}
