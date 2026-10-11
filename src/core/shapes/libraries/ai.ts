import { iconCard, type IconPreset } from "../icon-shapes";
import { body, fontOf, measureBlock, PALETTE, param, type Path, type ShapeDef, type ShapeLibrary } from "../kit";
import { zoneContainer, type ZonePreset } from "./infra";

type Swatch = NonNullable<IconPreset["color"]>;

/* ------------------------------------------------------------------- cards */

/** `[short id, name, subtitle, icon, aliases, description]` */
type Row = [id: string, name: string, subtitle: string, icon: string, aliases: string[], description: string];

const ROLES: { color: Swatch; rows: Row[] }[] = [
  {
    // Agents: things that decide
    color: "purple",
    rows: [
      ["agent", "Agent", "plans and acts", "bot", ["ai-agent", "llm-agent", "autonomous-agent", "assistant", "claude-agent", "react-agent", "worker-agent"], "An autonomous LLM agent that plans, calls tools and acts in a loop."],
      ["subagent", "Subagent", "delegated task", "bot-message-square", ["sub-agent", "child-agent", "specialist-agent", "delegate", "teammate", "task-agent"], "A specialised agent that a parent agent delegates a task to."],
      ["orchestrator", "Orchestrator", "coordinates agents", "network", ["supervisor", "coordinator", "lead-agent", "manager-agent", "multi-agent-orchestrator", "conductor"], "Supervisor that splits work and coordinates several agents."],
      ["router", "Router", "picks the next step", "split", ["intent-router", "classifier", "dispatcher", "model-router", "llm-router", "triage", "handoff"], "Classifies a request and routes it to the right agent, model or branch."],
      ["planner", "Planner", "breaks down the goal", "list-todo", ["task-planner", "plan", "decomposer", "task-decomposition", "todo-list", "reasoning"], "Turns a goal into an ordered plan of steps."],
      ["evaluator", "Evaluator", "scores the output", "gavel", ["judge", "critic", "llm-judge", "llm-as-judge", "grader", "reviewer", "verifier", "reflection"], "LLM judge / critic that grades or verifies an output."],
    ],
  },
  {
    // People
    color: "gray",
    rows: [
      ["human-in-the-loop", "Human in the loop", "reviews and approves", "user-check", ["hitl", "approval", "human-review", "human-approval", "human-feedback", "manual-review", "escalation", "approver"], "A person approves, edits or rejects before the flow continues."],
      ["user", "User", "asks a question", "user", ["human-user", "chat-user", "requester", "operator", "prompter"], "The person who talks to the AI system."],
    ],
  },
  {
    // Models and compute
    color: "blue",
    rows: [
      ["llm", "LLM", "language model", "brain", ["model", "claude", "gpt", "language-model", "large-language-model", "foundation-model", "chat-model", "gemini", "inference", "ai-model", "completion"], "A large language model call (Claude, GPT, Gemini…)."],
      ["embedding-model", "Embedding model", "text to vectors", "binary", ["embeddings", "embedder", "embedding", "encoder", "text-embedding", "vectorizer"], "Model that turns text or images into embedding vectors."],
      ["reranker", "Reranker", "reorders results", "arrow-up-down", ["re-ranker", "rerank", "cross-encoder", "ranking-model", "ranker"], "Model that reorders retrieved results by relevance."],
      ["fine-tuned-model", "Fine-tuned model", "custom weights", "brain-cog", ["fine-tune", "finetuned-model", "fine-tuned", "custom-model", "lora", "adapter", "distilled-model"], "A model fine-tuned or adapted on your own data."],
      ["training-job", "Training job", "fits the model", "graduation-cap", ["training", "fine-tuning-job", "fine-tuning", "model-training", "train", "training-run"], "A training or fine-tuning run that produces model weights."],
      ["gpu", "GPU", "accelerated compute", "cpu", ["gpu-cluster", "accelerator", "inference-server", "model-server", "compute", "tpu", "inference-endpoint", "model-endpoint"], "GPU / accelerator capacity that serves or trains models."],
    ],
  },
  {
    // Prompts and context
    color: "yellow",
    rows: [
      ["prompt", "Prompt", "template with variables", "message-square", ["prompt-template", "template", "instruction", "user-prompt", "few-shot", "instructions"], "A prompt or prompt template sent to a model."],
      ["system-prompt", "System prompt", "role and rules", "scroll-text", ["system-message", "system-instructions", "persona", "agent-instructions", "claude-md"], "System instructions that set the model's role and rules."],
      ["context-window", "Context window", "what the model sees", "frame", ["context", "token-window", "tokens", "context-budget", "working-context", "context-engineering"], "The assembled context the model sees in one call."],
      ["structured-output", "Structured output", "JSON schema", "braces", ["schema", "json-output", "json-schema", "output-schema", "json-mode", "output-parser", "typed-output"], "Model output constrained to a schema (JSON, typed object)."],
    ],
  },
  {
    // Safety
    color: "red",
    rows: [
      ["guardrail", "Guardrail", "checks and blocks", "shield-check", ["safety", "moderation", "filter", "safety-filter", "content-filter", "guardrails", "policy-check", "pii-filter", "input-validation", "output-validation", "jailbreak-detection"], "Safety filter that validates, redacts or blocks inputs and outputs."],
    ],
  },
  {
    // Tools and integrations
    color: "teal",
    rows: [
      ["tool", "Tool", "callable capability", "wrench", ["agent-tool", "tools", "function-tool", "capability", "action-tool", "plugin", "integration"], "A capability the agent can invoke."],
      ["tool-call", "Tool call", "request and result", "plug-zap", ["tool-use", "tool-invocation", "tool-result", "function-calling", "tool-execution"], "One invocation of a tool and the result that comes back."],
      ["mcp-server", "MCP server", "exposes tools", "server-cog", ["mcp", "model-context-protocol", "mcp-tools", "tool-server", "remote-mcp"], "Model Context Protocol server exposing tools, resources and prompts."],
      ["mcp-client", "MCP client", "connects to servers", "plug", ["mcp-host", "mcp-connector", "tool-client", "agent-harness"], "The client / host application that connects to MCP servers."],
      ["api", "API", "external service", "code-xml", ["rest-api", "http-api", "endpoint", "graphql", "api-call", "service-api"], "An external API the system calls."],
      ["function", "Function", "runs your code", "square-function", ["custom-function", "code-function", "python-function", "callable", "local-tool"], "A deterministic function implemented in your own code."],
      ["code-sandbox", "Code sandbox", "executes code safely", "square-terminal", ["code-interpreter", "code-execution", "sandbox", "repl", "python-sandbox", "bash-tool", "shell", "terminal-tool"], "Isolated runtime where the agent executes code or shell commands."],
      ["browser-tool", "Browser", "navigates the web", "mouse-pointer-click", ["browser-use", "computer-use", "web-browser-tool", "headless-browser", "playwright", "web-automation"], "Browser / computer-use tool that clicks, types and reads pages."],
      ["search-tool", "Web search", "finds fresh information", "search", ["web-search", "search-api", "internet-search", "web-fetch", "grounding"], "Web search or fetch tool for up-to-date information."],
      ["skill", "Skill", "packaged know-how", "wand-sparkles", ["agent-skill", "skills", "playbook", "procedure", "slash-command", "capability-pack"], "A packaged set of instructions and scripts the agent loads on demand."],
    ],
  },
  {
    // Memory and knowledge
    color: "green",
    rows: [
      ["memory", "Memory", "remembers across turns", "memory-stick", ["agent-memory", "conversation-memory", "chat-history", "memory-store", "recall"], "What the agent remembers between steps or sessions."],
      ["short-term-memory", "Short-term memory", "scratchpad and state", "notebook-pen", ["scratchpad", "working-memory", "session-state", "conversation-state", "agent-state", "notes", "checkpoint"], "Scratchpad / state kept for the current task or conversation."],
      ["long-term-memory", "Long-term memory", "persists across sessions", "archive", ["persistent-memory", "episodic-memory", "semantic-memory", "user-memory", "memory-bank", "memory-file"], "Facts and preferences persisted across sessions."],
      ["vector-store", "Vector store", "similarity search", "database", ["vector-db", "vector-database", "pinecone", "pgvector", "embeddings-store", "vector-index", "weaviate", "qdrant", "chroma", "milvus", "faiss"], "Database indexing embeddings for similarity search."],
      ["knowledge-base", "Knowledge base", "source documents", "library", ["kb", "corpus", "docs", "knowledge", "wiki", "knowledge-graph", "sources"], "The collection of documents the system can draw on."],
      ["retriever", "Retriever", "fetches relevant context", "file-search", ["rag", "retrieval", "retrieval-augmented-generation", "semantic-search", "hybrid-search", "context-retrieval", "lookup"], "Finds the most relevant chunks for a query (the R in RAG)."],
      ["document", "Document", "file or page", "file-text", ["doc", "pdf", "source-document", "attachment", "uploaded-file", "transcript"], "A single source document, file or page."],
      ["dataset", "Dataset", "examples and labels", "table", ["training-data", "eval-dataset", "examples", "golden-set", "test-set", "benchmark", "jsonl"], "A set of examples used for training or evaluation."],
      ["chunker", "Chunker", "splits documents", "blocks", ["chunking", "text-splitter", "splitter", "document-parser", "parser", "document-ingestion", "preprocessing", "ocr"], "Parses and splits documents into chunks for indexing."],
      ["cache", "Cache", "reuses past results", "database-zap", ["prompt-cache", "prompt-caching", "response-cache", "semantic-cache", "kv-cache"], "Prompt or response cache that avoids repeated model work."],
    ],
  },
  {
    // Flow and control
    color: "orange",
    rows: [
      ["workflow-step", "Step", "one unit of work", "git-commit-horizontal", ["stage", "workflow-node", "chain-step", "action-step", "graph-node", "pipeline-step"], "A deterministic step in a workflow or chain."],
      ["trigger", "Trigger", "starts the run", "zap", ["start-trigger", "entry-point", "invocation", "kickoff", "on-message", "run-start"], "What starts a run: a message, an event or a manual action."],
      ["event", "Event", "something happened", "bell", ["signal", "notification", "message-event", "hook", "callback-event", "lifecycle-hook"], "An event emitted or received during a run."],
      ["schedule", "Schedule", "runs on a timetable", "calendar-clock", ["cron-trigger", "scheduled-run", "timer", "recurring", "routine", "heartbeat"], "A timetable that runs the workflow or agent periodically."],
      ["queue", "Queue", "buffers pending work", "inbox", ["agent-queue", "backlog", "inbox", "batch-queue", "mailbox", "pending-tasks"], "Buffer of pending tasks or messages awaiting an agent."],
      ["webhook", "Webhook", "HTTP callback", "webhook", ["http-trigger", "incoming-webhook", "outgoing-webhook", "webhook-trigger"], "HTTP callback that triggers or is triggered by the workflow."],
      ["output", "Output", "final answer", "flag", ["final-answer", "response", "result", "answer", "completion-output", "deliverable", "report-output"], "The final answer or artefact returned to the user."],
      ["feedback-loop", "Feedback loop", "retry and refine", "repeat", ["retry", "iteration", "refine", "self-correction", "agent-loop", "reflection-loop", "iterate"], "Loop that feeds results back in to retry or refine."],
    ],
  },
  {
    // Evaluation and observability
    color: "pink",
    rows: [
      ["eval-suite", "Eval suite", "measures quality", "flask-conical", ["evals", "eval", "evaluation", "test-suite", "benchmarks", "regression-tests", "offline-eval", "experiment", "ab-test"], "Automated evaluations that measure quality on a dataset."],
      ["trace", "Trace", "logs every step", "activity", ["llm-tracing", "llm-observability", "run-log", "spans", "langsmith", "langfuse", "audit-trail", "transcript-log"], "Trace / log of every model and tool call for debugging and monitoring."],
    ],
  },
];

