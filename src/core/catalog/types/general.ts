import type { NodeSpec } from "../../spec/apply";
import { label, layered } from "../presets";
import type { DiagramTypeDef } from "../types";

/* ------------------------------------------------------------- brainstorm */

const NOTE = { size: 120, gap: 14, columnW: 290 };

/** A titled cluster of sticky notes, two per row. */
function noteCluster(id: string, title: string, column: number, color: string, notes: string[]): NodeSpec[] {
  const x = column * NOTE.columnW;
  return [
    label(`${id}-title`, title, { x, y: 70, w: NOTE.size * 2 + NOTE.gap, h: 30 }, { bold: true, fontSize: 15, align: "left" }),
    ...notes.map((text, index) => ({
      id: `${id}-${index + 1}`,
      shape: "basic/note",
      text,
      x: x + (index % 2) * (NOTE.size + NOTE.gap),
      y: 110 + Math.floor(index / 2) * (NOTE.size + NOTE.gap),
      w: NOTE.size,
      h: NOTE.size,
      color,
      style: { fontSize: 15 },
    })),
  ];
}

/* ------------------------------------------------------------------ types */

export const GENERAL_TYPES: DiagramTypeDef[] = [
  {
    id: "blank",
    name: "Blank canvas",
    category: "general",
    description: "An empty canvas with every shape library available.",
    keywords: ["empty", "free", "freeform", "whiteboard", "sketch", "scratch", "custom"],
    libraries: ["basic", "flowchart", "icons"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down"),
    agentGuide: "No notation is implied. Pick shapes from any library with diagram_list_shapes, or look for a more specific diagram type first with diagram_list_types.",
    support: "generic",
  },
  {
    id: "brainstorm",
    name: "Brainstorm board",
    category: "general",
    description: "A sticky-note board for collecting ideas and grouping them into themes (affinity mapping).",
    keywords: ["brainstorm", "sticky notes", "post-it", "affinity map", "ideation", "workshop", "retrospective", "whiteboard"],
    libraries: ["basic", "strategy", "icons"],
    defaultShape: "basic/note",
    routing: "curved",
    edgeKind: "line",
    layout: { algorithm: "grid", direction: "down", spacing: 24 },
    agentGuide:
      "Write one idea per basic/note (a short phrase), use one colour per theme, and give each cluster a bold basic/text heading. Place notes on a loose grid with explicit coordinates (layout 'none'), or leave the coordinates out and let the grid layout arrange them; connectors are rarely needed.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("question", "How might we make onboarding effortless?", { x: 0, y: 0, w: 840, h: 44 }, { bold: true, fontSize: 22, align: "left" }),
        ...noteCluster("guide", "Guide the first steps", 0, "yellow", ["Interactive product tour", "Checklist with progress", "Sample project to explore", "Tips at the right moment"]),
        ...noteCluster("friction", "Remove friction", 1, "pink", ["Sign in with Google", "Skip the credit card", "Import from a spreadsheet"]),
        ...noteCluster("human", "Add a human touch", 2, "teal", ["Welcome video from the team", "Live chat in week one", "Office hours every Friday", "Celebrate the first win"]),
      ],
      edges: [],
    },
  },
  {
    id: "comparison-table",
    name: "Table",
    category: "general",
    description: "A plain grid for comparing options, listing properties or building any matrix that is not a graph.",
    keywords: ["table", "grid", "comparison", "matrix", "feature comparison", "decision matrix", "spreadsheet"],
    libraries: ["basic", "strategy"],
    defaultShape: "basic/table",
    routing: "orthogonal",
    edgeKind: "line",
    layout: { algorithm: "grid", direction: "down", spacing: 40 },
    agentGuide:
      "Use a single basic/table node: one row per line, cells separated by `|`, the first row is the header. Keep cells short (a word, a number, ✓ or –) and set w / h to give the columns room; add a basic/text title above it if needed.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Choosing a hosting plan", { x: 0, y: 0, w: 560, h: 36 }, { bold: true, fontSize: 18, align: "left" }),
        {
          id: "plans",
          shape: "basic/table",
          text: [
            "Feature | Starter | Team | Enterprise",
            "Price per month | €0 | €29 | Custom",
            "Projects | 3 | Unlimited | Unlimited",
            "Team members | 1 | 10 | Unlimited",
            "Custom domain | – | ✓ | ✓",
            "Single sign-on | – | – | ✓",
            "Support | Community | Email | Dedicated",
          ].join("\n"),
          x: 0,
          y: 46,
          w: 560,
          h: 252,
        },
      ],
      edges: [],
    },
  },
];
