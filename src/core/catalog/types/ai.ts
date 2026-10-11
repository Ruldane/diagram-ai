import { PALETTE } from "../../model/palette";
import type { EdgeSpec, NodeSpec } from "../../spec/apply";
import { FREEFORM, label, layered, MUTED_TEXT } from "../presets";
import type { DiagramTypeDef } from "../types";

/* ------------------------------------------------------------ card stacks */

const STACK = { w: 230, cardX: 20, firstY: 52, step: 96, cardH: 60 };
const stackY = (row: number): number => STACK.firstY + row * STACK.step;

/** A workflow container at `x` with its steps stacked inside, top to bottom. */
function cardStack(id: string, title: string, x: number, steps: { id: string; shape: string; text: string }[]): NodeSpec[] {
  return [
    { id, shape: "ai/workflow", text: title, x, y: 0, w: STACK.w, h: stackY(steps.length - 1) + STACK.cardH + 24 },
    ...steps.map((step, row) => ({ ...step, parent: id, x: x + STACK.cardX, y: stackY(row) })),
  ];
}

/* --------------------------------------------------------- neural network */

const NEURON = { size: 44, gap: 26, columnGap: 170, top: 56 };
const LAYERS: { id: string; caption: string; color: string; neurons: string[] }[] = [
  { id: "in", caption: "Input layer\ncustomer features", color: "blue", neurons: ["x1", "x2", "x3"] },
  { id: "h1", caption: "Hidden layer 1\n4 neurons, ReLU", color: "purple", neurons: ["", "", "", ""] },
  { id: "h2", caption: "Hidden layer 2\n4 neurons, ReLU", color: "purple", neurons: ["", "", "", ""] },
  { id: "out", caption: "Output layer\nstay or churn", color: "green", neurons: ["y1", "y2"] },
];
const TALLEST = Math.max(...LAYERS.map((layer) => layer.neurons.length));
const columnHeight = (count: number): number => count * NEURON.size + (count - 1) * NEURON.gap;

const neuralNodes: NodeSpec[] = LAYERS.flatMap((layer, column) => {
  const x = column * NEURON.columnGap;
  const top = NEURON.top + (columnHeight(TALLEST) - columnHeight(layer.neurons.length)) / 2;
  return [
    label(`${layer.id}-caption`, layer.caption, { x: x - 58, y: 0, w: 160, h: 40 }, MUTED_TEXT),
    ...layer.neurons.map((text, row) => ({
      id: `${layer.id}-${row + 1}`,
      shape: "basic/circle",
      text,
      x,
      y: top + row * (NEURON.size + NEURON.gap),
      w: NEURON.size,
      h: NEURON.size,
      color: layer.color,
      style: { fontSize: 11 },
    })),
  ];
});

/** Every neuron feeds every neuron of the next layer. */
const neuralEdges: EdgeSpec[] = LAYERS.slice(0, -1).flatMap((layer, column) =>
  layer.neurons.flatMap((_, from) =>
    LAYERS[column + 1].neurons.map((__, to) => ({
      from: `${layer.id}-${from + 1}`,
      to: `${LAYERS[column + 1].id}-${to + 1}`,
      kind: "line",
      style: { stroke: "#adb5bd", strokeWidth: 1 },
    })),
  ),
);

/* ------------------------------------------------------------------- chat */

const CHAT_W = 560;

function chatBubble(id: string, who: "user" | "assistant", text: string, y: number, w: number, h: number): NodeSpec {
  return {
    id,
    shape: who === "user" ? "ai/user-message" : "ai/assistant-message",
    text,
    x: who === "user" ? 0 : CHAT_W - w,
    y,
    w,
    h,
  };
}

/* ------------------------------------------------------------------ types */

