import { PALETTE, type PaletteName } from "../../model/palette";
import type { EdgeSpec, NodeSpec } from "../../spec/apply";
import { FREEFORM, HAIRLINE, label, layered, MUTED_TEXT } from "../presets";
import type { DiagramTypeDef } from "../types";

const HEADER_CELL = { ...HAIRLINE, fill: "#f1f3f5", fontSize: 12, bold: true };
const GRID_CELL = { ...HAIRLINE, fill: "none" };

/* ------------------------------------------------------------------ boards */

const BOARD = { columnW: 220, gap: 14, header: 40, pad: 12, cardH: 72, cardGap: 10 };

interface BoardCard {
  title: string;
  detail: string;
  /** Palette colour of the accent bar. */
  accent: PaletteName;
}

const boardX = (column: number): number => column * (BOARD.columnW + BOARD.gap);
const boardHeight = (cards: number): number => BOARD.header + BOARD.pad * 2 + cards * BOARD.cardH + (cards - 1) * BOARD.cardGap;

/** A kanban column with its cards stacked from the top. `rows` sets the height in cards. */
function boardColumn(id: string, title: string, column: number, top: number, rows: number, cards: BoardCard[], color?: PaletteName): NodeSpec[] {
  const x = boardX(column);
  return [
    { id, shape: "strategy/kanban-column", text: title, x, y: top, w: BOARD.columnW, h: boardHeight(rows), ...(color ? { color } : {}) },
    ...cards.map((card, index) => ({
      id: `${id}-${index + 1}`,
      shape: "strategy/kanban-card",
      text: `${card.title}\n${card.detail}`,
      parent: id,
      x: x + BOARD.pad,
      y: top + BOARD.header + BOARD.pad + index * (BOARD.cardH + BOARD.cardGap),
      w: BOARD.columnW - BOARD.pad * 2,
      h: BOARD.cardH,
      style: { stroke: PALETTE[card.accent].stroke },
    })),
  ];
}

/** Small coloured tag used as an inline colour key. */
const tag = (id: string, text: string, x: number, y: number, color: PaletteName): NodeSpec => ({
  id,
  shape: "basic/pill",
  text,
  x,
  y,
  w: 76,
  h: 24,
  color,
  style: { fontSize: 11, bold: true },
});

/* ----------------------------------------------------------------- roadmap */

const ROADMAP = { left: 120, quarterW: 180, top: 30, header: 34, milestones: 44, rowH: 84 };
const roadmapX = (quarter: number): number => ROADMAP.left + quarter * ROADMAP.quarterW;
const roadmapRowY = (row: number): number => ROADMAP.top + ROADMAP.header + ROADMAP.milestones + row * ROADMAP.rowH;
const ROADMAP_WIDTH = roadmapX(4);
const ROADMAP_BOTTOM = roadmapRowY(3);

/** A roadmap item: `from` / `to` are in quarters (0 = start of Q1), `track` is the line inside the row. */
function roadmapBar(id: string, text: string, row: number, track: 0 | 1, from: number, to: number, color: PaletteName, progress: number): NodeSpec {
  return {
    id,
    shape: "strategy/gantt-bar",
    text,
    x: roadmapX(from) + 6,
    y: roadmapRowY(row) + 12 + track * 34,
    w: (to - from) * ROADMAP.quarterW - 12,
    h: 28,
    color,
    data: { progress },
  };
}

const roadmapRow = (id: string, title: string, row: number, color: PaletteName): NodeSpec[] => [
  { id: `${id}-rule`, shape: "basic/divider", x: 0, y: roadmapRowY(row) - 5, w: ROADMAP_WIDTH, h: 10, style: { stroke: "#c9ccd1" } },
  label(id, title, { x: 0, y: roadmapRowY(row), w: ROADMAP.left - 10, h: ROADMAP.rowH }, { bold: true, align: "left", fontSize: 13, textColor: PALETTE[color].text }),
];

const roadmapMilestone = (id: string, text: string, quarter: number): NodeSpec => ({
  id,
  shape: "strategy/gantt-milestone",
  text,
  x: roadmapX(quarter) - 10,
  y: ROADMAP.top + ROADMAP.header + 12,
  w: 20,
  h: 20,
});

