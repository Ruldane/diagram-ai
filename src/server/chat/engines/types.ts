import type { DiagramDoc, Id } from "@/core/model/types";
import type { ChatEngineId, ChatEngineStatus, ChatStreamEvent } from "@/core/protocol";

import type { ToolContext } from "../../mcp/toolkit";
import type { HistoryMessage } from "../request";

/** Everything an engine needs for one assistant request. */
export interface EngineRun {
  /** Tool context for the in-process engine; CLI engines reach the same tools over MCP instead. */
  ctx: ToolContext;
  /** The diagram the person has open, as it is now. */
  doc: DiagramDoc;
  history: HistoryMessage[];
  selection: Id[];
  /** `session` event of the previous reply from this engine, if any. */
  sessionId?: string;
  /** A validated, existing folder the CLI may read. */
  workdir?: string;
  emit(event: ChatStreamEvent): void;
  signal: AbortSignal;
}

/**
 * Something that answers a chat request by driving the diagram tools and
 * emitting `ChatStreamEvent`s. Every engine ends its stream with `done`,
 * preceded by `error` when something went wrong.
 */
export interface Engine {
  id: ChatEngineId;
  /** Local CLI engines use the person's own login and need opt-in plus a loopback request. */
  local: boolean;
  status(): Promise<ChatEngineStatus>;
  run(input: EngineRun): Promise<void>;
}