const cards: ShapeDef[] = ROLES.flatMap(({ color, rows }) =>
  rows.map(([id, name, subtitle, icon, aliases, description]) =>
    iconCard({ id: `ai/${id}`, name, icon, color, aliases, description, text: `${name}\n${subtitle}` }),
  ),
);

/* -------------------------------------------------------------- containers */

const zones: ZonePreset[] = [
  {
    id: "ai/agent-boundary",
    name: "Agent boundary",
    icon: "bot",
    color: "purple",
    size: { w: 460, h: 300 },
    aliases: ["agent-internals", "agent-scope", "agent-group", "agent-system", "agent-box", "harness"],
    description: "Container showing what lives inside one agent: its model, prompt, tools and memory.",
    text: "Agent",
  },
  {
    id: "ai/workflow",
    name: "Workflow",
    icon: "workflow",
    color: "orange",
    dashed: true,
    fill: "none",
    size: { w: 520, h: 280 },
    aliases: ["llm-pipeline", "chain", "graph", "agent-graph", "dag", "flow", "rag-pipeline", "stage-group", "phase"],
    description: "Container grouping the steps of a pipeline, chain or agent graph.",
  },
  {
    id: "ai/environment",
    name: "Environment",
    icon: "square-terminal",
    color: "teal",
    size: { w: 420, h: 260 },
    aliases: ["runtime", "sandbox-environment", "execution-environment", "container-runtime", "workspace", "vm-sandbox", "tool-environment"],
    description: "Container for the sandbox or runtime an agent operates in (files, shell, browser).",
  },
];