/* ---------------------------------------------------------------- timeline */

const TIMELINE = { axisW: 670, axisY: 160, cardW: 190, cardH: 76 };
/** Tick positions of a `strategy/timeline-axis` with five ticks and this width. */
const timelineX = (index: number): number => Math.round((index / 4) * (TIMELINE.axisW - 27.5));

/** A dated dot on the axis with its story card above (even index) or below (odd index). */
function timelineEvent(id: string, index: number, date: string, title: string, detail: string, accent: PaletteName): NodeSpec[] {
  const above = index % 2 === 0;
  const x = timelineX(index);
  return [
    {
      id,
      shape: "strategy/timeline-milestone",
      text: date,
      x: x - 9,
      y: TIMELINE.axisY + 3,
      w: 18,
      h: 18,
      data: { labelAbove: !above },
      style: { stroke: PALETTE[accent].stroke, bold: true },
    },
    {
      id: `${id}-card`,
      shape: "strategy/kanban-card",
      text: `${title}\n${detail}`,
      x: x - TIMELINE.cardW / 2,
      y: above ? TIMELINE.axisY - 24 - TIMELINE.cardH : TIMELINE.axisY + 48,
      w: TIMELINE.cardW,
      h: TIMELINE.cardH,
      style: { stroke: PALETTE[accent].stroke },
    },
  ];
}

/* ------------------------------------------------------------------- gantt */

const GANTT = { nameW: 170, weekW: 70, top: 60, rowH: 40, weeks: 8 };
const ganttX = (week: number): number => GANTT.nameW + week * GANTT.weekW;
const ganttY = (row: number): number => GANTT.top + row * GANTT.rowH;
const ganttBarW = (weeks: number): number => weeks * GANTT.weekW - 6;

interface GanttTask {
  id: string;
  name: string;
  start: number;
  weeks: number;
  progress: number;
  color: PaletteName;
}

const GANTT_TASKS: GanttTask[] = [
  { id: "interviews", name: "User interviews", start: 0, weeks: 2, progress: 1, color: "blue" },
  { id: "wireframes", name: "Wireframes", start: 2, weeks: 2, progress: 1, color: "teal" },
  { id: "visuals", name: "Visual design", start: 4, weeks: 2, progress: 0.4, color: "teal" },
  { id: "frontend", name: "Frontend build", start: 4, weeks: 3, progress: 0.2, color: "purple" },
  { id: "backend", name: "Backend API", start: 2, weeks: 4, progress: 0.6, color: "purple" },
  { id: "qa", name: "QA and fixes", start: 7, weeks: 1, progress: 0, color: "orange" },
];

const ganttRowName = (id: string, name: string, row: number): NodeSpec =>
  label(`${id}-name`, name, { x: 0, y: ganttY(row), w: GANTT.nameW - 10, h: GANTT.rowH }, { fontSize: 13, align: "left" });

/** Finish-to-start link: leaves the bottom of the predecessor near its end and enters the successor from the left. */
function ganttLink(from: string, to: string): EdgeSpec {
  const task = GANTT_TASKS.find((t) => t.id === from);
  const width = task ? ganttBarW(task.weeks) : GANTT.weekW;
  return { from, to, fromAnchor: { x: 1 - 30 / width, y: 1 }, toAnchor: "left", color: "gray" };
}

/* --------------------------------------------------------------------- WBS */

const WBS = { branchW: 190, gap: 20, leafH: 40, leafGap: 10, indent: 30 };

const WBS_BRANCHES: { id: string; code: string; title: string; color: PaletteName; leaves: string[] }[] = [
  { id: "discovery", code: "1.1", title: "Discovery", color: "blue", leaves: ["User research", "Competitor review", "Requirements"] },
  { id: "design", code: "1.2", title: "Design", color: "teal", leaves: ["Wireframes", "Visual design", "Prototype test"] },
  { id: "build", code: "1.3", title: "Development", color: "purple", leaves: ["Mobile client", "Payments API", "Test automation"] },
  { id: "launch", code: "1.4", title: "Launch", color: "orange", leaves: ["Store submission", "Support training", "Launch campaign"] },
];

const wbsX = (branch: number): number => branch * (WBS.branchW + WBS.gap);
const WBS_WIDTH = wbsX(WBS_BRANCHES.length) - WBS.gap;

