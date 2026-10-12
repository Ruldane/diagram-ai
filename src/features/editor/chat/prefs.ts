import { BRIDGE_TERMS_VERSION } from "@/core/chat-terms";
import type { ChatEngineId } from "@/core/protocol";

/**
 * What this browser remembers about the assistant. Everything is optional and
 * guarded: storage can be blocked or full, and nothing here is a secret.
 */
const ENGINE_KEY = "diagram-ai.assistant.engine";
const ACK_KEY = "diagram-ai.assistant.ack";
const WORKDIR_KEY = "diagram-ai.assistant.workdir";

const ENGINES: readonly ChatEngineId[] = ["claude-code", "claude-api"];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode or quota: the setting simply is not remembered
  }
}

export function preferredEngine(): ChatEngineId | null {
  const value = read(ENGINE_KEY);
  return ENGINES.find((engine) => engine === value) ?? null;
}

export function setPreferredEngine(engine: ChatEngineId): void {
  write(ENGINE_KEY, engine);
}

function acknowledgements(): Partial<Record<ChatEngineId, number>> {
  try {
    const value: unknown = JSON.parse(read(ACK_KEY) ?? "{}");
    return typeof value === "object" && value !== null ? (value as Partial<Record<ChatEngineId, number>>) : {};
  } catch {
    return {};
  }
}

/** The person accepted the current wording of the notice for this engine. */
export function isAcknowledged(engine: ChatEngineId): boolean {
  return acknowledgements()[engine] === BRIDGE_TERMS_VERSION;
}

export function acknowledge(engine: ChatEngineId): void {
  write(ACK_KEY, JSON.stringify({ ...acknowledgements(), [engine]: BRIDGE_TERMS_VERSION }));
}

export function savedWorkdir(): string {
  return read(WORKDIR_KEY) ?? "";
}

export function saveWorkdir(folder: string): void {
  write(WORKDIR_KEY, folder.trim() || null);
}
