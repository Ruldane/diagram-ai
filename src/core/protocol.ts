import type { DiagramAccess, DiagramViewer } from "./auth";
import type { Actor, DiagramDoc, DiagramSummary, Id, Patch } from "./model/types";

/**
 * Wire protocol shared by the server (REST, server-sent events, MCP) and the
 * browser client.
 */

export type ActivityAction =
  | "create"
  | "read"
  | "add"
  | "update"
  | "delete"
  | "layout"
  | "comment"
  | "preview"
  | "export"
  | "snapshot"
  | "restore"
  | "import"
  | "highlight";

/** One line of the "what did the agent do" feed. */
export interface ActivityEntry {
  id: Id;
  at: string;
  actor: Actor;
  action: ActivityAction;
  summary: string;
  /** Elements touched, so the UI can jump to them. */
  ids?: Id[];
}

export interface AgentInfo {
  id: string;
  name: string;
  status: "working" | "idle";
  lastSeen: string;
  /** Diagram the agent last touched. */
  diagramId?: Id;
  /** Tool currently (or last) being run, for the status line. */
  tool?: string;
  /** Accounts on: the account the agent acts for. */
  ownerId?: string;
}

/** How the browser should present a remote patch. */
export type PatchAnimation = "draw" | "layout" | "none";

/**
 * Pending review of agent changes. The server keeps a baseline copy of the
 * diagram (the last state a person accepted); the editor diffs it against the
 * live document to show what agents changed since.
 */
export interface ReviewInfo {
  /** A baseline exists, so there may be changes to review. */
  active: boolean;
  /** Agent whose first change created the baseline. */
  by?: Actor;
  /** When the baseline was taken. */
  since?: string;
}

/** Another person looking at the same diagram. */
export interface PeerInfo {
  /** Stable per browser tab. */
  id: string;
  name: string;
  /** Accounts on: the account behind the tab, so several tabs of one person can share an avatar. */
  userId?: string;
  /** CSS colour assigned by the server. */
  color: string;
  /** Pointer position in world coordinates, when known. */
  cursor?: { x: number; y: number };
  selection: Id[];
  at: string;
}

export type DiagramEvent =
  | { type: "hello"; version: number; agents: AgentInfo[]; activity: ActivityEntry[]; review?: ReviewInfo; peers?: PeerInfo[] }
  /** The review baseline changed (an agent started editing, or changes were accepted). */
  | { type: "review"; review: ReviewInfo }
  | { type: "peer"; peer: PeerInfo }
  | { type: "peer-left"; id: string }
  | { type: "patch"; patch: Patch; version: number; actor: Actor; origin?: string; animate: PatchAnimation }
  | { type: "activity"; entry: ActivityEntry }
  | { type: "agent"; agent: AgentInfo }
  | { type: "highlight"; ids: Id[]; message?: string; actor: Actor }
  /** The whole document was replaced (snapshot restore): refetch it. */
  | { type: "reset"; version: number }
  | { type: "deleted" };

export type WorkspaceEvent =
  | { type: "hello"; agents: AgentInfo[] }
  | { type: "diagrams" }
  | { type: "agent"; agent: AgentInfo };

/** What a browser tab reports about its human, for agents to act on "this" / "the selection". */
export interface ClientPresence {
  clientId: string;
  selection: Id[];
  viewport?: { x: number; y: number; w: number; h: number };
  at: string;
}

export interface SnapshotInfo {
  id: Id;
  name: string;
  createdAt: string;
  author: Actor;
  nodeCount: number;
  edgeCount: number;
}

/* ------------------------------------------------------------ REST shapes */

export interface ListDiagramsResponse {
  diagrams: DiagramSummary[];
  /** Accounts on: the caller's role on each diagram, and whose it is. Absent in solo mode. */
  access?: Record<Id, DiagramAccess>;
}

export interface CreateDiagramRequest {
  name?: string;
  type?: string;
  description?: string;
  /** Start from the type's example content. */
  template?: boolean;
}

export interface DiagramResponse {
  diagram: DiagramDoc;
  /** The caller's role on this diagram (accounts on), so the editor can be read-only for viewers. */
  viewer?: DiagramViewer;
}