const wbsNodes: NodeSpec[] = [
  { id: "project", shape: "basic/rect", text: "1  Mobile banking app", x: WBS_WIDTH / 2 - 120, y: 0, w: 240, h: 50, color: "dark", style: { bold: true } },
  ...WBS_BRANCHES.flatMap((branch, index) => [
    { id: branch.id, shape: "basic/rect", text: `${branch.code}  ${branch.title}`, x: wbsX(index), y: 100, w: WBS.branchW, h: 46, color: branch.color, style: { bold: true } },
    ...branch.leaves.map((leaf, row) => ({
      id: `${branch.id}-${row + 1}`,
      shape: "basic/rect",
      text: `${branch.code}.${row + 1}  ${leaf}`,
      x: wbsX(index) + WBS.indent,
      y: 166 + row * (WBS.leafH + WBS.leafGap),
      w: WBS.branchW - WBS.indent,
      h: WBS.leafH,
      style: { ...HAIRLINE, fontSize: 12, align: "left" as const },
    })),
  ]),
];

const wbsEdges: EdgeSpec[] = WBS_BRANCHES.flatMap((branch) => [
  { from: "project", to: branch.id, kind: "line", fromAnchor: "bottom" as const, toAnchor: "top" as const },
  ...branch.leaves.map((_, row) => ({
    from: branch.id,
    to: `${branch.id}-${row + 1}`,
    kind: "line",
    fromAnchor: { x: 12 / WBS.branchW, y: 1 },
    toAnchor: "left" as const,
  })),
]);

/* ------------------------------------------------------------------- types */

