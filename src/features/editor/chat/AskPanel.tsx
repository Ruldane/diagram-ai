"use client";

import { CircleAlert, MessageSquareText, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ChatEngineId } from "@/core/protocol";
import { Button, IconButton } from "@/components/ui/button";

import { clearChat, retryLastMessage, sendChatMessage, stopChat, type SendOptions } from "./actions";
import { AckDialog } from "./AckDialog";
import { Composer } from "./Composer";
import { EnginePicker } from "./EnginePicker";
import { onComposerFocusRequest, takeComposerFocusRequest } from "./focus";
import { formatTokens, totalUsage } from "./history";
import { AssistantMessage, UserMessage } from "./Messages";
import { acknowledge, isAcknowledged, preferredEngine, savedWorkdir, saveWorkdir, setPreferredEngine } from "./prefs";
import { SetupCard } from "./SetupCard";
import { useChatStatus } from "./use-chat-status";
import { useEditor, useEditorStore } from "../store/context";
import type { EditorStore } from "../store/editor-store";

/** Unsent text per editor, so switching side-panel tabs does not lose it. */
const drafts = new WeakMap<EditorStore, string>();

/** Suggestions ending in an ellipsis are starting points to finish; the others send straight away. */
const SUGGESTIONS_BLANK = ["Draw the architecture of …", "Sketch a login flow with error handling", "Create a sequence diagram for …"];
const SUGGESTIONS_FILLED = ["Explain this diagram", "Tidy up this diagram", "Add error handling to the flow", "Find problems or missing pieces"];

const isLocal = (engine: ChatEngineId): boolean => engine !== "claude-api";

function selectionNote(nodes: number, edges: number): string | null {
  const count = nodes + edges;
  if (!count) return null;
  if (!edges) return `Using ${count} selected ${count === 1 ? "shape" : "shapes"}`;
  return `Using ${count} selected ${count === 1 ? "element" : "elements"}`;
}

