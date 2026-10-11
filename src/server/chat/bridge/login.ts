import { buildChildEnv } from "./child-env";
import { runChild } from "./child-process";
import { resolveBinary, type CliName, type Machine, type ResolvedBinary } from "./binary";
import { defaultBridgeWorkdir } from "./workdir";

/**
 * What the app may know about a CLI's login: whether it is signed in and how
 * (`claude.ai`, `api_key`, `chatgpt`…). It comes only from the CLI's own
 * status command. The app never opens, reads or copies credential files or
 * tokens, and offers no sign-in.
 */
export interface LoginState {
  installed: boolean;
  loggedIn: boolean;
  authMethod?: string;
  /** For the person: why it cannot be used. */
  problem?: string;
}

const CACHE_MS = 30_000;
const STATUS_TIMEOUT_MS = 15_000;

interface Cached {
  at: number;
  state: LoginState;
}

const globalRef = globalThis as typeof globalThis & { __diagramAiLoginCache?: Map<string, Cached> };
const cache = (): Map<string, Cached> => (globalRef.__diagramAiLoginCache ??= new Map());

async function runStatus(cli: CliName, binary: ResolvedBinary, args: string[]): Promise<{ code: number | null; out: string; spawnError?: string }> {
  let out = "";
  const result = await runChild({
    binary,
    args,
    cwd: defaultBridgeWorkdir(),
    env: buildChildEnv(cli),
    timeoutMs: STATUS_TIMEOUT_MS,
    onLine: (line) => {
      out += `${line}\n`;
    },
  });
  return { code: result.exitCode, out: `${out}${result.stderrTail}`, spawnError: result.spawnError };
}

function parseClaude(out: string, code: number | null): LoginState {
  try {
    const start = out.indexOf("{");
    const value = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1)) as { loggedIn?: unknown; authMethod?: unknown };
    const method = typeof value.authMethod === "string" ? value.authMethod : undefined;
    if (value.loggedIn === true) return { installed: true, loggedIn: true, authMethod: method };
    return { installed: true, loggedIn: false, authMethod: method, problem: "Not signed in. Run `claude` once in a terminal and sign in." };
  } catch {
    return code === 0
      ? { installed: true, loggedIn: true }
      : { installed: true, loggedIn: false, problem: "Not signed in. Run `claude` once in a terminal and sign in." };
  }
}

function parseCodex(out: string, code: number | null): LoginState {
  if (code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out)) {
    return { installed: true, loggedIn: true, authMethod: /api key/i.test(out) ? "api_key" : /chatgpt/i.test(out) ? "chatgpt" : undefined };
  }
  return { installed: true, loggedIn: false, problem: "Not signed in. Run `codex login` in a terminal." };
}

/** Login state of a CLI, cached for 30 seconds. `machine` is only for tests of binary resolution. */
export async function loginState(cli: CliName, machine?: Machine): Promise<LoginState> {
  const key = cli;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.state;

  const binary = resolveBinary(cli, machine);
  let state: LoginState;
  if (!binary) {
    state = { installed: false, loggedIn: false, problem: `${cli === "claude" ? "Claude Code" : "Codex"} was not found. Install it, then reload.` };
  } else {
    const run = await runStatus(cli, binary, cli === "claude" ? ["auth", "status"] : ["login", "status"]);
    if (run.spawnError) {
      state = { installed: false, loggedIn: false, problem: `${cli === "claude" ? "Claude Code" : "Codex"} could not be started.` };
    } else {
      state = cli === "claude" ? parseClaude(run.out, run.code) : parseCodex(run.out, run.code);
    }
  }
  cache().set(key, { at: Date.now(), state });
  return state;
}

export function forgetLoginState(): void {
  cache().clear();
}