export const PLANNING_TYPES: DiagramTypeDef[] = [
  {
    id: "org-chart",
    name: "Org chart",
    category: "planning",
    description: "Who reports to whom: the people, roles and open positions of a team or company as a hierarchy.",
    keywords: ["org chart", "organisation chart", "organization chart", "organogram", "hierarchy", "reporting lines", "team structure"],
    libraries: ["org", "basic"],
    defaultShape: "org/person",
    routing: "orthogonal",
    edgeKind: "line",
    layout: layered("down", 28, 48),
    agentGuide:
      "Use org/person for people (text: name, then role, then an optional detail line), org/role for a position without a named person and org/vacancy for an open position. Connect manager → report with line edges and keep it a strict tree (one manager per card); use dotted edges for dotted-line reporting, and an org/team container (set `parent`) to box a department.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "ceo", shape: "org/person", text: "Maya Chen\nChief Executive Officer", color: "blue" },
        { id: "cto", shape: "org/person", text: "Daniel Okafor\nChief Technology Officer" },
        { id: "cpo", shape: "org/person", text: "Sofia Rossi\nChief Product Officer" },
        { id: "coo", shape: "org/person", text: "Liam Becker\nHead of Operations" },
        { id: "eng-manager", shape: "org/person", text: "Priya Nair\nEngineering Manager" },
        { id: "staff-engineer", shape: "org/person", text: "Tom Alvarez\nStaff Engineer" },
        { id: "design-lead", shape: "org/person", text: "Hana Sato\nDesign Lead" },
        { id: "support-lead", shape: "org/person", text: "Omar Haddad\nSupport Lead" },
        { id: "frontend", shape: "org/person", text: "Elif Kaya\nFrontend Developer" },
        { id: "researcher", shape: "org/vacancy", text: "Open role\nUX Researcher" },
      ],
      edges: [
        { from: "ceo", to: "cto", kind: "line" },
        { from: "ceo", to: "cpo", kind: "line" },
        { from: "ceo", to: "coo", kind: "line" },
        { from: "cto", to: "eng-manager", kind: "line" },
        { from: "cto", to: "staff-engineer", kind: "line" },
        { from: "cpo", to: "design-lead", kind: "line" },
        { from: "coo", to: "support-lead", kind: "line" },
        { from: "eng-manager", to: "frontend", kind: "line" },
        { from: "design-lead", to: "researcher", kind: "line" },
      ],
    },
  },
  {
    id: "roadmap",
    name: "Roadmap",
    category: "planning",
    description: "What a team plans to deliver and roughly when: initiatives as bars across quarters, grouped by theme, with key milestones.",
    keywords: ["roadmap", "product roadmap", "release roadmap", "now next later", "quarters", "initiatives", "strategy plan"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/gantt-bar",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Position everything explicitly (layout 'none'): one basic/rect header per quarter or month across the top, a basic/text title per theme row on the left, and one strategy/gantt-bar per initiative whose x and width give its start and duration (data.progress 0–1 fills the done part; one colour per theme). Mark dated commitments with strategy/gantt-milestone; connectors are rarely needed.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Product roadmap 2027", { x: 0, y: 0, w: 300, h: 24 }, { bold: true, fontSize: 16, align: "left" }),
        ...["Q1", "Q2", "Q3", "Q4"].flatMap((quarter, index) => [
          { id: `q${index + 1}-column`, shape: "basic/rect", x: roadmapX(index), y: ROADMAP.top, w: ROADMAP.quarterW, h: ROADMAP_BOTTOM - ROADMAP.top, style: GRID_CELL },
          { id: `q${index + 1}`, shape: "basic/rect", text: quarter, x: roadmapX(index), y: ROADMAP.top, w: ROADMAP.quarterW, h: ROADMAP.header, style: HEADER_CELL },
        ]),
        label("milestones", "Milestones", { x: 0, y: ROADMAP.top + ROADMAP.header, w: ROADMAP.left - 10, h: ROADMAP.milestones }, { ...MUTED_TEXT, bold: true, align: "left", fontSize: 13 }),
        roadmapMilestone("beta", "Public beta", 0.8),
        roadmapMilestone("launch", "2.0 launch", 2.5),
        roadmapMilestone("enterprise", "Enterprise GA", 3.3),
        ...roadmapRow("growth", "Growth", 0, "blue"),
        ...roadmapRow("platform", "Platform", 1, "purple"),
        ...roadmapRow("mobile", "Mobile", 2, "teal"),
        roadmapBar("onboarding", "Self-serve onboarding", 0, 0, 0, 1.2, "blue", 1),
        roadmapBar("referrals", "Referral programme", 0, 0, 1.3, 3, "blue", 0),
        roadmapBar("landing-pages", "SEO landing pages", 0, 1, 0.5, 2, "blue", 0.5),
        roadmapBar("pricing", "Pricing experiments", 0, 1, 2.5, 4, "blue", 0),
        roadmapBar("sso", "SSO and audit log", 1, 0, 0, 2, "purple", 0.62),
        roadmapBar("api", "Public API v2", 1, 0, 2, 4, "purple", 0),
        roadmapBar("residency", "EU data residency", 1, 1, 1.6, 3.2, "purple", 0),
        roadmapBar("offline", "Offline mode", 2, 0, 0.5, 2.2, "teal", 0.44),
        roadmapBar("widgets", "Home-screen widgets", 2, 0, 3, 4, "teal", 0),
        roadmapBar("tablet", "Tablet layout", 2, 1, 2, 3.5, "teal", 0),
        { id: "today-line", shape: "basic/rect", x: roadmapX(1.25) - 1, y: ROADMAP.top, w: 2, h: ROADMAP_BOTTOM - ROADMAP.top, style: { fill: "#e03131", stroke: "none" } },
        { id: "today", shape: "basic/pill", text: "Today", x: roadmapX(1.25) - 28, y: 2, w: 56, h: 22, color: "red", style: { fontSize: 11, bold: true } },
      ],
      edges: [],
    },
  },
  {
    id: "timeline",
    name: "Timeline",
    category: "planning",
    description: "Events in chronological order along a time axis, for histories, project phases and schedules of key dates.",
    keywords: ["timeline", "chronology", "history", "milestones", "key dates", "sequence of events", "schedule"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/timeline-milestone",
    routing: "straight",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Position everything explicitly (layout 'none'): one strategy/timeline-axis (data.ticks = number of tick marks), then a strategy/timeline-milestone dot centred on the axis per event with the date as its text (data.labelAbove true puts the label above the line). Describe each event in a strategy/kanban-card or basic/text on the other side of the axis, alternating above and below, linked to its dot with a line edge.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "axis", shape: "strategy/timeline-axis", x: 0, y: TIMELINE.axisY, w: TIMELINE.axisW, h: 24, data: { ticks: 5 } },
        ...timelineEvent("founded", 0, "2019", "Founded", "Two friends and a spreadsheet of ideas", "blue"),
        ...timelineEvent("first-customer", 1, "2020", "First paying customer", "A bakery chain signs up for a year", "blue"),
        ...timelineEvent("series-a", 2, "2022", "Series A", "€8M to grow the team to 40 people", "purple"),
        ...timelineEvent("mobile", 3, "2024", "Mobile app", "iOS and Android launch on the same day", "blue"),
        ...timelineEvent("scale", 4, "2026", "100,000 teams", "Customers in 60 countries", "green"),
      ],
      edges: ["founded", "first-customer", "series-a", "mobile", "scale"].map((id) => ({ from: `${id}-card`, to: id, kind: "line", color: "gray" })),
    },
  },
  {
    id: "gantt-chart",
    name: "Gantt chart",
    category: "planning",
    description: "A project schedule: tasks as bars on a calendar showing start, duration, progress, dependencies and deadlines.",
    keywords: ["gantt", "gantt chart", "project schedule", "project plan", "task schedule", "dependencies", "deadline"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/gantt-bar",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Position everything explicitly (layout 'none') on a fixed scale, e.g. 70px per week and one 40px row per task: basic/rect cells for the calendar header, a basic/text task name on the left of each row, and a strategy/gantt-bar whose x and width encode start and duration (data.progress 0–1 for completion). Use strategy/gantt-milestone for deadlines and flow edges from a predecessor to its successor (toAnchor 'left') for dependencies.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "march", shape: "basic/rect", text: "March", x: ganttX(0), y: 0, w: GANTT.weekW * 4, h: 26, style: HEADER_CELL },
        { id: "april", shape: "basic/rect", text: "April", x: ganttX(4), y: 0, w: GANTT.weekW * 4, h: 26, style: HEADER_CELL },
        ...Array.from({ length: GANTT.weeks }, (_, week) => [
          { id: `week-${week + 1}-column`, shape: "basic/rect", x: ganttX(week), y: 26, w: GANTT.weekW, h: ganttY(GANTT_TASKS.length + 1) - 26, style: GRID_CELL },
          { id: `week-${week + 1}`, shape: "basic/rect", text: `W${week + 1}`, x: ganttX(week), y: 26, w: GANTT.weekW, h: 26, style: { ...HEADER_CELL, bold: false, fill: "#f8f9fa" } },
        ]).flat(),
        ...GANTT_TASKS.flatMap((task, row) => [
          ganttRowName(task.id, task.name, row),
          {
            id: task.id,
            shape: "strategy/gantt-bar",
            text: `${Math.round(task.progress * 100)}%`,
            x: ganttX(task.start) + 3,
            y: ganttY(row) + 7,
            w: ganttBarW(task.weeks),
            h: 26,
            color: task.color,
            data: { progress: task.progress },
          },
        ]),
        ganttRowName("go-live", "Go live", GANTT_TASKS.length),
        { id: "go-live", shape: "strategy/gantt-milestone", text: "", x: ganttX(8) - 10, y: ganttY(GANTT_TASKS.length) + 10, w: 20, h: 20 },
      ],
      edges: [
        ganttLink("interviews", "wireframes"),
        ganttLink("wireframes", "visuals"),
        ganttLink("wireframes", "frontend"),
        ganttLink("frontend", "qa"),
        ganttLink("qa", "go-live"),
      ],
    },
  },
  {
    id: "kanban-board",
    name: "Kanban board",
    category: "planning",
    description: "Work items as cards moving through the columns of a workflow, to see what is in progress and where work piles up.",
    keywords: ["kanban", "board", "task board", "to do doing done", "backlog", "wip", "trello", "agile board"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/kanban-card",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Place one strategy/kanban-column container per workflow state side by side (explicit x/y/w/h, layout 'none') and stack strategy/kanban-card nodes inside each (set `parent`; text: title, then a detail line). The card's stroke colour is its accent bar: use it for the work type or priority and explain it with small basic/pill tags. No connectors.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Web team board", { x: 0, y: 0, w: 300, h: 28 }, { bold: true, fontSize: 16, align: "left" }),
        tag("key-feature", "Feature", boardX(4) - BOARD.gap - 244, 2, "blue"),
        tag("key-bug", "Bug", boardX(4) - BOARD.gap - 160, 2, "red"),
        tag("key-chore", "Chore", boardX(4) - BOARD.gap - 76, 2, "gray"),
        ...boardColumn("backlog", "Backlog", 0, 40, 4, [
          { title: "Dark mode", detail: "Follow the system setting", accent: "blue" },
          { title: "Export to CSV", detail: "Orders and customers", accent: "blue" },
          { title: "Upgrade to Node 24", detail: "Before the LTS deadline", accent: "gray" },
          { title: "Avatar upload fails", detail: "Images over 5 MB", accent: "red" },
        ]),
        ...boardColumn("doing", "In progress", 1, 40, 4, [
          { title: "Saved payment cards", detail: "Ines · 3 days left", accent: "blue" },
          { title: "Cart total rounding", detail: "Jonas · hotfix", accent: "red" },
        ]),
        ...boardColumn("review", "In review", 2, 40, 4, [
          { title: "Search suggestions", detail: "Waiting for design sign-off", accent: "blue" },
          { title: "Remove legacy tracking", detail: "Two approvals needed", accent: "gray" },
        ]),
        ...boardColumn("done", "Done", 3, 40, 4, [
          { title: "Guest checkout", detail: "Released on Tuesday", accent: "blue" },
          { title: "Slow product page", detail: "Load time down to 1.2 s", accent: "red" },
          { title: "Rotate API keys", detail: "All services updated", accent: "gray" },
        ]),
      ],
      edges: [],
    },
  },
  {
    id: "sprint-plan",
    name: "Sprint plan",
    category: "planning",
    description: "Which stories go into which sprint and when each release ships, for iteration and release planning.",
    keywords: ["sprint plan", "release plan", "iteration plan", "scrum", "agile", "story points", "backlog", "program increment"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/kanban-card",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Place one strategy/kanban-column per sprint in chronological order, plus one for the remaining backlog (explicit x/y/w/h, layout 'none'), and put a strategy/kanban-card per story inside (set `parent`; text: story, then points and epic; stroke colour = epic). Show releases on a strategy/timeline-axis under the columns with a strategy/timeline-milestone where each one ships.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        ...boardColumn("sprint-1", "Sprint 1 · 3–14 Mar", 0, 0, 3, [
          { title: "Browse the catalogue", detail: "5 pts · Catalogue", accent: "teal" },
          { title: "Product details page", detail: "3 pts · Catalogue", accent: "teal" },
          { title: "Create an account", detail: "5 pts · Accounts", accent: "purple" },
        ]),
        ...boardColumn("sprint-2", "Sprint 2 · 17–28 Mar", 1, 0, 3, [
          { title: "Add to basket", detail: "3 pts · Checkout", accent: "blue" },
          { title: "Pay by card", detail: "8 pts · Checkout", accent: "blue" },
          { title: "Order confirmation email", detail: "2 pts · Checkout", accent: "blue" },
        ]),
        ...boardColumn("sprint-3", "Sprint 3 · 31 Mar–11 Apr", 2, 0, 3, [
          { title: "Search with filters", detail: "5 pts · Catalogue", accent: "teal" },
          { title: "Saved addresses", detail: "3 pts · Accounts", accent: "purple" },
          { title: "Apple Pay and Google Pay", detail: "5 pts · Checkout", accent: "blue" },
        ]),
        ...boardColumn("later", "Later", 3, 0, 3, [
          { title: "Wish lists", detail: "5 pts · Accounts", accent: "purple" },
          { title: "Product reviews", detail: "8 pts · Catalogue", accent: "teal" },
        ]),
        { id: "calendar", shape: "strategy/timeline-axis", x: 0, y: boardHeight(3) + 22, w: boardX(3) + 60, h: 24, data: { ticks: 0 } },
        { id: "beta", shape: "strategy/timeline-milestone", text: "Beta release\n28 March", x: boardX(2) - BOARD.gap / 2 - 9, y: boardHeight(3) + 25, w: 18, h: 18, style: { stroke: "#e8792a" } },
        { id: "release", shape: "strategy/timeline-milestone", text: "Version 1.0\n11 April", x: boardX(3) - BOARD.gap / 2 - 9, y: boardHeight(3) + 25, w: 18, h: 18, style: { stroke: "#2f9e44" } },
      ],
      edges: [],
    },
  },
  {
    id: "raci-matrix",
    name: "RACI matrix",
    category: "planning",
    description: "Who is Responsible, Accountable, Consulted and Informed for each activity of a project or process.",
    keywords: ["raci", "responsibility matrix", "responsibility assignment", "rasci", "roles and responsibilities", "accountability"],
    libraries: ["basic", "strategy"],
    defaultShape: "basic/table",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Use a single basic/table: the header row lists the roles after an 'Activity' column, then one row per activity with R, A, C, I (or A/R) in each role cell, cells separated by `|`. Give every activity exactly one A and at least one R, and add a basic/text key underneath explaining the four letters.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Checkout redesign: who does what", { x: 0, y: 0, w: 640, h: 30 }, { bold: true, fontSize: 16, align: "left" }),
        {
          id: "matrix",
          shape: "basic/table",
          text: [
            "Activity | Product manager | Designer | Tech lead | QA engineer",
            "Define the requirements | A/R | C | C | I",
            "Design the new flow | A | R | C | I",
            "Build and review the code | I | C | A/R | C",
            "Test and sign off | I | I | A | R",
            "Release to customers | A | I | R | C",
          ].join("\n"),
          x: 0,
          y: 40,
          w: 640,
          h: 216,
        },
        label(
          "key",
          "R  Responsible: does the work      A  Accountable: owns the outcome\nC  Consulted: gives input first        I  Informed: told about the result",
          { x: 0, y: 266, w: 640, h: 44 },
          { ...MUTED_TEXT, align: "left" },
        ),
      ],
      edges: [],
    },
  },
  {
    id: "pert-chart",
    name: "PERT chart",
    category: "planning",
    description: "A project as a network of dependent tasks with durations, to find the critical path that determines the end date.",
    keywords: ["pert", "cpm", "critical path", "dependency network", "activity network", "precedence diagram", "project network"],
    libraries: ["basic", "flowchart"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 36, 64),
    agentGuide:
      "There is no dedicated PERT node, so draw each task as a basic/rounded node with its name on the first line and its duration on the second (activity-on-node), and connect predecessor → successor with flow edges. Highlight the critical path, the longest chain of durations, by colouring its nodes and edges red.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "scope", text: "Agree the scope\n2 days", color: "red" },
        { id: "design", text: "Design the screens\n5 days" },
        { id: "api", text: "Build the API\n8 days", color: "red" },
        { id: "content", text: "Write the content\n3 days" },
        { id: "frontend", text: "Build the frontend\n6 days", color: "red" },
        { id: "load-test", text: "Load test\n2 days" },
        { id: "launch", text: "Launch\n1 day", color: "red" },
      ],
      edges: [
        { from: "scope", to: "design" },
        { from: "scope", to: "api", color: "red" },
        { from: "scope", to: "content" },
        { from: "design", to: "frontend" },
        { from: "api", to: "frontend", color: "red" },
        { from: "api", to: "load-test" },
        { from: "content", to: "launch" },
        { from: "frontend", to: "launch", color: "red" },
        { from: "load-test", to: "launch" },
      ],
    },
  },
  {
    id: "work-breakdown-structure",
    name: "Work breakdown structure",
    category: "planning",
    description: "A project decomposed into deliverables and work packages, each numbered by its place in the hierarchy.",
    keywords: ["wbs", "work breakdown structure", "work packages", "deliverables", "project scope", "decomposition", "breakdown"],
    libraries: ["basic", "org"],
    defaultShape: "basic/rect",
    routing: "orthogonal",
    edgeKind: "line",
    layout: layered("down", 24, 44),
    agentGuide:
      "Draw every element as a basic/rect whose text starts with its WBS code (1, 1.1, 1.1.1…): the project on top, the main deliverables in a row beneath it, and work packages below their deliverable. Connect parent → child with line edges and keep a strict tree; either let the automatic layout arrange it, or stack the work packages vertically under each deliverable with explicit coordinates as the template does.",
    support: "generic",
    template: { layout: "none", nodes: wbsNodes, edges: wbsEdges },
  },
];