/* ------------------------------------------------------------ chat bubbles */

const KAPPA = 0.5522847498;

function bubbleGeometry(w: number, h: number, radius: number): { tail: number; r: number; bottom: number } {
  const tail = Math.min(12, h * 0.22, w * 0.2);
  const bottom = h - tail;
  return { tail, bottom, r: Math.max(0, Math.min(radius, bottom / 2, w / 2)) };
}

/** Rounded bubble whose bottom-left or bottom-right corner extends into a tail. */
function bubblePath(w: number, h: number, radius: number, side: "left" | "right"): Path {
  const { tail, bottom, r } = bubbleGeometry(w, h, radius);
  const k = r * KAPPA;
  // Authored with the tail on the left; mirrored for the right.
  const fx = (x: number): number => (side === "left" ? x : w - x);
  const reach = Math.min(tail * 1.5, w / 2);
  return [
    ["M", fx(r), 0],
    ["L", fx(w - r), 0],
    ["C", fx(w - r + k), 0, fx(w), r - k, fx(w), r],
    ["L", fx(w), bottom - r],
    ["C", fx(w), bottom - r + k, fx(w - r + k), bottom, fx(w - r), bottom],
    ["L", fx(reach), bottom],
    ["L", fx(0), h],
    ["L", fx(0), r],
    ["C", fx(0), r - k, fx(r - k), 0, fx(r), 0],
    ["Z"],
  ];
}

