import type { EdgeSpec, NodeSpec } from "../../spec/apply";
import { force, FREEFORM, label, layered, MUTED_TEXT, tree } from "../presets";
import type { DiagramTypeDef } from "../types";

/** Signal and terminal names next to a schematic. */
const SIGNAL = { fontSize: 14, bold: true } as const;

/* -------------------------------------------------------------- petri net */

const PLACE = 64;

/** A place with its name underneath. */
function place(id: string, name: string, x: number, y: number, marked: number): NodeSpec[] {
  return [
    { id, shape: "basic/circle", x, y, w: PLACE, h: PLACE, color: marked ? "yellow" : "blue" },
    label(`${id}-name`, name, { x: x - 28, y: y + PLACE + 4, w: PLACE + 56, h: 20 }, { fontSize: 12 }),
  ];
}

/** Token dots spread around the centre of the place at (x, y). */
function tokens(id: string, x: number, y: number, count: number): NodeSpec[] {
  const spots = count === 2 ? [[-9, 0], [9, 0]] : [[-9, -7], [9, -7], [0, 9]];
  return spots.slice(0, count).map(([dx, dy], index) => ({
    id: `${id}-token-${index + 1}`,
    shape: "basic/circle",
    x: x + PLACE / 2 + dx - 5,
    y: y + PLACE / 2 + dy - 5,
    w: 10,
    h: 10,
    color: "dark",
  }));
}

/** A transition bar with its name above. */
function transition(id: string, name: string, x: number, y: number): NodeSpec[] {
  return [
    { id, shape: "basic/rect", x, y, w: 20, h: PLACE, color: "dark" },
    label(`${id}-name`, name, { x: x - 50, y: y - 26, w: 120, h: 20 }, { fontSize: 12 }),
  ];
}

/* ------------------------------------------------------------ family tree */

const PERSON = 52;

/** Genogram person: a square for a man, a circle for a woman, with name and dates underneath. */
function person(id: string, name: string, dates: string, sex: "m" | "f", x: number, y: number): NodeSpec[] {
  return [
    { id, shape: sex === "m" ? "basic/rect" : "basic/circle", x, y, w: PERSON, h: PERSON, color: sex === "m" ? "blue" : "purple" },
    label(`${id}-name`, name, { x: x - 24, y: y + PERSON + 4, w: PERSON + 48, h: 18 }, { fontSize: 13, bold: true }),
    label(`${id}-dates`, dates, { x: x - 24, y: y + PERSON + 22, w: PERSON + 48, h: 16 }, { ...MUTED_TEXT, fontSize: 11 }),
  ];
}

/** Marriage line between two partners plus the dot their children hang from. */
function couple(id: string, left: string, right: string, x: number, y: number): { nodes: NodeSpec[]; edges: EdgeSpec[] } {
  return {
    nodes: [{ id, shape: "engineering/junction", x: x - 4, y: y + PERSON / 2 - 4, w: 8, h: 8 }],
    edges: [{ from: left, to: right, kind: "line", routing: "straight", fromAnchor: "right", toAnchor: "left" }],
  };
}

const child = (union: string, to: string): EdgeSpec => ({ from: union, to, kind: "line", fromAnchor: "bottom", toAnchor: "top" });

const grandparents = couple("george-mary", "george", "mary", 326, 0);
const parents = couple("peter-anna", "peter", "anna", 186, 170);

/* ------------------------------------------------------------------ types */

