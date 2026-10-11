import type { NodeSpec } from "../../spec/apply";
import { bullets, FREEFORM, label, layered, MUTED_TEXT, panel } from "../presets";
import type { DiagramTypeDef } from "../types";

const TITLE = { bold: true, fontSize: 18, align: "left" } as const;

/** Small rounded tag placed on top of a matrix. */
const chip = (id: string, text: string, x: number, y: number, color: string, shape = "basic/rounded"): NodeSpec => ({
  id,
  shape,
  text,
  x,
  y,
  w: 160,
  h: 36,
  color,
  style: { fontSize: 13 },
});

/* ----------------------------------------------------------------- funnel */

const FUNNEL_STAGES: { id: string; text: string; fill: string; textColor: string; rate?: string }[] = [
  { id: "visitors", text: "Visitors · 24,000", fill: "#2f6fed", textColor: "#ffffff", rate: "26 % sign up" },
  { id: "signups", text: "Sign-ups · 6,200", fill: "#6ea3ff", textColor: "#0b2559", rate: "47 % activate" },
  { id: "activated", text: "Activated · 2,900", fill: "#a9c6ff", textColor: "#0b2559", rate: "29 % start paying" },
  { id: "paying", text: "Paying · 840", fill: "#cfdfff", textColor: "#123a8f", rate: "73 % renew" },
  { id: "renewed", text: "Renewed · 610", fill: "#e5efff", textColor: "#123a8f" },
];

const FUNNEL = { w: 520, h: 60, gap: 6, step: 30 };

const funnelNodes: NodeSpec[] = FUNNEL_STAGES.flatMap((stage, index) => {
  const y = index * (FUNNEL.h + FUNNEL.gap);
  const nodes: NodeSpec[] = [
    {
      id: stage.id,
      shape: "strategy/funnel-stage",
      text: stage.text,
      x: index * FUNNEL.step,
      y,
      w: FUNNEL.w - index * FUNNEL.step * 2,
      h: FUNNEL.h,
      style: { fill: stage.fill, stroke: "#2f6fed", textColor: stage.textColor, bold: true },
    },
  ];
  if (stage.rate) nodes.push(label(`${stage.id}-rate`, stage.rate, { x: FUNNEL.w + 20, y: y + FUNNEL.h - 9, w: 140, h: 24 }, { ...MUTED_TEXT, align: "left" }));
  return nodes;
});

/* ---------------------------------------------------------------- pyramid */

const PYRAMID_LEVELS: { id: string; text: string; note: string; fill: string; textColor: string }[] = [
  { id: "vision", text: "Vision", note: "Where we want to be in ten years", fill: "#2f6fed", textColor: "#ffffff" },
  { id: "mission", text: "Mission", note: "Why we exist and for whom", fill: "#6ea3ff", textColor: "#0b2559" },
  { id: "objectives", text: "Objectives", note: "What we must achieve this year", fill: "#a9c6ff", textColor: "#0b2559" },
  { id: "strategies", text: "Strategies", note: "How we will win", fill: "#cfdfff", textColor: "#123a8f" },
  { id: "tactics", text: "Tactics", note: "Projects and actions this quarter", fill: "#e5efff", textColor: "#123a8f" },
];

// Every level has the same side slope (0.6 px per px of height), so the stack reads as one triangle.
const PYRAMID = { tipW: 132, tipH: 110, levelH: 70, grow: 84 };
const PYRAMID_BASE = PYRAMID.tipW + (PYRAMID_LEVELS.length - 1) * PYRAMID.grow;

const pyramidNodes: NodeSpec[] = PYRAMID_LEVELS.flatMap((level, index) => {
  const w = PYRAMID.tipW + index * PYRAMID.grow;
  const y = index === 0 ? 0 : PYRAMID.tipH + (index - 1) * PYRAMID.levelH;
  const h = index === 0 ? PYRAMID.tipH : PYRAMID.levelH;
  return [
    {
      id: level.id,
      shape: "strategy/pyramid-level",
      text: level.text,
      x: (PYRAMID_BASE - w) / 2,
      y,
      w,
      h,
      ...(index === 0 ? { data: { top: true } } : {}),
      style: { fill: level.fill, stroke: "#2f6fed", textColor: level.textColor, bold: true },
    },
    label(`${level.id}-note`, level.note, { x: PYRAMID_BASE + 20, y: y + h - 47, w: 240, h: 24 }, { ...MUTED_TEXT, align: "left" }),
  ];
});