/** The assistant: type a request, and it edits this diagram with the same tools an MCP agent has. */
export function AskPanel() {
  const store = useEditorStore();
  const messages = useEditor((state) => state.chat.messages);
  const busy = useEditor((state) => state.chat.busy);
  const error = useEditor((state) => state.chat.error);
  const readOnly = useEditor((state) => state.readOnly);
  const blank = useEditor((state) => Object.keys(state.doc!.nodes).length === 0);
  const selectedNodes = useEditor((state) => state.selection.filter((id) => id in state.doc!.nodes).length);
  const selectedEdges = useEditor((state) => state.selection.filter((id) => id in state.doc!.edges).length);
  const { status, failed, checking, refresh } = useChatStatus();

  const [draft, setDraft] = useState(() => drafts.get(store) ?? "");
  const [choice, setChoice] = useState<ChatEngineId | null>(() => preferredEngine());
  const [workdir, setWorkdir] = useState(() => savedWorkdir());
  const [asking, setAsking] = useState<{ engine: "claude-code" | "codex"; prompt: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Follow new text unless the person scrolled up to read. */
  const stuck = useRef(true);

  const engines = status?.engines ?? [];
  const selectedId: ChatEngineId = choice ?? status?.default ?? "claude-api";
  const selected = engines.find((engine) => engine.id === selectedId);
  const noneAvailable = status !== null && status.default === null;
  // If the status could not be fetched, let the person try: the server answers with the real reason.
  const canSend = selected ? selected.available : failed;
  const ready = !noneAvailable && (status !== null || failed);
  const usage = totalUsage(messages);

  const update = (value: string) => {
    setDraft(value);
    drafts.set(store, value);
  };

  const optionsFor = (engine: ChatEngineId): SendOptions => ({ engine, workdir: isLocal(engine) ? workdir : undefined, acknowledged: isLocal(engine) ? isAcknowledged(engine) : undefined });

  const dispatch = (engine: ChatEngineId, prompt: string) => {
    stuck.current = true;
    void sendChatMessage(store, prompt, optionsFor(engine));
    update("");
  };

  const send = (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy || readOnly || !canSend) return;
    if (selectedId !== "claude-api" && !isAcknowledged(selectedId)) {
      setAsking({ engine: selectedId, prompt });
      return;
    }
    dispatch(selectedId, prompt);
  };

  const choose = (engine: ChatEngineId) => {
    setChoice(engine);
    setPreferredEngine(engine);
  };

  // `assistant.open` asks for focus, possibly before this panel existed.
  useEffect(() => {
    if (!ready || readOnly) return;
    const focus = () => {
      if (takeComposerFocusRequest()) inputRef.current?.focus();
    };
    focus();
    return onComposerFocusRequest(focus);
  }, [ready, readOnly]);

  useEffect(() => {
    const element = listRef.current;
    if (element && stuck.current) element.scrollTop = element.scrollHeight;
  }, [messages, error, noneAvailable]);

  const chooseSuggestion = (text: string) => {
    if (text.endsWith("…")) {
      update(text.slice(0, -1));
      inputRef.current?.focus();
    } else {
      send(text);
    }
  };

  const suggestions = blank ? SUGGESTIONS_BLANK : SUGGESTIONS_FILLED;
  const placeholder = readOnly
    ? "View-only access: the assistant cannot edit"
    : !canSend
      ? "Choose an available engine above"
      : blank
        ? "Describe a diagram to draw…"
        : "Ask for a change…";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <h2 className="text-[12.5px] font-semibold text-ink">Assistant</h2>
        {selected?.available && selected.model ? <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-4">{selected.model}</span> : <span className="flex-1" />}
        <IconButton size="sm" label="Clear conversation" disabled={messages.length === 0 && !busy} onClick={() => clearChat(store)}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </header>

      {engines.length ? (
        <EnginePicker
          engines={engines}
          selected={selectedId}
          onSelect={choose}
          workdir={workdir}
          onWorkdirChange={(value) => {
            setWorkdir(value);
            saveWorkdir(value);
          }}
          disabled={busy}
        />
      ) : null}

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation with the assistant"
        onScroll={(event) => {
          const element = event.currentTarget;
          stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
        {noneAvailable ? <SetupCard checking={checking} onCheck={refresh} onConnectAgent={() => store.setState({ dialog: "agent" })} /> : null}

        {!noneAvailable && messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-1 py-6 text-center">
            <div>
              <MessageSquareText className="mx-auto mb-2 size-5 text-ink-3" />
              <p className="font-display text-[18px] text-ink-2">Ask for a change</p>
              <p className="mx-auto mt-1.5 max-w-[240px] text-[12px] leading-relaxed text-ink-3">
                Describe what you want and watch it appear on the canvas. Select shapes first to point at them.
              </p>
            </div>
            {ready && canSend && !readOnly ? (
              <div className="flex flex-wrap justify-center gap-1.5">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => chooseSuggestion(suggestion)}
                    className="rounded-full border border-line-strong bg-raised px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage key={message.id} message={message} live={busy && index === messages.length - 1} />
          ),
        )}
      </div>

      {error ? (
        <div role="alert" className="mx-2.5 mb-2 flex shrink-0 items-start gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-[12px] leading-snug text-danger">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          {messages.some((message) => message.role === "user") && !busy ? (
            <Button size="sm" variant="ghost" className="h-6 shrink-0 px-1.5 text-danger hover:text-danger" onClick={() => retryLastMessage(store, optionsFor(selectedId))}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      {usage ? (
        <p className="shrink-0 px-3 pb-1.5 text-[11px] text-ink-4" title="Tokens used in this conversation. They count against whatever the selected engine is billed to.">
          {formatTokens(usage.inputTokens)} in{usage.cachedTokens ? ` (${formatTokens(usage.cachedTokens)} cached)` : ""} · {formatTokens(usage.outputTokens)} out tokens
        </p>
      ) : null}

      {ready ? (
        <Composer
          value={draft}
          onChange={update}
          onSend={() => send(draft)}
          onStop={() => stopChat(store)}
          busy={busy}
          disabled={readOnly || !canSend}
          placeholder={placeholder}
          selectionNote={selectionNote(selectedNodes, selectedEdges)}
          inputRef={inputRef}
        />
      ) : null}

      <AckDialog
        engine={asking?.engine ?? null}
        onCancel={() => setAsking(null)}
        onAccept={() => {
          if (!asking) return;
          acknowledge(asking.engine);
          const { engine, prompt } = asking;
          setAsking(null);
          dispatch(engine, prompt);
        }}
      />
    </div>
  );
}