export const ENGINEERING_TYPES: DiagramTypeDef[] = [
  {
    id: "logic-circuit",
    name: "Logic circuit",
    category: "engineering",
    description: "Digital logic drawn with gates and wires, showing how inputs combine into outputs.",
    keywords: ["logic gates", "digital circuit", "boolean", "and or not", "half adder", "combinational logic", "schematic", "flip-flop"],
    libraries: ["engineering", "basic"],
    defaultShape: "engineering/and-gate",
    routing: "orthogonal",
    edgeKind: "line",
    layout: layered("right", 40, 80),
    agentGuide:
      "Use engineering/and-gate, engineering/or-gate, engineering/xor-gate, engineering/not-gate, engineering/nand-gate, engineering/nor-gate (data.inputs sets the input count) and engineering/flip-flop, with basic/text for input and output names. Wires are line edges with orthogonal routing: a gate's output is the anchor {x: 1, y: 0.5} and its inputs sit on the left edge at y = (i + 0.5) / inputs (0.25 and 0.75 for two inputs), so pass fromAnchor / toAnchor explicitly. Mark a branching wire with an engineering/junction dot.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("title", "Half adder", { x: 0, y: 0, w: 200, h: 30 }, { bold: true, fontSize: 18, align: "left" }),
        label("a", "A", { x: 0, y: 62, w: 30, h: 24 }, SIGNAL),
        label("b", "B", { x: 0, y: 90, w: 30, h: 24 }, SIGNAL),
        { id: "a-branch", shape: "engineering/junction", x: 84, y: 68, w: 12, h: 12 },
        { id: "b-branch", shape: "engineering/junction", x: 124, y: 96, w: 12, h: 12 },
        { id: "xor", shape: "engineering/xor-gate", x: 200, y: 60, w: 100, h: 56 },
        { id: "and", shape: "engineering/and-gate", x: 200, y: 180, w: 100, h: 56 },
        label("sum", "Sum", { x: 350, y: 76, w: 50, h: 24 }, SIGNAL),
        label("carry", "Carry", { x: 350, y: 196, w: 50, h: 24 }, SIGNAL),
        {
          id: "truth-table",
          shape: "basic/table",
          text: "A | B | Sum | Carry\n0 | 0 | 0 | 0\n0 | 1 | 1 | 0\n1 | 0 | 1 | 0\n1 | 1 | 0 | 1",
          x: 460,
          y: 60,
          w: 250,
          h: 176,
          style: { align: "center", fontFamily: "mono" },
        },
      ],
      edges: [
        { from: "a", to: "a-branch", kind: "line", fromAnchor: "right", toAnchor: "left" },
        { from: "b", to: "b-branch", kind: "line", fromAnchor: "right", toAnchor: "left" },
        { from: "a-branch", to: "xor", kind: "line", fromAnchor: "right", toAnchor: { x: 0, y: 0.25 } },
        { from: "b-branch", to: "xor", kind: "line", fromAnchor: "right", toAnchor: { x: 0, y: 0.75 } },
        { from: "a-branch", to: "and", kind: "line", fromAnchor: "bottom", toAnchor: { x: 0, y: 0.25 } },
        { from: "b-branch", to: "and", kind: "line", fromAnchor: "bottom", toAnchor: { x: 0, y: 0.75 } },
        { from: "xor", to: "sum", kind: "line", fromAnchor: { x: 1, y: 0.5 }, toAnchor: "left" },
        { from: "and", to: "carry", kind: "line", fromAnchor: { x: 1, y: 0.5 }, toAnchor: "left" },
      ],
    },
  },
  {
    id: "electrical-circuit",
    name: "Electrical circuit",
    category: "engineering",
    description: "A basic electrical schematic: sources, switches, resistors, LEDs and other components joined by wires into a circuit.",
    keywords: ["circuit diagram", "schematic", "electronics", "resistor", "battery", "led", "wiring", "electrical"],
    libraries: ["engineering", "basic"],
    defaultShape: "engineering/resistor",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Place components with explicit coordinates (layout 'none'): engineering/battery or engineering/dc-source, engineering/switch, engineering/resistor, engineering/capacitor, engineering/led, engineering/lamp, engineering/ground; put the designator and value in the text (R1 330 Ω), it is drawn under the symbol. Every component has its terminals at the left and right centre (engineering/ground at the top centre), so wire them with line edges using fromAnchor / toAnchor 'left' or 'right' and orthogonal routing, and use engineering/junction dots where wires join. Symbols are basic and horizontal only; this is not a full EDA notation.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "switch", shape: "engineering/switch", text: "SW1", x: 110, y: 14, w: 80, h: 32 },
        { id: "resistor", shape: "engineering/resistor", text: "R1 330 Ω", x: 260, y: 18, w: 90, h: 24 },
        { id: "led", shape: "engineering/led", text: "LED1 red", x: 420, y: 4, w: 70, h: 52 },
        { id: "battery", shape: "engineering/battery", text: "B1 9 V", x: 265, y: 172, w: 70, h: 36 },
        { id: "node", shape: "engineering/junction", x: 514, y: 184, w: 12, h: 12 },
        { id: "ground", shape: "engineering/ground", x: 502, y: 230, w: 36, h: 32 },
        label("plus", "+", { x: 240, y: 160, w: 20, h: 20 }, { fontSize: 14, textColor: "#e03131", bold: true }),
        label("minus", "−", { x: 340, y: 160, w: 20, h: 20 }, { fontSize: 14, bold: true }),
      ],
      edges: [
        { from: "battery", to: "switch", kind: "line", fromAnchor: "left", toAnchor: "left" },
        { from: "switch", to: "resistor", kind: "line", routing: "straight", fromAnchor: "right", toAnchor: "left" },
        { from: "resistor", to: "led", kind: "line", routing: "straight", fromAnchor: "right", toAnchor: "left" },
        { from: "led", to: "node", kind: "line", fromAnchor: "right", toAnchor: "top" },
        { from: "node", to: "battery", kind: "line", routing: "straight", fromAnchor: "left", toAnchor: "right" },
        { from: "node", to: "ground", kind: "line", routing: "straight", fromAnchor: "bottom", toAnchor: "top" },
      ],
    },
  },
  {
    id: "control-block-diagram",
    name: "Control block diagram",
    category: "engineering",
    description: "A control system as signal-flow blocks: summing points, transfer-function blocks and feedback loops.",
    keywords: ["control system", "block diagram", "feedback loop", "transfer function", "pid", "closed loop", "signal flow"],
    libraries: ["engineering", "basic"],
    defaultShape: "engineering/block",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 48, 64),
    agentGuide:
      "Use engineering/block for each transfer function (name and G(s) in the text), engineering/summing-point where signals are compared (data.signs gives the signs of its left, bottom and top inputs, e.g. '+-' for negative feedback), engineering/takeoff-point where a signal branches, engineering/gain and engineering/integrator for those elements, and basic/text for signal names. Signals are flow edges, named with a small basic/text above the wire (E(s), U(s)); draw the forward path left to right and route the feedback path underneath into the bottom of the summing point with explicit fromAnchor / toAnchor.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        label("reference", "R(s)", { x: 0, y: 38, w: 50, h: 24 }, SIGNAL),
        { id: "sum", shape: "engineering/summing-point", x: 100, y: 28, w: 44, h: 44, data: { signs: "+-" } },
        label("error", "E(s)", { x: 150, y: 22, w: 70, h: 20 }, MUTED_TEXT),
        { id: "controller", shape: "engineering/block", text: "Controller\nC(s)", x: 230, y: 20, w: 130, h: 60, color: "blue", style: { fontSize: 13 } },
        label("control", "U(s)", { x: 365, y: 22, w: 70, h: 20 }, MUTED_TEXT),
        { id: "plant", shape: "engineering/block", text: "Plant\nG(s)", x: 440, y: 20, w: 130, h: 60, color: "green", style: { fontSize: 13 } },
        { id: "takeoff", shape: "engineering/takeoff-point", x: 624, y: 44, w: 12, h: 12 },
        label("output", "Y(s)", { x: 690, y: 38, w: 50, h: 24 }, SIGNAL),
        { id: "sensor", shape: "engineering/block", text: "Sensor\nH(s)", x: 335, y: 170, w: 130, h: 60, color: "yellow", style: { fontSize: 13 } },
        label("feedback", "Measured output", { x: 150, y: 176, w: 170, h: 20 }, MUTED_TEXT),
      ],
      edges: [
        { from: "reference", to: "sum", fromAnchor: "right", toAnchor: "left" },
        { from: "sum", to: "controller", fromAnchor: "right", toAnchor: "left" },
        { from: "controller", to: "plant", fromAnchor: "right", toAnchor: "left" },
        { from: "plant", to: "takeoff", kind: "line", fromAnchor: "right", toAnchor: "left" },
        { from: "takeoff", to: "output", fromAnchor: "right", toAnchor: "left" },
        { from: "takeoff", to: "sensor", fromAnchor: "bottom", toAnchor: "right" },
        { from: "sensor", to: "sum", fromAnchor: "left", toAnchor: "bottom" },
      ],
    },
  },
  {
    id: "finite-automaton",
    name: "Finite automaton",
    category: "engineering",
    description: "States and labelled transitions of a finite-state machine that accepts or rejects input strings.",
    keywords: ["finite automaton", "dfa", "nfa", "state transition diagram", "fsm", "automata", "regular language", "state diagram"],
    libraries: ["basic", "er", "uml"],
    defaultShape: "basic/circle",
    routing: "curved",
    edgeKind: "flow",
    layout: layered("right", 60, 90),
    agentGuide:
      "There is no automaton library: draw each state as a basic/circle (w = h, about 64) named q0, q1…, and each accepting state as a double circle using er/multivalued-attribute with equal w and h. Mark the start state with a flow edge coming from a small basic/text node 'start'. Transitions are flow edges with curved routing whose text is the input symbol(s); a self-loop is an edge from a state to itself. For UML statecharts use the uml-state-machine type instead.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        label("start", "start", { x: 0, y: 60, w: 44, h: 24 }, MUTED_TEXT),
        { id: "q0", text: "q0", x: 100, y: 40, w: 64, h: 64, color: "blue" },
        { id: "q1", text: "q1", x: 280, y: 40, w: 64, h: 64, color: "blue" },
        { id: "q2", shape: "er/multivalued-attribute", text: "q2", x: 460, y: 38, w: 68, h: 68, color: "green" },
        label("caption", "Accepts binary strings that end in 01", { x: 100, y: 250, w: 430, h: 24 }, MUTED_TEXT),
      ],
      edges: [
        { from: "start", to: "q0" },
        { from: "q0", to: "q1", text: "0" },
        { from: "q1", to: "q2", text: "1" },
        { from: "q2", to: "q1", text: "0", fromAnchor: { x: 0.3, y: 1 }, toAnchor: "bottom" },
        { from: "q2", to: "q0", text: "1", fromAnchor: { x: 0.7, y: 1 }, toAnchor: "bottom" },
        { from: "q0", to: "q0", text: "1" },
        { from: "q1", to: "q1", text: "0" },
      ],
    },
  },
  {
    id: "petri-net",
    name: "Petri net",
    category: "engineering",
    description: "Places, transitions and tokens modelling concurrent processes, shared resources and synchronisation.",
    keywords: ["petri net", "places and transitions", "tokens", "concurrency", "workflow net", "marking", "synchronisation"],
    libraries: ["basic", "flowchart"],
    defaultShape: "basic/circle",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("right", 40, 56),
    agentGuide:
      "There is no Petri net library: draw each place as an empty basic/circle (w = h, about 64), each token as a small dark basic/circle placed inside its place, and each transition as a narrow dark basic/rect bar; name places and transitions with basic/text beside them. Arcs are flow edges and always alternate place → transition → place, never place to place; put an arc weight above 1 in the edge text. Position everything explicitly (layout 'none') when tokens are shown.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        ...place("waiting", "Orders waiting", 0, 30, 3),
        ...tokens("waiting", 0, 30, 3),
        ...transition("start", "Start packing", 142, 30),
        ...place("packing", "Being packed", 240, 30, 0),
        ...transition("finish", "Finish packing", 382, 30),
        ...place("ready", "Ready to ship", 480, 30, 0),
        ...place("free", "Free packers", 240, 170, 2),
        ...tokens("free", 240, 170, 2),
      ],
      edges: [
        { from: "waiting", to: "start", routing: "straight" },
        { from: "start", to: "packing", routing: "straight" },
        { from: "packing", to: "finish", routing: "straight" },
        { from: "finish", to: "ready", routing: "straight" },
        { from: "free", to: "start", routing: "curved", fromAnchor: "left", toAnchor: "bottom" },
        { from: "finish", to: "free", routing: "curved", fromAnchor: "bottom", toAnchor: "right" },
      ],
    },
  },
  {
    id: "network-graph",
    name: "Network graph",
    category: "engineering",
    description: "Vertices and edges of a mathematical graph, optionally weighted or directed, for algorithms, relationships and network analysis.",
    keywords: ["graph theory", "network graph", "nodes and edges", "vertices", "weighted graph", "shortest path", "dijkstra", "social network"],
    libraries: ["basic"],
    defaultShape: "basic/circle",
    routing: "straight",
    edgeKind: "line",
    layout: force(150),
    agentGuide:
      "Draw each vertex as a basic/circle (w = h, about 48) with a short name, and each edge as a line edge with straight routing (use the flow kind for a directed graph); put weights in the edge text. Leave out coordinates so the force layout spreads the graph, and highlight a path or cluster with colour on both its vertices and edges.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "a", text: "A", w: 48, h: 48, color: "green", style: { bold: true } },
        { id: "b", text: "B", w: 48, h: 48, style: { bold: true } },
        { id: "c", text: "C", w: 48, h: 48, color: "green", style: { bold: true } },
        { id: "d", text: "D", w: 48, h: 48, style: { bold: true } },
        { id: "e", text: "E", w: 48, h: 48, color: "green", style: { bold: true } },
        { id: "f", text: "F", w: 48, h: 48, color: "green", style: { bold: true } },
        { id: "g", text: "G", w: 48, h: 48, style: { bold: true } },
      ],
      edges: [
        { from: "a", to: "b", text: "7", kind: "line" },
        { from: "a", to: "c", text: "2", kind: "line", color: "green", style: { strokeWidth: 3 } },
        { from: "b", to: "d", text: "3", kind: "line" },
        { from: "c", to: "d", text: "6", kind: "line" },
        { from: "c", to: "e", text: "4", kind: "line", color: "green", style: { strokeWidth: 3 } },
        { from: "d", to: "f", text: "5", kind: "line" },
        { from: "e", to: "f", text: "1", kind: "line", color: "green", style: { strokeWidth: 3 } },
        { from: "e", to: "g", text: "8", kind: "line" },
        { from: "f", to: "g", text: "9", kind: "line" },
      ],
    },
  },
  {
    id: "tree-diagram",
    name: "Tree diagram",
    category: "engineering",
    description: "A strict hierarchy of parent and child nodes, such as a binary search tree, a taxonomy or a parse tree.",
    keywords: ["tree", "hierarchy", "binary tree", "bst", "taxonomy", "parse tree", "dendrogram", "data structure"],
    libraries: ["basic"],
    defaultShape: "basic/circle",
    routing: "straight",
    edgeKind: "line",
    layout: tree("down", 28, 28),
    agentGuide:
      "Draw each node as a basic/circle (data structures) or basic/rounded (taxonomies, with longer labels) and connect every parent to its children with line edges and straight routing. Keep it a strict tree: one root and exactly one incoming edge for every other node, children listed left to right; the tree layout does the rest.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "n50", text: "50", w: 52, h: 52, color: "blue", style: { bold: true } },
        { id: "n30", text: "30", w: 52, h: 52 },
        { id: "n70", text: "70", w: 52, h: 52 },
        { id: "n20", text: "20", w: 52, h: 52, color: "gray" },
        { id: "n40", text: "40", w: 52, h: 52, color: "gray" },
        { id: "n60", text: "60", w: 52, h: 52, color: "gray" },
        { id: "n80", text: "80", w: 52, h: 52 },
        { id: "n75", text: "75", w: 52, h: 52, color: "gray" },
        { id: "n90", text: "90", w: 52, h: 52, color: "gray" },
      ],
      edges: [
        { from: "n50", to: "n30", kind: "line" },
        { from: "n50", to: "n70", kind: "line" },
        { from: "n30", to: "n20", kind: "line" },
        { from: "n30", to: "n40", kind: "line" },
        { from: "n70", to: "n60", kind: "line" },
        { from: "n70", to: "n80", kind: "line" },
        { from: "n80", to: "n75", kind: "line" },
        { from: "n80", to: "n90", kind: "line" },
      ],
    },
  },
  {
    id: "family-tree",
    name: "Family tree",
    category: "engineering",
    description: "Generations of a family with partners and children, in the square-and-circle style of a genogram or pedigree chart.",
    keywords: ["family tree", "genogram", "genealogy", "pedigree", "ancestry", "kinship", "relatives"],
    libraries: ["basic", "engineering", "org"],
    defaultShape: "basic/rect",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "There are no genogram symbols: draw men as square basic/rect and women as basic/circle (same w and h) with the name inside and the dates as basic/text underneath, one generation per row with explicit coordinates (layout 'none'). Join partners with a straight line edge, put a small engineering/junction dot in the middle of that line, and hang each child from the dot with a line edge (fromAnchor 'bottom', toAnchor 'top', orthogonal routing). Medical and relationship markers of full genograms are not available.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        ...person("george", "George", "1948 – 2019", "m", 240, 0),
        ...person("mary", "Mary", "b. 1951", "f", 360, 0),
        ...grandparents.nodes,
        ...person("peter", "Peter", "b. 1974", "m", 100, 170),
        ...person("anna", "Anna", "b. 1976", "f", 220, 170),
        ...parents.nodes,
        ...person("tom", "Tom", "b. 1980", "m", 420, 170),
        ...person("lucy", "Lucy", "b. 2004", "f", 100, 340),
        ...person("max", "Max", "b. 2007", "m", 220, 340),
      ],
      edges: [
        ...grandparents.edges,
        ...parents.edges,
        child("george-mary", "anna"),
        child("george-mary", "tom"),
        child("peter-anna", "lucy"),
        child("peter-anna", "max"),
      ],
    },
  },
];