export interface OpsRequest {
  clientId: string;
  patch: Patch;
}

export interface OpsResponse {
  version: number;
}

export interface ApiError {
  error: string;
}

/* -------------------------------------------------------------- agent chat */

export interface ChatToolCall {
  /** Id of the model's tool call; stable across its "running" and "done" events. */
  id?: string;
  name: string;
  status: "running" | "done" | "error";
  /** One line describing what the call did or why it failed. */
  summary?: string;
  /** Longer result text for the expanded view (truncated). */
  detail?: string;
  /** Length of the message text when the call started, so tool rows can sit between paragraphs. */
  at?: number;
}

export interface ChatUsage {
  /** Prompt tokens including those served from the prompt cache. */
  inputTokens: number;
  outputTokens: number;
  /** The part of `inputTokens` read from the prompt cache (billed at a fraction). */
  cachedTokens?: number;
}

export interface ChatMessage {
  id: Id;
  role: "user" | "assistant";
  text: string;
  tools?: ChatToolCall[];
  createdAt: string;
  /** Tokens this reply used (assistant messages). */
  usage?: ChatUsage;
  /** The person stopped the reply before it finished. */
  stopped?: boolean;
  /** What the engine said about its connection to the diagram tools. */
  diagnostic?: { ok: boolean; message: string };
}

/** Events streamed to the browser while the in-app assistant works on a request. */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; status: ChatToolCall["status"]; summary?: string; detail?: string }
  | ({ type: "usage" } & ChatUsage)
  | { type: "error"; message: string }
  /** Conversation id of a local CLI engine; send it back as `sessionId` so the next message resumes. */
  | { type: "session"; id: string }
  /** One line about the connection to the engine (for example whether it reached the app's tools). */
  | { type: "diagnostic"; ok: boolean; message: string }
  | { type: "done" };

/**
 * Where the assistant's model runs. `claude-code` drives the person's own
 * locally installed Claude Code CLI; `claude-api` calls the API with a key.
 */
export type ChatEngineId = "claude-code" | "claude-api";

/** Engines that run a program on this computer with the person's own login (they need an acknowledgement). */
export type LocalChatEngineId = Exclude<ChatEngineId, "claude-api">;

export interface ChatEngineStatus {
  id: ChatEngineId;
  label: string;
  available: boolean;
  /** Why it is unavailable, or a note about how it will be billed. Safe to show. */
  reason?: string;
  /** What a request is charged against. */
  billing: "subscription" | "api";
  /** The first use needs the person's explicit opt-in (see `core/chat-terms.ts`). */
  needsAcknowledgement: boolean;
  /** How the CLI is logged in (`claude.ai`, `api_key`…), never a credential. */
  authMethod?: string;
  /** Model in use, when the app decides it. */
  model?: string;
}

/** `GET /api/chat/status`. Never includes a key or token. */
export interface ChatStatusResponse {
  engines: ChatEngineStatus[];
  /** Preferred engine among the available ones: claude-code, then claude-api. `null` when none is. */
  default: ChatEngineId | null;
}

export interface ChatRequest {
  /** The conversation so far, oldest first, ending with the new user message. */
  messages: { role: "user" | "assistant"; text: string }[];
  clientId?: string;
  /**
   * What the person has selected and is looking at right now. Presence is only
   * posted when it changes and expires on the server, so the request carries it.
   */
  selection?: Id[];
  viewport?: { x: number; y: number; w: number; h: number };
  /** Defaults to the server's preferred available engine. */
  engine?: ChatEngineId;
  /** Local CLI engines: the `session` event of the previous reply. */
  sessionId?: string;
  /** Local CLI engines: a folder the assistant may read (never written). */
  workdir?: string;
}

export const EXPORT_FORMATS = ["svg", "png", "pdf", "pptx", "drawio", "mermaid", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  drawio: "application/xml",
  mermaid: "text/plain",
  json: "application/json",
};

export const EXPORT_EXTENSION: Record<ExportFormat, string> = {
  svg: "svg",
  png: "png",
  pdf: "pdf",
  pptx: "pptx",
  drawio: "drawio",
  mermaid: "mmd",
  json: "json",
};