interface BubblePreset {
  id: string;
  name: string;
  color: Swatch;
  side: "left" | "right";
  aliases: string[];
  description: string;
  text: string;
}

function bubble(preset: BubblePreset): ShapeDef {
  const swatch = PALETTE[preset.color];
  const side = (data: Record<string, unknown>): "left" | "right" =>
    param({ data }, "tail", preset.side) === "right" ? "right" : "left";
  return {
    id: preset.id,
    name: preset.name,
    aliases: preset.aliases,
    keywords: ["chat", "conversation", "message", "bubble", "turn"],
    description: preset.description,
    size: { w: 220, h: 70 },
    minSize: { w: 60, h: 40 },
    fit: (ctx) => {
      const size = measureBlock(ctx.text, fontOf(ctx.style), 260);
      return { w: Math.max(120, size.w + 24), h: Math.max(50, size.h + 24 + 12) };
    },
    style: { fill: swatch.fill, stroke: swatch.stroke, textColor: swatch.text, strokeWidth: 1.25, radius: 14, align: "left", fontSize: 13 },
    text: preset.text,
    data: { tail: preset.side },
    label: (ctx) => ({ box: { x: 0, y: 0, w: ctx.w, h: bubbleGeometry(ctx.w, ctx.h, ctx.style.radius).bottom }, padding: 12 }),
    outline: (w, h, style) => bubblePath(w, h, style.radius, preset.side),
    draw: (ctx) => [body(ctx, bubblePath(ctx.w, ctx.h, ctx.style.radius, side(ctx.data)))],
  };
}

const bubbles: ShapeDef[] = [
  bubble({
    id: "ai/user-message",
    name: "User message",
    color: "gray",
    side: "left",
    aliases: ["user-turn", "human-message", "user-bubble", "user-input", "question", "chat-message", "user-query"],
    description: "Chat bubble for what the user says in a conversation flow. data.tail = left | right.",
    text: "What's the status of my order?",
  }),
  bubble({
    id: "ai/assistant-message",
    name: "Assistant message",
    color: "purple",
    side: "right",
    aliases: ["assistant-turn", "ai-message", "assistant-bubble", "bot-message", "model-response", "assistant-reply", "ai-response"],
    description: "Chat bubble for what the assistant replies in a conversation flow. data.tail = left | right.",
    text: "It shipped this morning and arrives on Friday.",
  }),
];

export const aiLibrary: ShapeLibrary = {
  id: "ai",
  name: "AI & agents",
  description:
    "AI system building blocks, colour coded by role (agents purple, models blue, prompts yellow, guardrails red, tools teal, memory and knowledge green, flow orange, evals pink, people gray): agents, models, tools, MCP servers, memory, retrieval, guardrails, plus agent / workflow containers and chat bubbles.",
  shapes: [...cards, ...zones.map(zoneContainer), ...bubbles],
};