export const AI_TYPES: DiagramTypeDef[] = [
  {
    id: "agent-architecture",
    name: "Agent architecture",
    category: "ai",
    description: "The anatomy of a single AI agent: its model, instructions, memory and the tools it can call on behalf of a user.",
    keywords: ["ai agent", "llm agent", "agent design", "agent loop", "tools", "memory", "react agent", "assistant", "harness"],
    libraries: ["ai", "basic"],
    defaultShape: "ai/agent",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 40, 56),
    agentGuide:
      "Draw an ai/agent-boundary container holding the ai/agent loop, its ai/llm, ai/system-prompt, ai/memory and one card per tool (ai/tool, ai/search-tool, ai/code-sandbox, ai/mcp-server…); keep the ai/user and the external systems the tools reach (ai/api, ai/knowledge-base) outside. Card text is 'Title\\nsubtitle'. Use flow edges for calls and the bidirectional kind where data goes both ways (agent ↔ model, agent ↔ memory).",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "user", shape: "ai/user", text: "Customer\nasks about an order" },
        { id: "agent", shape: "ai/agent-boundary", text: "Support agent" },
        { id: "loop", shape: "ai/agent", text: "Agent loop\nplan, act, observe", parent: "agent" },
        { id: "instructions", shape: "ai/system-prompt", text: "System prompt\nrole, tone and rules", parent: "agent" },
        { id: "model", shape: "ai/llm", text: "LLM\nreasons, picks tools", parent: "agent" },
        { id: "memory", shape: "ai/memory", text: "Memory\nchat history, notes", parent: "agent" },
        { id: "order-tool", shape: "ai/tool", text: "Order lookup\nread-only tool", parent: "agent" },
        { id: "search-tool", shape: "ai/search-tool", text: "Help search\nfinds policy articles", parent: "agent" },
        { id: "orders-api", shape: "ai/api", text: "Orders API\nshop back end" },
        { id: "help-centre", shape: "ai/knowledge-base", text: "Help centre\npolicies and guides" },
      ],
      edges: [
        { from: "user", to: "loop", kind: "bidirectional" },
        { from: "instructions", to: "model" },
        { from: "loop", to: "model", kind: "bidirectional" },
        { from: "loop", to: "memory", kind: "bidirectional" },
        { from: "loop", to: "order-tool" },
        { from: "loop", to: "search-tool" },
        { from: "order-tool", to: "orders-api" },
        { from: "search-tool", to: "help-centre" },
      ],
    },
  },
  {
    id: "multi-agent-system",
    name: "Multi-agent system",
    category: "ai",
    description: "Several specialised agents working on one goal: who coordinates, who does what, and what they share.",
    keywords: ["multi-agent", "orchestrator", "subagents", "supervisor", "swarm", "agent team", "delegation", "handoff", "crew"],
    libraries: ["ai", "basic"],
    defaultShape: "ai/subagent",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 40, 60),
    agentGuide:
      "Put one ai/orchestrator (or ai/router for simple handoffs) above the ai/subagent cards it delegates to, with the ai/user on top; give each subagent the tools it owns (ai/search-tool, ai/code-sandbox, ai/eval-suite…) and show shared state as ai/short-term-memory. Delegation uses flow edges from the orchestrator down, shared reads and writes use the dotted kind, and feedback between agents uses dashed.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "user", shape: "ai/user", text: "Developer\nasks for a feature" },
        { id: "lead", shape: "ai/orchestrator", text: "Lead agent\nplans and delegates" },
        { id: "researcher", shape: "ai/subagent", text: "Researcher\nreads code and docs" },
        { id: "coder", shape: "ai/subagent", text: "Coder\nwrites the change" },
        { id: "reviewer", shape: "ai/subagent", text: "Reviewer\nchecks the result" },
        { id: "search", shape: "ai/search-tool", text: "Code search\nfinds references" },
        { id: "sandbox", shape: "ai/code-sandbox", text: "Sandbox\nruns the tests" },
        { id: "board", shape: "ai/short-term-memory", text: "Task board\nplan, status, findings" },
      ],
      edges: [
        { from: "user", to: "lead", kind: "bidirectional" },
        { from: "lead", to: "researcher" },
        { from: "lead", to: "coder" },
        { from: "lead", to: "reviewer" },
        { from: "researcher", to: "search" },
        { from: "coder", to: "sandbox" },
        { from: "reviewer", to: "board", kind: "dotted" },
        { from: "coder", to: "board", kind: "dotted" },
        { from: "researcher", to: "board", kind: "dotted" },
      ],
    },
  },
  {
    id: "rag-pipeline",
    name: "RAG pipeline",
    category: "ai",
    description: "Retrieval-augmented generation: how documents are indexed and how a question is answered from the retrieved passages.",
    keywords: ["rag", "retrieval augmented generation", "vector search", "embeddings", "knowledge base", "semantic search", "chunking", "grounding"],
    libraries: ["ai", "basic"],
    defaultShape: "ai/workflow-step",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 48, 44),
    agentGuide:
      "Use two ai/workflow containers: indexing (ai/knowledge-base or ai/document → ai/chunker → ai/embedding-model) and answering (ai/user → ai/retriever → ai/reranker → ai/llm → ai/output), with the ai/vector-store between them. Connect the steps with flow edges, and link the ai/retriever to the ai/vector-store it searches with the dashed kind; add ai/guardrail or ai/cache cards where they apply.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        ...cardStack("indexing", "Indexing (offline)", 0, [
          { id: "articles", shape: "ai/knowledge-base", text: "Help centre\n1,200 articles" },
          { id: "chunker", shape: "ai/chunker", text: "Chunker\n500-token passages" },
          { id: "embedder", shape: "ai/embedding-model", text: "Embedding model\npassages to vectors" },
        ]),
        { id: "index", shape: "ai/vector-store", text: "Vector store\nsimilarity search", x: 290, y: stackY(1) },
        ...cardStack("answering", "Answering (online)", 540, [
          { id: "user", shape: "ai/user", text: "User\nasks a question" },
          { id: "retriever", shape: "ai/retriever", text: "Retriever\ntop 20 passages" },
          { id: "reranker", shape: "ai/reranker", text: "Reranker\nkeeps the best 5" },
          { id: "model", shape: "ai/llm", text: "LLM\nwrites the answer" },
          { id: "answer", shape: "ai/output", text: "Answer\nwith cited sources" },
        ]),
      ],
      edges: [
        { from: "articles", to: "chunker" },
        { from: "chunker", to: "embedder" },
        { from: "embedder", to: "index", fromAnchor: "right", toAnchor: "bottom" },
        { from: "user", to: "retriever" },
        { from: "retriever", to: "index", text: "search", kind: "dashed", fromAnchor: "left", toAnchor: "right" },
        { from: "retriever", to: "reranker" },
        { from: "reranker", to: "model" },
        { from: "model", to: "answer" },
      ],
    },
  },
  {
    id: "llm-chain",
    name: "LLM chain",
    category: "ai",
    description: "A fixed sequence of prompts, model calls and checks (a prompt flow), where each step works on the output of the previous one.",
    keywords: ["llm chain", "prompt flow", "prompt chaining", "pipeline", "workflow", "langchain", "routing", "structured output", "guardrails"],
    libraries: ["ai", "basic"],
    defaultShape: "ai/workflow-step",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 40, 44),
    agentGuide:
      "Chain the steps top to bottom with flow edges: ai/trigger for the input, ai/prompt feeding each ai/llm call, ai/guardrail for input / output checks, ai/structured-output for parsed results, ai/router where the chain branches (label the branches) and ai/output or ai/human-in-the-loop at the ends. Deterministic code steps are ai/function or ai/workflow-step.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "ticket", shape: "ai/trigger", text: "New ticket\nfrom the helpdesk" },
        { id: "redact", shape: "ai/guardrail", text: "PII filter\nredacts personal data" },
        { id: "classify-prompt", shape: "ai/prompt", text: "Classify prompt\ncategory and urgency" },
        { id: "classify", shape: "ai/llm", text: "Fast model\nclassifies the ticket" },
        { id: "labels", shape: "ai/structured-output", text: "Ticket labels\nJSON schema" },
        { id: "route", shape: "ai/router", text: "Router\nby urgency" },
        { id: "reply-prompt", shape: "ai/prompt", text: "Reply prompt\ntone and policies" },
        { id: "draft", shape: "ai/llm", text: "Strong model\nwrites the reply" },
        { id: "reply", shape: "ai/output", text: "Reply draft\nready to send" },
        { id: "escalate", shape: "ai/human-in-the-loop", text: "Escalation\nto a specialist" },
      ],
      edges: [
        { from: "ticket", to: "redact" },
        { from: "redact", to: "classify" },
        { from: "classify-prompt", to: "classify" },
        { from: "classify", to: "labels" },
        { from: "labels", to: "route" },
        { from: "route", to: "draft", text: "Normal" },
        { from: "reply-prompt", to: "draft" },
        { from: "route", to: "escalate", text: "Urgent" },
        { from: "draft", to: "reply" },
      ],
    },
  },
  {
    id: "tool-calling-sequence",
    name: "Tool-calling sequence",
    category: "ai",
    description: "The message exchange of one agent turn: user, agent, model and tools, in the order the calls and results happen.",
    keywords: ["tool calling", "function calling", "tool use", "agent loop", "sequence", "mcp call", "trace", "turn"],
    libraries: ["uml", "ai", "basic"],
    defaultShape: "uml/lifeline",
    routing: "straight",
    edgeKind: "message",
    layout: FREEFORM,
    agentGuide:
      "Build it with diagram_build_sequence (not individual nodes): participants in order user (kind 'actor'), agent, LLM, then each tool or MCP server; messages top to bottom. Requests are 'sync', the model's tool_use and every tool result or answer coming back are 'return', and fire-and-forget notifications are 'async'. The lifelines are uml/lifeline and uml/actor-lifeline shapes.",
    support: "dedicated",
    template: {
      layout: "none",
      sequence: {
        participants: [
          { id: "user", name: "User", kind: "actor" },
          { id: "agent", name: "Agent", color: PALETTE.purple },
          { id: "llm", name: "LLM", color: PALETTE.blue },
          { id: "tools", name: "MCP server", color: PALETTE.teal },
        ],
        messages: [
          { from: "user", to: "agent", text: "Where is order 1042?" },
          { from: "agent", to: "llm", text: "messages + tool definitions" },
          { from: "llm", to: "agent", text: "tool_use: get_order(1042)", kind: "return" },
          { from: "agent", to: "tools", text: "tools/call get_order" },
          { from: "tools", to: "agent", text: "result: shipped, arrives Friday", kind: "return" },
          { from: "agent", to: "llm", text: "messages + tool result" },
          { from: "llm", to: "agent", text: "final answer", kind: "return" },
          { from: "agent", to: "user", text: "It shipped and arrives on Friday", kind: "return" },
        ],
      },
    },
  },
  {
    id: "mcp-topology",
    name: "MCP topology",
    category: "ai",
    description: "Which Model Context Protocol clients connect to which servers, over which transport, and what each server exposes.",
    keywords: ["mcp", "model context protocol", "mcp server", "mcp client", "host", "tools", "connectors", "integrations", "stdio"],
    libraries: ["ai", "infra", "basic"],
    defaultShape: "ai/mcp-server",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 40, 60),
    agentGuide:
      "Draw the host application as an ai/agent-boundary container holding its ai/agent (or ai/llm) and one ai/mcp-client per connection; each client links to exactly one ai/mcp-server with a flow edge, and the transport (stdio or HTTP) goes in the server subtitle or the edge label. Below each server, show what it wraps: ai/api, ai/dataset, ai/document, ai/knowledge-base or other ai/tool cards.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "host", shape: "ai/agent-boundary", text: "Host application (coding assistant)" },
        { id: "agent", shape: "ai/agent", text: "Agent\npicks the tools to call", parent: "host" },
        { id: "github-client", shape: "ai/mcp-client", text: "MCP client\nGitHub session", parent: "host" },
        { id: "db-client", shape: "ai/mcp-client", text: "MCP client\ndatabase session", parent: "host" },
        { id: "files-client", shape: "ai/mcp-client", text: "MCP client\nfilesystem session", parent: "host" },
        { id: "github-server", shape: "ai/mcp-server", text: "GitHub server\nremote, over HTTP" },
        { id: "db-server", shape: "ai/mcp-server", text: "Postgres server\nlocal, over stdio" },
        { id: "files-server", shape: "ai/mcp-server", text: "Filesystem server\nlocal, over stdio" },
        { id: "github-api", shape: "ai/api", text: "GitHub API\nissues and PRs" },
        { id: "database", shape: "ai/dataset", text: "Orders database\nread-only queries" },
        { id: "files", shape: "ai/document", text: "Project files\nread and write" },
      ],
      edges: [
        { from: "agent", to: "github-client" },
        { from: "agent", to: "db-client" },
        { from: "agent", to: "files-client" },
        { from: "github-client", to: "github-server" },
        { from: "db-client", to: "db-server" },
        { from: "files-client", to: "files-server" },
        { from: "github-server", to: "github-api" },
        { from: "db-server", to: "database" },
        { from: "files-server", to: "files" },
      ],
    },
  },
  {
    id: "agent-state-graph",
    name: "Agent state graph",
    category: "ai",
    description: "An agent drawn as a graph of nodes and conditional edges over shared state, in the style of LangGraph.",
    keywords: ["langgraph", "state graph", "agent graph", "state machine", "conditional edges", "nodes and edges", "workflow graph", "checkpoint"],
    libraries: ["ai", "basic", "flowchart"],
    defaultShape: "ai/workflow-step",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 56, 56),
    agentGuide:
      "Mark the entry and exit with basic/pill nodes labelled START and END; each graph node is an ai/* card named after its function (ai/agent for the model call, ai/tool-call for the tool node, ai/planner, ai/human-in-the-loop for interrupts, ai/workflow-step otherwise). Normal edges use the flow kind; conditional edges use dashed and carry the condition as their label. Loops back to the model node are expected.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "start", shape: "basic/pill", text: "START", color: "dark", x: 325, y: 0, w: 140, h: 44 },
        { id: "plan", shape: "ai/planner", text: "plan\nwrite the to-do list", x: 300, y: 88 },
        { id: "agent", shape: "ai/agent", text: "agent\ncall the model", x: 300, y: 198 },
        { id: "tools", shape: "ai/tool-call", text: "tools\nrun the tool calls", x: 600, y: 198 },
        { id: "review", shape: "ai/human-in-the-loop", text: "human_review\ninterrupt for approval", x: 0, y: 198 },
        { id: "end", shape: "basic/pill", text: "END", color: "dark", x: 325, y: 318, w: 140, h: 44 },
      ],
      edges: [
        { from: "start", to: "plan" },
        { from: "plan", to: "agent" },
        { from: "agent", to: "tools", text: "tool calls", kind: "dashed", fromAnchor: { x: 1, y: 0.3 }, toAnchor: { x: 0, y: 0.3 } },
        { from: "tools", to: "agent", fromAnchor: { x: 0, y: 0.7 }, toAnchor: { x: 1, y: 0.7 } },
        { from: "agent", to: "review", text: "risky action", kind: "dashed", fromAnchor: { x: 0, y: 0.3 }, toAnchor: { x: 1, y: 0.3 } },
        { from: "review", to: "agent", text: "approved", fromAnchor: { x: 1, y: 0.7 }, toAnchor: { x: 0, y: 0.7 } },
        { from: "agent", to: "end", text: "done", kind: "dashed" },
      ],
    },
  },
  {
    id: "ml-pipeline",
    name: "ML pipeline",
    category: "ai",
    description: "The machine-learning lifecycle (MLOps): preparing data, training and evaluating a model, then deploying and monitoring it.",
    keywords: ["mlops", "machine learning", "training pipeline", "model training", "fine-tuning", "model registry", "deployment", "monitoring", "feature store"],
    libraries: ["ai", "infra", "basic"],
    defaultShape: "ai/workflow-step",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 40, 56),
    agentGuide:
      "Group the lifecycle into ai/workflow containers (data, training, serving) and fill them with ai/dataset, ai/workflow-step, ai/training-job, ai/eval-suite, ai/fine-tuned-model (the registry or the approved model), ai/gpu (the inference endpoint), ai/trace (monitoring) and ai/feedback-loop cards. Connect the steps with flow edges and draw the retraining loop back to the data stage with the dashed kind.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        ...cardStack("data", "1 · Data", 0, [
          { id: "raw", shape: "ai/dataset", text: "Raw data\norders and clicks" },
          { id: "features", shape: "ai/workflow-step", text: "Feature pipeline\nclean, join, split" },
          { id: "sets", shape: "ai/dataset", text: "Data splits\ntrain, validation, test" },
        ]),
        ...cardStack("training", "2 · Training", 280, [
          { id: "train", shape: "ai/training-job", text: "Training job\nnightly, on GPUs" },
          { id: "evaluate", shape: "ai/eval-suite", text: "Evaluation\naccuracy and bias" },
          { id: "registry", shape: "ai/fine-tuned-model", text: "Model registry\napproved version" },
        ]),
        ...cardStack("serving", "3 · Serving", 560, [
          { id: "endpoint", shape: "ai/gpu", text: "Endpoint\ncanary, then 100 %" },
          { id: "monitor", shape: "ai/trace", text: "Monitoring\ndrift and errors" },
          { id: "retrain", shape: "ai/feedback-loop", text: "Retrain trigger\nwhen quality drops" },
        ]),
      ],
      edges: [
        { from: "raw", to: "features" },
        { from: "features", to: "sets" },
        { from: "sets", to: "train", fromAnchor: "right", toAnchor: "left" },
        { from: "train", to: "evaluate" },
        { from: "evaluate", to: "registry" },
        { from: "registry", to: "endpoint", fromAnchor: "right", toAnchor: "left" },
        { from: "endpoint", to: "monitor" },
        { from: "monitor", to: "retrain" },
        { from: "retrain", to: "data", kind: "dashed", text: "new training run", fromAnchor: "bottom", toAnchor: "bottom" },
      ],
    },
  },
  {
    id: "neural-network",
    name: "Neural network",
    category: "ai",
    description: "The layers of a neural network and how their neurons connect, from the inputs to the predicted outputs.",
    keywords: ["neural network", "deep learning", "layers", "neurons", "perceptron", "mlp", "model architecture", "feed forward"],
    libraries: ["basic", "ai"],
    defaultShape: "basic/circle",
    routing: "straight",
    edgeKind: "line",
    layout: layered("right", 26, 120),
    agentGuide:
      "There are no dedicated neuron shapes: draw each neuron as a small basic/circle (about 44 px) in one column per layer, with explicit coordinates (layout 'none'), one colour per layer role, and a basic/text caption above each column. Connect every neuron to every neuron of the next layer with thin grey line edges (straight routing). For large architectures draw one basic/rounded block per layer instead and connect the blocks with flow edges.",
    support: "generic",
    template: { layout: "none", nodes: neuralNodes, edges: neuralEdges },
  },
  {
    id: "llm-evaluation",
    name: "LLM evaluation pipeline",
    category: "ai",
    description: "How the quality of a prompt, model or agent is measured: test cases in, graded outputs and a pass / fail decision out.",
    keywords: ["evals", "evaluation", "llm judge", "benchmark", "regression tests", "golden set", "grading", "prompt testing", "quality"],
    libraries: ["ai", "basic"],
    defaultShape: "ai/eval-suite",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 40, 52),
    agentGuide:
      "Flow from an ai/dataset of test cases through the system under test (ai/agent, ai/llm or ai/prompt) to its graders — ai/evaluator for an LLM judge, ai/function for code checks, ai/human-in-the-loop for manual review — and into an ai/eval-suite that reports the scores. Use flow edges, label the pass / fail branches, and end the failing branch in an ai/feedback-loop card that says what gets changed before the next run.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "cases", shape: "ai/dataset", text: "Golden set\n200 real questions" },
        { id: "candidate", shape: "ai/prompt", text: "Prompt v7\nthe change under test" },
        { id: "system", shape: "ai/agent", text: "Support agent\nsystem under test" },
        { id: "judge", shape: "ai/evaluator", text: "LLM judge\nscores with a rubric" },
        { id: "checks", shape: "ai/function", text: "Code checks\ncitations, valid JSON" },
        { id: "report", shape: "ai/eval-suite", text: "Eval report\n92 % pass, 3 failures" },
        { id: "ship", shape: "ai/output", text: "Ship the change\nno regressions left" },
        { id: "review", shape: "ai/human-in-the-loop", text: "Review failures\nfind the root cause" },
        { id: "improve", shape: "ai/feedback-loop", text: "Fix and re-run\nprompt, tools, model" },
      ],
      edges: [
        { from: "cases", to: "system" },
        { from: "candidate", to: "system" },
        { from: "system", to: "judge" },
        { from: "system", to: "checks" },
        { from: "judge", to: "report" },
        { from: "checks", to: "report" },
        { from: "report", to: "ship", text: "Passed" },
        { from: "report", to: "review", text: "Failed" },
        { from: "review", to: "improve" },
      ],
    },
  },
  {
    id: "conversation-flow",
    name: "Conversation flow",
    category: "ai",
    description: "A chat between a user and an assistant, turn by turn, including the tool calls made along the way.",
    keywords: ["conversation", "chat", "dialogue", "chatbot", "transcript", "chat bubbles", "conversation design", "turns", "messages"],
    libraries: ["ai", "basic"],
    defaultShape: "ai/assistant-message",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Stack the turns top to bottom with explicit coordinates (layout 'none'): ai/user-message bubbles aligned left and ai/assistant-message bubbles aligned right (their tails already point to the correct side). Show what happens between turns as a centred ai/tool-call, ai/retriever or ai/guardrail card, linked from and to the neighbouring assistant bubbles with dashed edges. For branching dialogues, connect alternative bubbles with labelled flow edges.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        chatBubble("ask", "user", "Hi! Where is my order #1042?", 0, 250, 56),
        chatBubble("ack", "assistant", "Let me look that up for you.", 76, 230, 56),
        { id: "lookup", shape: "ai/tool-call", text: "get_order(1042)\nshipped, arrives Friday", x: 175, y: 162, w: 210, h: 60 },
        chatBubble("status", "assistant", "It shipped this morning and should arrive on Friday. Do you want the tracking link?", 252, 310, 74),
        chatBubble("follow-up", "user", "Yes please. Can I still change the delivery address?", 346, 290, 74),
        chatBubble("answer", "assistant", "Here is the link. The address is locked once a parcel ships, but I can ask the courier to hold it at a pickup point.", 440, 330, 92),
      ],
      edges: [
        { from: "ack", to: "lookup", kind: "dashed", fromAnchor: "bottom", toAnchor: "right" },
        { from: "lookup", to: "status", kind: "dashed", fromAnchor: "bottom", toAnchor: "top" },
      ],
    },
  },
];