/* ------------------------------------------------------------------ types */

export const STRATEGY_TYPES: DiagramTypeDef[] = [
  {
    id: "swot",
    name: "SWOT analysis",
    category: "strategy",
    description: "The strengths, weaknesses, opportunities and threats of a business, product or plan on one page.",
    keywords: ["swot", "strengths", "weaknesses", "opportunities", "threats", "situational analysis", "strategy"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/swot",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Use a single strategy/swot node. Its text has four sections separated by `---` lines, in the order strengths, weaknesses, opportunities, threats; each section is the quadrant title followed by one short bullet per line. Give it an explicit size (about 640 × 420) so the bullets have room, and add a basic/text title above it.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Harbour Coffee Roasters — going online", { x: 0, y: 0, w: 640, h: 36 }, TITLE),
        {
          id: "swot",
          shape: "strategy/swot",
          text: [
            `Strengths\n${bullets("Award-winning roasts", "Loyal local customers", "Direct farm relationships")}`,
            `Weaknesses\n${bullets("Small marketing budget", "One roasting site", "No subscription offer yet")}`,
            `Opportunities\n${bullets("Home brewing keeps growing", "Office coffee contracts", "Marketplaces reach new regions")}`,
            `Threats\n${bullets("Rising bean prices", "Supermarket own brands", "Higher shipping costs")}`,
          ].join("\n---\n"),
          x: 0,
          y: 46,
          w: 640,
          h: 330,
          style: { fontSize: 15 },
        },
      ],
      edges: [],
    },
  },
  {
    id: "priority-matrix",
    name: "Priority matrix",
    category: "strategy",
    description: "A 2×2 grid that sorts options by two criteria, such as impact versus effort or urgent versus important.",
    keywords: ["2x2", "priority matrix", "impact effort", "eisenhower", "quadrant", "prioritisation", "urgent important", "value vs effort"],
    libraries: ["strategy", "basic"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Place one strategy/quadrant first: text lines 1–4 title the quadrants (top-left, top-right, bottom-left, bottom-right) and lines 5–6 name the X and Y axes. Then put each option on top of it as a small basic/rounded or basic/note with explicit coordinates (layout 'none'), positioned by its score on both axes and coloured by quadrant. For an Eisenhower matrix use Do / Schedule / Delegate / Delete with axes Urgency and Importance.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Q3 backlog — impact versus effort", { x: 60, y: 0, w: 580, h: 36 }, TITLE),
        { id: "matrix", shape: "strategy/quadrant", text: "Quick wins\nBig bets\nFill-ins\nTime sinks\nEffort\nImpact", x: 0, y: 46, w: 640, h: 480, style: { fontSize: 15 } },
        chip("fix-signup", "Fix the signup bug", 75, 106, "green"),
        chip("sso-button", "Google sign-in", 175, 176, "green"),
        chip("mobile-app", "Mobile app", 365, 96, "blue"),
        chip("new-pricing", "Usage-based pricing", 465, 186, "blue"),
        chip("dark-mode", "Dark mode", 75, 346, "yellow"),
        chip("footer", "Refresh the footer", 175, 426, "yellow"),
        chip("rewrite", "Rewrite the importer", 420, 376, "red"),
      ],
      edges: [],
    },
  },
  {
    id: "mind-map",
    name: "Mind map",
    category: "strategy",
    description: "Ideas branching out from one central topic, for brainstorming, note-taking and structuring a subject.",
    keywords: ["mind map", "mindmap", "brainstorm", "ideas", "radial", "spider diagram", "topic map"],
    libraries: ["org", "basic"],
    defaultShape: "org/mind-topic",
    routing: "curved",
    edgeKind: "line",
    layout: layered("right", 18, 130),
    agentGuide:
      "Use exactly one org/mind-root for the central idea, org/mind-topic for the main branches and org/mind-subtopic for their leaves; org/mind-note adds a remark. Connect parent to child with line edges (curved routing) so the map stays a strict tree, and give each main branch its own colour.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "podcast", shape: "org/mind-root", text: "Launch a podcast" },
        { id: "content", shape: "org/mind-topic", text: "Content", color: "blue" },
        { id: "format", shape: "org/mind-subtopic", text: "Interview format", style: { stroke: "#2f6fed" } },
        { id: "guests", shape: "org/mind-subtopic", text: "Guest wishlist", style: { stroke: "#2f6fed" } },
        { id: "production", shape: "org/mind-topic", text: "Production", color: "green" },
        { id: "recording", shape: "org/mind-subtopic", text: "Remote recording", style: { stroke: "#2f9e44" } },
        { id: "editing", shape: "org/mind-subtopic", text: "Editing template", style: { stroke: "#2f9e44" } },
        { id: "distribution", shape: "org/mind-topic", text: "Distribution", color: "orange" },
        { id: "platforms", shape: "org/mind-subtopic", text: "Spotify and Apple", style: { stroke: "#e8792a" } },
        { id: "website", shape: "org/mind-subtopic", text: "Show notes site", style: { stroke: "#e8792a" } },
        { id: "growth", shape: "org/mind-topic", text: "Growth", color: "purple" },
        { id: "clips", shape: "org/mind-subtopic", text: "Social clips", style: { stroke: "#7b4fe0" } },
        { id: "newsletter", shape: "org/mind-subtopic", text: "Newsletter", style: { stroke: "#7b4fe0" } },
      ],
      edges: [
        { from: "podcast", to: "content", kind: "line", color: "blue" },
        { from: "content", to: "format", kind: "line", color: "blue" },
        { from: "content", to: "guests", kind: "line", color: "blue" },
        { from: "podcast", to: "production", kind: "line", color: "green" },
        { from: "production", to: "recording", kind: "line", color: "green" },
        { from: "production", to: "editing", kind: "line", color: "green" },
        { from: "podcast", to: "distribution", kind: "line", color: "orange" },
        { from: "distribution", to: "platforms", kind: "line", color: "orange" },
        { from: "distribution", to: "website", kind: "line", color: "orange" },
        { from: "podcast", to: "growth", kind: "line", color: "purple" },
        { from: "growth", to: "clips", kind: "line", color: "purple" },
        { from: "growth", to: "newsletter", kind: "line", color: "purple" },
      ],
    },
  },
  {
    id: "concept-map",
    name: "Concept map",
    category: "strategy",
    description: "Concepts connected by labelled relationships, so each link reads as a sentence; used to explain how a topic fits together.",
    keywords: ["concept map", "knowledge map", "relationships", "linking phrases", "learning", "semantic network", "ontology"],
    libraries: ["basic", "org"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 40, 64),
    agentGuide:
      "Draw each concept as a basic/rounded node (a noun, one to three words) and connect concepts with flow edges whose text is a short linking phrase (requires, produces, is part of), so that source + label + target reads as a sentence. Unlike a mind map it is a network: a concept may have several incoming links. Put the most general concept first and colour concepts by kind.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "photosynthesis", text: "Photosynthesis", color: "green", style: { bold: true } },
        { id: "chloroplasts", text: "Chloroplasts", color: "teal" },
        { id: "sunlight", text: "Sunlight", color: "yellow" },
        { id: "water", text: "Water", color: "blue" },
        { id: "co2", text: "Carbon dioxide", color: "gray" },
        { id: "glucose", text: "Glucose", color: "orange" },
        { id: "oxygen", text: "Oxygen", color: "blue" },
        { id: "growth", text: "Plant growth", color: "green" },
      ],
      edges: [
        { from: "sunlight", to: "photosynthesis", text: "powers" },
        { from: "water", to: "photosynthesis", text: "is split by" },
        { from: "co2", to: "photosynthesis", text: "is fixed by" },
        { from: "photosynthesis", to: "chloroplasts", text: "occurs in" },
        { from: "photosynthesis", to: "glucose", text: "produces" },
        { from: "photosynthesis", to: "oxygen", text: "releases" },
        { from: "glucose", to: "growth", text: "fuels" },
      ],
    },
  },
  {
    id: "venn-diagram",
    name: "Venn diagram",
    category: "strategy",
    description: "Overlapping circles that show what two or three groups share and what is unique to each.",
    keywords: ["venn", "overlap", "intersection", "sets", "euler diagram", "comparison", "common ground"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/venn-set",
    routing: "straight",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Overlap two or three strategy/venn-set circles with explicit coordinates (layout 'none'), each with its own style.fill and style.stroke; the fills are translucent so the overlaps blend. Leave the circles' own text empty and place basic/text labels instead: one in each exclusive area, one in each intersection. No edges are used.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "desirable", shape: "strategy/venn-set", text: "", x: 0, y: 0, w: 300, h: 300, style: { fill: "#6ea3ff", stroke: "#2f6fed" } },
        { id: "feasible", shape: "strategy/venn-set", text: "", x: 200, y: 0, w: 300, h: 300, style: { fill: "#63d2a0", stroke: "#2f9e44" } },
        { id: "viable", shape: "strategy/venn-set", text: "", x: 100, y: 175, w: 300, h: 300, style: { fill: "#ffc266", stroke: "#e8792a" } },
        label("desirable-name", "Desirable", { x: 40, y: 82, w: 120, h: 24 }, { bold: true, fontSize: 16, textColor: "#123a8f" }),
        label("desirable-note", "People want it", { x: 40, y: 106, w: 120, h: 20 }, { fontSize: 12, textColor: "#123a8f" }),
        label("feasible-name", "Feasible", { x: 340, y: 82, w: 120, h: 24 }, { bold: true, fontSize: 16, textColor: "#1b5e28" }),
        label("feasible-note", "We can build it", { x: 340, y: 106, w: 120, h: 20 }, { fontSize: 12, textColor: "#1b5e28" }),
        label("viable-name", "Viable", { x: 190, y: 380, w: 120, h: 24 }, { bold: true, fontSize: 16, textColor: "#7a3e00" }),
        label("viable-note", "It pays for itself", { x: 190, y: 404, w: 120, h: 20 }, { fontSize: 12, textColor: "#7a3e00" }),
        label("no-business", "No business\nmodel", { x: 205, y: 80, w: 90, h: 36 }, { fontSize: 11 }),
        label("not-yet", "Cannot be\nbuilt yet", { x: 120, y: 240, w: 90, h: 36 }, { fontSize: 11 }),
        label("unwanted", "Nobody\nasks for it", { x: 290, y: 240, w: 90, h: 36 }, { fontSize: 11 }),
        label("sweet-spot", "Build\nthis", { x: 210, y: 180, w: 80, h: 44 }, { bold: true, fontSize: 15 }),
      ],
      edges: [],
    },
  },
  {
    id: "funnel",
    name: "Funnel",
    category: "strategy",
    description: "Stages that narrow from top to bottom, showing how many people or deals remain at each step of a conversion process.",
    keywords: ["funnel", "sales funnel", "conversion", "marketing funnel", "pipeline", "aarrr", "drop-off"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/funnel-stage",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Stack strategy/funnel-stage nodes top to bottom with explicit coordinates (layout 'none'): same height, each one narrower than the one above and centred on the same axis (about 60 px narrower per stage keeps the sides in one line). Put the stage name and its number in the text and add basic/text labels beside the funnel for the conversion rate between stages. No edges are needed.",
    support: "dedicated",
    template: { layout: "none", nodes: funnelNodes, edges: [] },
  },
  {
    id: "pyramid",
    name: "Pyramid",
    category: "strategy",
    description: "Stacked levels that build on each other, from a broad foundation to a narrow top, for hierarchies of needs, goals or priorities.",
    keywords: ["pyramid", "hierarchy", "maslow", "levels", "tiers", "strategy pyramid", "triangle"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/pyramid-level",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Stack strategy/pyramid-level nodes with explicit coordinates (layout 'none'), touching, centred on one axis and each wider than the one above; set data.top to true on the first one to draw the pointed tip. Keep one side slope for the whole stack (widen each level by 1.2 × its height) and add basic/text notes to the right of each level. No edges are needed.",
    support: "dedicated",
    template: { layout: "none", nodes: pyramidNodes, edges: [] },
  },
  {
    id: "business-model-canvas",
    name: "Business model canvas",
    category: "strategy",
    description: "The nine building blocks of a business model on one page: customers, value proposition, channels, operations, costs and revenue.",
    keywords: ["business model canvas", "bmc", "osterwalder", "lean canvas", "value proposition", "startup", "business plan"],
    libraries: ["strategy", "basic"],
    defaultShape: "basic/note",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Lay out the nine blocks in the canonical arrangement with explicit coordinates (layout 'none'): key partners, key activities over key resources, value propositions, customer relationships over channels, customer segments, then cost structure and revenue streams side by side underneath. Draw each block as a strategy/kanban-column container titled with the block name, holding a basic/text bullet list (or one basic/note per idea) with `parent` set to the block.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        ...panel("partners", "Key partners", bullets("Organic farms", "Courier network", "Packaging supplier"), { x: 0, y: 0, w: 200, h: 400 }, "blue"),
        ...panel("activities", "Key activities", bullets("Recipe development", "Sourcing and packing", "Last-mile delivery"), { x: 210, y: 0, w: 200, h: 195 }, "blue"),
        ...panel("resources", "Key resources", bullets("Fulfilment kitchens", "Recipe library", "Subscriber data"), { x: 210, y: 205, w: 200, h: 195 }, "blue"),
        ...panel("value", "Value propositions", bullets("Dinner in 20 minutes", "No food waste", "New recipes every week", "Skip or pause any time"), { x: 420, y: 0, w: 200, h: 400 }, "yellow"),
        ...panel("relationships", "Customer relationships", bullets("Flexible subscription", "In-app support chat", "Cooking community"), { x: 630, y: 0, w: 200, h: 195 }, "green"),
        ...panel("channels", "Channels", bullets("Mobile app", "Social media ads", "Referral codes"), { x: 630, y: 205, w: 200, h: 195 }, "green"),
        ...panel("segments", "Customer segments", bullets("Busy professionals", "Young families", "Beginner cooks"), { x: 840, y: 0, w: 200, h: 400 }, "green"),
        ...panel("costs", "Cost structure", bullets("Ingredients and packaging", "Delivery fees", "Marketing and discounts"), { x: 0, y: 410, w: 515, h: 130 }, "gray"),
        ...panel("revenue", "Revenue streams", bullets("Weekly box subscription", "Premium recipes and add-ons", "Gift cards"), { x: 525, y: 410, w: 515, h: 130 }, "gray"),
      ],
      edges: [],
    },
  },
  {
    id: "stakeholder-map",
    name: "Stakeholder map",
    category: "strategy",
    description: "A power / interest grid that places everyone affected by a project and shows how closely to involve each of them.",
    keywords: ["stakeholder map", "stakeholder analysis", "power interest grid", "influence", "mendelow", "engagement"],
    libraries: ["strategy", "basic", "org"],
    defaultShape: "basic/pill",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Place one strategy/quadrant with the text 'Keep satisfied\\nManage closely\\nMonitor\\nKeep informed\\nInterest\\nPower' (power on the Y axis, interest on the X axis). Then add each stakeholder as a basic/pill on top with explicit coordinates (layout 'none'): higher means more power, further right means more interest. Colour by attitude (green supporter, yellow neutral, red blocker).",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Warehouse system replacement — stakeholders", { x: 60, y: 0, w: 580, h: 36 }, TITLE),
        { id: "grid", shape: "strategy/quadrant", text: "Keep satisfied\nManage closely\nMonitor\nKeep informed\nInterest\nPower", x: 0, y: 46, w: 640, h: 460, style: { fontSize: 15 } },
        chip("cfo", "Finance director", 75, 106, "yellow", "basic/pill"),
        chip("legal", "Legal counsel", 175, 186, "yellow", "basic/pill"),
        chip("operations", "Operations director", 465, 96, "green", "basic/pill"),
        chip("managers", "Warehouse managers", 365, 176, "red", "basic/pill"),
        chip("helpdesk", "IT helpdesk", 75, 326, "yellow", "basic/pill"),
        chip("suppliers", "Hardware supplier", 175, 406, "green", "basic/pill"),
        chip("pickers", "Pickers and packers", 365, 396, "red", "basic/pill"),
        chip("service", "Customer service", 465, 316, "green", "basic/pill"),
        { id: "key", shape: "strategy/legend", text: "Attitude\n---\n#2f9e44 Supporter\n#d99a00 Neutral\n#e03131 Sceptical", x: 660, y: 46 },
      ],
      edges: [],
    },
  },
  {
    id: "okr-tree",
    name: "OKR tree",
    category: "strategy",
    description: "An objective broken down into measurable key results and the initiatives that should move them.",
    keywords: ["okr", "objectives and key results", "goal tree", "kpi tree", "goals", "initiatives", "strategy cascade"],
    libraries: ["strategy", "basic", "org"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "line",
    layout: layered("down", 28, 44),
    agentGuide:
      "Put the objective at the top as a basic/rounded node, each key result under it as a strategy/kpi-card (text: target value, what is measured, then the baseline or change) and the initiatives under their key result as basic/rounded nodes. Connect parent to child with line edges and keep it a strict tree: one objective, two to four key results, a few initiatives each.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "objective", text: "Objective\nMake onboarding effortless", color: "purple", style: { bold: true } },
        { id: "activation", shape: "strategy/kpi-card", text: "40 %\nWeek-one activation\n+12 points from 28 %" },
        { id: "time", shape: "strategy/kpi-card", text: "5 min\nTime to first project\nDown from 12 minutes" },
        { id: "nps", shape: "strategy/kpi-card", text: "50\nOnboarding NPS\n+18 points from 32" },
        { id: "tour", text: "Guided product tour", color: "gray", style: { fontSize: 13 } },
        { id: "checklist", text: "Getting-started checklist", color: "gray", style: { fontSize: 13 } },
        { id: "import", text: "One-click import", color: "gray", style: { fontSize: 13 } },
        { id: "templates", text: "Template gallery", color: "gray", style: { fontSize: 13 } },
        { id: "chat", text: "Live chat in week one", color: "gray", style: { fontSize: 13 } },
      ],
      edges: [
        { from: "objective", to: "activation", kind: "line" },
        { from: "objective", to: "time", kind: "line" },
        { from: "objective", to: "nps", kind: "line" },
        { from: "activation", to: "tour", kind: "line" },
        { from: "activation", to: "checklist", kind: "line" },
        { from: "time", to: "import", kind: "line" },
        { from: "time", to: "templates", kind: "line" },
        { from: "nps", to: "chat", kind: "line" },
      ],
    },
  },
  {
    id: "porters-five-forces",
    name: "Porter's five forces",
    category: "strategy",
    description: "The five competitive pressures on an industry: rivalry, new entrants, substitutes, and the bargaining power of suppliers and buyers.",
    keywords: ["porter", "five forces", "competitive analysis", "industry analysis", "competition", "market forces"],
    libraries: ["strategy", "basic"],
    defaultShape: "strategy/kanban-card",
    routing: "straight",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "There is no dedicated shape: place five strategy/kanban-card nodes in a cross with explicit coordinates (layout 'none'), competitive rivalry in the centre, threat of new entrants above, threat of substitutes below, supplier power on the left and buyer power on the right. Each card's text is the force, then a one-line assessment; colour it by pressure (red high, yellow medium, green low) and draw a flow edge from each outer force to the centre.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        { id: "entrants", shape: "strategy/kanban-card", text: "Threat of new entrants\nLow: licences and studios are costly", x: 290, y: 0, w: 240, h: 80, color: "green" },
        { id: "suppliers", shape: "strategy/kanban-card", text: "Supplier power\nHigh: few studios own the hit shows", x: 0, y: 170, w: 240, h: 80, color: "red" },
        { id: "rivalry", shape: "strategy/kanban-card", text: "Competitive rivalry\nHigh: six services fight for the same evenings", x: 290, y: 160, w: 240, h: 100, color: "red", style: { fontSize: 14 } },
        { id: "buyers", shape: "strategy/kanban-card", text: "Buyer power\nMedium: cancelling takes one click", x: 580, y: 170, w: 240, h: 80, color: "yellow" },
        { id: "substitutes", shape: "strategy/kanban-card", text: "Threat of substitutes\nHigh: games, short video, free TV", x: 290, y: 340, w: 240, h: 80, color: "red" },
        { id: "key", shape: "strategy/legend", text: "Pressure\n---\n#e03131 High\n#d99a00 Medium\n#2f9e44 Low", x: 690, y: 0 },
        label("title", "Video streaming\nmarket", { x: 0, y: 0, w: 240, h: 56 }, TITLE),
      ],
      edges: [
        { from: "entrants", to: "rivalry" },
        { from: "suppliers", to: "rivalry" },
        { from: "buyers", to: "rivalry" },
        { from: "substitutes", to: "rivalry" },
      ],
    },
  },
  {
    id: "pestle",
    name: "PESTLE analysis",
    category: "strategy",
    description: "The political, economic, social, technological, legal and environmental factors that shape the market around an organisation.",
    keywords: ["pestle", "pest", "pestel", "steep", "macro environment", "external analysis", "market scan"],
    libraries: ["strategy", "basic"],
    defaultShape: "basic/note",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Draw six panels in a 3 × 2 grid with explicit coordinates (layout 'none'): Political, Economic, Social, Technological, Legal, Environmental (drop the last two for a plain PEST). Each panel is a strategy/kanban-column container titled with the factor and holding a basic/text bullet list (`parent` set to the panel) of two to four external factors. No edges are needed.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        label("title", "E-scooter sharing in European cities", { x: 0, y: 0, w: 780, h: 36 }, TITLE),
        ...panel("political", "Political", bullets("City permits cap fleet sizes", "Subsidies for low-emission transport", "Elections may change parking rules"), { x: 0, y: 46, w: 250, h: 160 }, "blue"),
        ...panel("economic", "Economic", bullets("Fuel prices push people off cars", "Higher interest rates on fleet loans", "Tourism drives summer demand"), { x: 265, y: 46, w: 250, h: 160 }, "green"),
        ...panel("social", "Social", bullets("Younger riders avoid car ownership", "Safety concerns after accidents", "Complaints about pavement clutter"), { x: 530, y: 46, w: 250, h: 160 }, "yellow"),
        ...panel("technological", "Technological", bullets("Swappable batteries cut downtime", "Geofencing enforces slow zones", "Better theft tracking"), { x: 0, y: 221, w: 250, h: 160 }, "purple"),
        ...panel("legal", "Legal", bullets("Helmet and age rules vary by country", "Liability for rider injuries", "Data protection for trip data"), { x: 265, y: 221, w: 250, h: 160 }, "orange"),
        ...panel("environmental", "Environmental", bullets("Battery recycling obligations", "Short vehicle lifespan", "Low-emission zones favour scooters"), { x: 530, y: 221, w: 250, h: 160 }, "teal"),
      ],
      edges: [],
    },
  },
  {
    id: "argument-map",
    name: "Argument map",
    category: "strategy",
    description: "A claim with the reasons that support it, the objections against it and the evidence behind each, to weigh a decision or debate.",
    keywords: ["argument map", "pros and cons", "debate", "reasoning", "claim", "evidence", "critical thinking", "issue tree"],
    libraries: ["basic", "flowchart"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("up", 36, 64),
    agentGuide:
      "Put the main claim at the top as a basic/rounded node; draw supporting reasons in green and objections in red, and evidence or rebuttals below the statement they address as basic/rect nodes. Every edge is a flow edge pointing from the reason to the statement it bears on, labelled 'supports' or 'opposes' (colour the edge to match). Use the layered layout with direction 'up' so the claim ends on top.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "claim", text: "Public transport in our city\nshould be free", color: "blue", style: { bold: true } },
        { id: "traffic", text: "Fewer car trips mean\nless congestion", color: "green" },
        { id: "access", text: "Low-income residents\ngain mobility", color: "green" },
        { id: "cost", text: "The city loses €40m\nin fares every year", color: "red" },
        { id: "tallinn", shape: "basic/rect", text: "Tallinn: ridership up 14 %\nafter fares were dropped", color: "gray", style: { fontSize: 12 } },
        { id: "survey", shape: "basic/rect", text: "Survey: fares are the top\nbarrier for 1 in 5 residents", color: "gray", style: { fontSize: 12 } },
        { id: "savings", text: "Ticketing and inspection\ncosts disappear", color: "green", style: { fontSize: 12 } },
      ],
      edges: [
        { from: "traffic", to: "claim", text: "supports", color: "green" },
        { from: "access", to: "claim", text: "supports", color: "green" },
        { from: "cost", to: "claim", text: "opposes", color: "red" },
        { from: "tallinn", to: "traffic", text: "supports", color: "green" },
        { from: "survey", to: "access", text: "supports", color: "green" },
        { from: "savings", to: "cost", text: "opposes", color: "red" },
      ],
    },
  },
];
