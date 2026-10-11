import { randomId } from "@/core/model/ids";
import { BRIDGE_ACK_HEADER, bridgeAck } from "@/core/chat-terms";
import type { ChatEngineId, ChatMessage, ChatRequest, ChatStreamEvent } from "@/core/protocol";

import type { ChatState, EditorStore } from "../store/editor-store";
import { MAX_PROMPT_CHARS, toRequestMessages } from "./history";
import { applyChatEvent, createEventParser } from "./stream";

/** The request in flight per editor, so it survives the Ask panel being unmounted. */
const inFlight = new WeakMap<EditorStore, AbortController>();

/** Conversation id of each local CLI engine, so the next message resumes its session. */
const sessions = new WeakMap<EditorStore, Partial<Record<ChatEngineId, string>>>();

export interface SendOptions {
  engine: ChatEngineId;
  /** Local CLI engines: folder the assistant may read. */
  workdir?: string;
  /** The person has accepted the notice for this engine; sent as a header the server checks. */
  acknowledged?: boolean;
}

function applyEvents(chat: ChatState, replyId: string, events: ChatStreamEvent[]): ChatState {
  let next = chat;
  for (const event of events) {
    if (event.type === "error") next = { ...next, error: event.message };
    else next = { ...next, messages: next.messages.map((message) => (message.id === replyId ? applyChatEvent(message, event) : message)) };
  }
  return next;
}

async function errorFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  return `The assistant could not be reached (status ${response.status}).`;
}

/**
 * Sends a prompt and streams the reply into `store.chat`. The server edits the
 * diagram through the same tools MCP agents use, so the canvas updates by
 * itself; this only maintains the transcript.
 */
export async function sendChatMessage(store: EditorStore, text: string, options: SendOptions): Promise<void> {
  const { chat, readOnly, doc, diagramId, clientId, selection, viewport, canvasSize } = store.getState();
  const prompt = text.trim().slice(0, MAX_PROMPT_CHARS);
  if (!prompt || chat.busy || readOnly || !doc) return;

  const now = new Date().toISOString();
  const user: ChatMessage = { id: randomId("m"), role: "user", text: prompt, createdAt: now };
  const reply: ChatMessage = { id: randomId("m"), role: "assistant", text: "", tools: [], createdAt: now };
  const local = options.engine !== "claude-api";
  const request: ChatRequest = {
    messages: toRequestMessages([...chat.messages, user]),
    clientId,
    // Presence on the server expires when idle; the request says what is selected right now.
    selection: selection.filter((id) => id in doc.nodes || id in doc.edges),
    viewport: { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, w: canvasSize.w / viewport.zoom, h: canvasSize.h / viewport.zoom },
    engine: options.engine,
    ...(local ? { sessionId: sessions.get(store)?.[options.engine], workdir: options.workdir?.trim() || undefined } : {}),
  };
  store.setState({ chat: { messages: [...chat.messages, user, reply], busy: true, error: null } });

  const controller = new AbortController();
  inFlight.set(store, controller);

  // Text arrives token by token; applying events once per frame keeps the panel smooth.
  let queue: ChatStreamEvent[] = [];
  let frame: number | null = null;
  const flush = () => {
    frame = null;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    store.setState((state) => ({ chat: applyEvents(state.chat, reply.id, batch) }));
  };
  const push = (event: ChatStreamEvent) => {
    if (event.type === "session") sessions.set(store, { ...sessions.get(store), [options.engine]: event.id });
    queue.push(event);
    if (frame === null) frame = requestAnimationFrame(flush);
  };

  try {
    const response = await fetch(`/api/diagrams/${diagramId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(local && options.acknowledged ? { [BRIDGE_ACK_HEADER]: bridgeAck(options.engine) } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      push({ type: "error", message: await errorFrom(response) });
    } else {
      let finished = false;
      const parser = createEventParser((event) => {
        if (event.type === "done") finished = true;
        push(event);
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.end();
      if (!finished) push({ type: "error", message: "The connection to the assistant was interrupted. Check that the app is still running." });
    }
  } catch {
    if (!controller.signal.aborted) push({ type: "error", message: "Could not reach the assistant. Check that the app is still running." });
  } finally {
    if (frame !== null) cancelAnimationFrame(frame);
    flush();
    inFlight.delete(store);
    const stopped = controller.signal.aborted;
    store.setState((state) => ({
      chat: {
        ...state.chat,
        busy: false,
        // A reply that produced nothing (an immediate error) leaves no empty bubble behind.
        messages: state.chat.messages.flatMap((message) => {
          if (message.id !== reply.id) return [message];
          if (!message.text && !message.tools?.length && !stopped) return [];
          return [stopped ? { ...message, stopped: true } : message];
        }),
      },
    }));
  }
}

/** Aborts the running request: the server stops the model (or the CLI process) and any tools. */
export function stopChat(store: EditorStore): void {
  inFlight.get(store)?.abort();
}

export function clearChat(store: EditorStore): void {
  stopChat(store);
  sessions.delete(store);
  store.setState({ chat: { messages: [], busy: false, error: null } });
}

/** Re-sends the last prompt after a failure, dropping the failed reply. */
export function retryLastMessage(store: EditorStore, options: SendOptions): void {
  const { chat } = store.getState();
  if (chat.busy) return;
  const index = chat.messages.findLastIndex((message) => message.role === "user");
  if (index < 0) return;
  const prompt = chat.messages[index].text;
  store.setState({ chat: { ...chat, messages: chat.messages.slice(0, index), error: null } });
  void sendChatMessage(store, prompt, options);
}
