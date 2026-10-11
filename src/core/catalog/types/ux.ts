import type { NodeStyle } from "../../model/types";
import type { NodeSpec } from "../../spec/apply";
import { bullets, FREEFORM, label, layered, MUTED_TEXT, panel, type Box } from "../presets";
import type { DiagramTypeDef } from "../types";

/* --------------------------------------------------------- mobile screens */

const PHONE = { w: 250, h: 500, gap: 80, inset: 18 };
const phoneX = (index: number): number => index * (PHONE.w + PHONE.gap);

/** A control inside a phone: `dx` / `dy` are relative to the phone's top-left corner. */
function onPhone(phone: string, index: number, id: string, shape: string, text: string, dx: number, dy: number, w: number, h: number, extra: Partial<NodeSpec> = {}): NodeSpec {
  return { id, shape, text, parent: phone, x: phoneX(index) + dx, y: dy, w, h, ...extra };
}

/* -------------------------------------------------------------- storyboard */

const STORY = { w: 240, imageH: 150, captionH: 48, gapX: 30, gapY: 28 };

const STORY_PANELS: { id: string; scene: string; caption: string }[] = [
  { id: "wait", scene: "Bus stop in the rain", caption: "Ana waits in the rain. The timetable says her bus left ten minutes ago." },
  { id: "check", scene: "Phone in her hand", caption: "She opens NextBus and sees the real arrival time: four minutes." },
  { id: "coffee", scene: "Café across the street", caption: "Just enough time to grab a coffee instead of getting soaked." },
  { id: "alert", scene: "Notification on the phone", caption: "The app buzzes when the bus is one stop away." },
  { id: "board", scene: "Stepping onto the bus", caption: "She boards with the ticket she already bought in the app." },
  { id: "arrive", scene: "Office entrance", caption: "Ana arrives dry, on time and a little less stressed." },
];

const storyboardNodes: NodeSpec[] = STORY_PANELS.flatMap((panelDef, index) => {
  const x = (index % 3) * (STORY.w + STORY.gapX);
  const y = Math.floor(index / 3) * (STORY.imageH + STORY.captionH + STORY.gapY);
  return [
    { id: panelDef.id, shape: "wireframe/image", text: panelDef.scene, x, y, w: STORY.w, h: STORY.imageH },
    { id: `${panelDef.id}-step`, shape: "strategy/step-circle", text: String(index + 1), x: x - 12, y: y - 12, w: 32, h: 32, style: { fontSize: 14 } },
    label(`${panelDef.id}-caption`, panelDef.caption, { x, y: y + STORY.imageH + 6, w: STORY.w, h: STORY.captionH - 6 }, { fontSize: 12, align: "left", valign: "top" }),
  ];
});

/* ---------------------------------------------------------- user story map */

const STORY_MAP = { left: 100, columnW: 150, gap: 12, cardH: 54 };
const storyMapX = (column: number): number => STORY_MAP.left + column * (STORY_MAP.columnW + STORY_MAP.gap);
const STORY_MAP_WIDTH = storyMapX(5) - STORY_MAP.gap;
const STORY_MAP_ROWS = { activities: 0, tasks: 58, release1: 138, release2: 220, later: 302 };

const storyMapCaption = (id: string, text: string, y: number): NodeSpec =>
  label(id, text, { x: 0, y, w: STORY_MAP.left - 10, h: STORY_MAP.cardH }, { ...MUTED_TEXT, bold: true, align: "left" });

/** One row of sticky notes; an empty string leaves the column free. */
const storyMapRow = (id: string, y: number, color: string, notes: string[]): NodeSpec[] =>
  notes.flatMap((text, column) =>
    text
      ? [{ id: `${id}-${column + 1}`, shape: "basic/note", text, x: storyMapX(column), y, w: STORY_MAP.columnW, h: STORY_MAP.cardH, color, style: { fontSize: 13 } }]
      : [],
  );

const storyMapSlice = (id: string, y: number): NodeSpec => ({
  id,
  shape: "basic/divider",
  x: 0,
  y: y - 19,
  w: STORY_MAP_WIDTH,
  h: 10,
  style: { stroke: "#868e96", dash: "dashed" },
});

/* ----------------------------------------------------------------- persona */

const TRAIT_TEXT: NodeStyle = { fontSize: 12, align: "left" };

const personaTrait = (id: string, text: string, y: number, value: number): NodeSpec[] => [
  { ...label(`${id}-label`, text, { x: 24, y, w: 104, h: 20 }, TRAIT_TEXT), parent: "persona" },
  { id, shape: "wireframe/slider", parent: "persona", x: 132, y, w: 112, h: 20, data: { value } },
];

/** A titled panel inside the persona card, holding a bullet list. */
const personaPanel = (id: string, title: string, lines: string[], box: Box, color: string): NodeSpec[] =>
  panel(id, title, bullets(...lines), box, color, "persona");

/* ------------------------------------------------------------------- types */

export const UX_TYPES: DiagramTypeDef[] = [
  {
    id: "wireframe",
    name: "Wireframe",
    category: "ux",
    description: "A low-fidelity mock-up of a web page or app screen: what goes where, before any visual design.",
    keywords: ["wireframe", "mockup", "mock-up", "web page", "landing page", "ui sketch", "lo-fi", "layout", "prototype"],
    libraries: ["wireframe", "basic"],
    defaultShape: "wireframe/card",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Start with a wireframe/browser-window container (its text is the URL) and place the page inside it with explicit coordinates (layout 'none', `parent` set on every element): wireframe/navbar ('Brand | Link | Link'), wireframe/heading, wireframe/paragraph (no text = grey placeholder lines), wireframe/image, wireframe/card, wireframe/button, wireframe/button-secondary, wireframe/input and friends. Keep to a consistent margin and grid; connectors are only needed to link several screens.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "page", shape: "wireframe/browser-window", text: "https://taskly.example", x: 0, y: 0, w: 760, h: 500 },
        { id: "nav", shape: "wireframe/navbar", text: "Taskly | Features | Pricing | Blog | Sign in", parent: "page", x: 0, y: 36, w: 760, h: 50 },
        { id: "headline", shape: "wireframe/heading", text: "Plan projects\nwithout the chaos", parent: "page", x: 40, y: 118, w: 330, h: 72 },
        { id: "intro", shape: "wireframe/paragraph", parent: "page", x: 40, y: 204, w: 310, h: 56 },
        { id: "cta", shape: "wireframe/button", text: "Start free trial", parent: "page", x: 40, y: 278, w: 150, h: 40 },
        { id: "demo", shape: "wireframe/button-secondary", text: "Watch demo", parent: "page", x: 200, y: 278, w: 120, h: 40 },
        { id: "screenshot", shape: "wireframe/image", text: "Product screenshot", parent: "page", x: 410, y: 110, w: 310, h: 210 },
        { id: "feature-boards", shape: "wireframe/card", text: "Boards\nDrag tasks from idea to done.", parent: "page", x: 40, y: 352, w: 214, h: 110 },
        { id: "feature-timelines", shape: "wireframe/card", text: "Timelines\nSee who is doing what, and when.", parent: "page", x: 273, y: 352, w: 214, h: 110 },
        { id: "feature-reports", shape: "wireframe/card", text: "Reports\nShare progress without a meeting.", parent: "page", x: 506, y: 352, w: 214, h: 110 },
      ],
      edges: [],
    },
  },
  {
    id: "mobile-wireframe",
    name: "Mobile wireframe",
    category: "ux",
    description: "Low-fidelity screens of a mobile app side by side, with arrows showing how the user moves between them.",
    keywords: ["mobile wireframe", "app screens", "phone mockup", "ios", "android", "screen flow", "app prototype", "wireflow"],
    libraries: ["wireframe", "basic"],
    defaultShape: "wireframe/card",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "Draw one wireframe/phone container per screen (its text is the screen title), side by side with explicit coordinates (layout 'none'), and place the controls inside with `parent` set: wireframe/input, wireframe/button, wireframe/list (one row per line), wireframe/search, wireframe/tabs ('A | B | C'), wireframe/checkbox, wireframe/toggle, wireframe/image, wireframe/progress. Connect the control the user taps to the phone it opens with a flow edge labelled with the action.",
    support: "dedicated",
    template: {
      layout: "none",
      nodes: [
        { id: "sign-in", shape: "wireframe/phone", text: "Sign in", x: phoneX(0), y: 0, w: PHONE.w, h: PHONE.h },
        onPhone("sign-in", 0, "logo", "wireframe/image", "Logo", 85, 66, 80, 80),
        onPhone("sign-in", 0, "welcome", "wireframe/heading", "Welcome back", 18, 160, 214, 36, { style: { fontSize: 20, align: "center" } }),
        onPhone("sign-in", 0, "email", "wireframe/input", "Email address", 18, 212, 214, 40),
        onPhone("sign-in", 0, "password", "wireframe/input", "Password", 18, 262, 214, 40),
        onPhone("sign-in", 0, "remember", "wireframe/checkbox", "Remember me", 18, 316, 140, 20),
        onPhone("sign-in", 0, "sign-in-button", "wireframe/button", "Sign in", 18, 354, 214, 44),
        onPhone("sign-in", 0, "forgot", "basic/text", "Forgot your password?", 18, 408, 214, 24, { style: MUTED_TEXT }),

        { id: "projects", shape: "wireframe/phone", text: "My projects", x: phoneX(1), y: 0, w: PHONE.w, h: PHONE.h },
        onPhone("projects", 1, "project-search", "wireframe/search", "Search projects", 18, 60, 214, 40),
        onPhone("projects", 1, "project-list", "wireframe/list", "Website redesign\nMobile app 2.0\nSpring campaign\nOffice move", 18, 112, 214, 200),
        onPhone("projects", 1, "new-project", "wireframe/button-secondary", "New project", 18, 326, 214, 44),
        onPhone("projects", 1, "tab-bar", "wireframe/tabs", "Projects | Tasks | Profile", 18, 436, 214, 40),

        { id: "details", shape: "wireframe/phone", text: "Website redesign", x: phoneX(2), y: 0, w: PHONE.w, h: PHONE.h },
        onPhone("details", 2, "cover", "wireframe/image", "Cover image", 18, 60, 214, 110),
        onPhone("details", 2, "status", "wireframe/badge", "On track", 18, 184, 70, 20),
        onPhone("details", 2, "progress", "wireframe/progress", "", 18, 220, 214, 10, { data: { value: 0.65 } }),
        onPhone("details", 2, "progress-note", "basic/text", "13 of 20 tasks done", 18, 236, 214, 20, { style: { ...MUTED_TEXT, align: "left" } }),
        onPhone("details", 2, "task-layout", "wireframe/checkbox", "Homepage layout", 18, 276, 200, 20),
        onPhone("details", 2, "task-copy", "wireframe/checkbox", "Copy review", 18, 306, 200, 20),
        onPhone("details", 2, "task-launch", "wireframe/checkbox", "Launch checklist", 18, 336, 200, 20, { data: { checked: false } }),
        onPhone("details", 2, "notify", "wireframe/toggle", "Notify me of changes", 18, 380, 200, 20),
        onPhone("details", 2, "complete", "wireframe/button", "Mark project as done", 18, 422, 214, 44),
      ],
      edges: [
        { from: "sign-in-button", to: "projects", text: "Sign in", fromAnchor: "right", toAnchor: { x: 0, y: 0.752 } },
        { from: "project-list", to: "details", text: "Open", fromAnchor: "right", toAnchor: { x: 0, y: 0.424 } },
      ],
    },
  },
  {
    id: "user-flow",
    name: "User flow",
    category: "ux",
    description: "The path a user takes through screens and decisions to complete a task, including the error and alternative routes.",
    keywords: ["user flow", "task flow", "ux flow", "screen flow", "navigation flow", "happy path", "onboarding flow"],
    libraries: ["flowchart", "wireframe", "basic"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 44, 56),
    agentGuide:
      "Use basic/pill for the entry point and the end states, basic/rounded for each screen the user sees, flowchart/decision for a choice or system check (label the outgoing edges) and flowchart/process for a background step. Connect with flow edges labelled by the user's action where it is not obvious, and colour success ends green and error states red.",
    support: "dedicated",
    template: {
      layout: "auto",
      nodes: [
        { id: "open", shape: "basic/pill", text: "Opens the app", color: "dark" },
        { id: "welcome", text: "Welcome screen", color: "blue" },
        { id: "sign-up", text: "Sign-up form", color: "blue" },
        { id: "log-in", text: "Log-in form", color: "blue" },
        { id: "verify", text: "Verify email screen", color: "blue" },
        { id: "check", shape: "flowchart/decision", text: "Password\ncorrect?" },
        { id: "home", shape: "basic/pill", text: "Home screen", color: "green" },
        { id: "error", text: "Error message", color: "red" },
      ],
      edges: [
        { from: "open", to: "welcome" },
        { from: "welcome", to: "sign-up", text: "New here" },
        { from: "welcome", to: "log-in", text: "Has an account" },
        { from: "sign-up", to: "verify" },
        { from: "log-in", to: "check" },
        { from: "verify", to: "home" },
        { from: "check", to: "home", text: "Yes" },
        { from: "check", to: "error", text: "No" },
        { from: "error", to: "log-in", text: "Try again", kind: "dashed" },
      ],
    },
  },
  {
    id: "sitemap",
    name: "Sitemap",
    category: "ux",
    description: "The pages of a website or app as a hierarchy, showing how sections and pages nest under the home page.",
    keywords: ["sitemap", "site map", "site structure", "page hierarchy", "website structure", "navigation tree", "page tree"],
    libraries: ["basic", "wireframe"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "line",
    layout: layered("right", 14, 48),
    agentGuide:
      "Draw one basic/rounded node per page: the home page as the root, top-level sections as its children and their pages beneath, connected parent → child with line edges. Keep it a strict tree (each page has one parent), colour the levels or site areas consistently, and mark pages behind a login in gray.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "home", text: "Home", color: "dark", w: 120, h: 44 },
        { id: "products", text: "Products", color: "blue", w: 130, h: 44 },
        { id: "pricing", text: "Pricing", color: "blue", w: 130, h: 44 },
        { id: "resources", text: "Resources", color: "blue", w: 130, h: 44 },
        { id: "company", text: "Company", color: "blue", w: 130, h: 44 },
        { id: "account", text: "My account", color: "gray", w: 130, h: 44 },
        { id: "features", text: "Features", w: 130, h: 40 },
        { id: "integrations", text: "Integrations", w: 130, h: 40 },
        { id: "blog", text: "Blog", w: 130, h: 40 },
        { id: "help", text: "Help centre", w: 130, h: 40 },
        { id: "about", text: "About us", w: 130, h: 40 },
        { id: "careers", text: "Careers", w: 130, h: 40 },
        { id: "orders", text: "Orders", color: "gray", w: 130, h: 40 },
        { id: "settings", text: "Settings", color: "gray", w: 130, h: 40 },
      ],
      edges: [
        { from: "home", to: "products", kind: "line" },
        { from: "home", to: "pricing", kind: "line" },
        { from: "home", to: "resources", kind: "line" },
        { from: "home", to: "company", kind: "line" },
        { from: "home", to: "account", kind: "line" },
        { from: "products", to: "features", kind: "line" },
        { from: "products", to: "integrations", kind: "line" },
        { from: "resources", to: "blog", kind: "line" },
        { from: "resources", to: "help", kind: "line" },
        { from: "company", to: "about", kind: "line" },
        { from: "company", to: "careers", kind: "line" },
        { from: "account", to: "orders", kind: "line" },
        { from: "account", to: "settings", kind: "line" },
      ],
    },
  },
  {
    id: "information-architecture",
    name: "Information architecture",
    category: "ux",
    description: "How the content of a product is organised and labelled: navigation areas, the sections in each and the page types they lead to.",
    keywords: ["information architecture", "ia", "content structure", "navigation", "taxonomy", "content model", "menu structure"],
    libraries: ["basic", "flowchart", "wireframe"],
    defaultShape: "basic/rounded",
    routing: "orthogonal",
    edgeKind: "flow",
    layout: layered("down", 36, 60),
    agentGuide:
      "Group related items in basic/group containers named after the navigation area or content category (set `parent` on the items), with basic/rounded for sections and flowchart/document for page types or templates. Use flow edges for 'leads to' and dashed edges for secondary paths such as search results or cross-links; unlike a sitemap, a page may be reached from several places.",
    support: "generic",
    template: {
      layout: "auto",
      nodes: [
        { id: "home", text: "Home", color: "dark" },
        { id: "main-nav", shape: "basic/group", text: "Main navigation" },
        { id: "shop", text: "Shop", parent: "main-nav", color: "blue" },
        { id: "stories", text: "Stories", parent: "main-nav", color: "blue" },
        { id: "help", text: "Help", parent: "main-nav", color: "blue" },
        { id: "utility-nav", shape: "basic/group", text: "Utility navigation" },
        { id: "search", text: "Search", parent: "utility-nav", color: "teal" },
        { id: "basket", text: "Basket", parent: "utility-nav", color: "teal" },
        { id: "templates", shape: "basic/group", text: "Page types" },
        { id: "category", shape: "flowchart/document", text: "Category page", parent: "templates" },
        { id: "product", shape: "flowchart/document", text: "Product page", parent: "templates" },
        { id: "article", shape: "flowchart/document", text: "Article", parent: "templates" },
        { id: "checkout", shape: "flowchart/document", text: "Checkout", parent: "templates" },
      ],
      edges: [
        { from: "home", to: "main-nav" },
        { from: "home", to: "utility-nav" },
        { from: "shop", to: "category" },
        { from: "category", to: "product" },
        { from: "stories", to: "article" },
        { from: "help", to: "article" },
        { from: "search", to: "category", kind: "dashed" },
        { from: "basket", to: "checkout" },
      ],
    },
  },
  {
    id: "user-story-map",
    name: "User story map",
    category: "ux",
    description: "The user's journey as a backbone of activities and tasks, with the stories under each task sliced into releases.",
    keywords: ["user story map", "story mapping", "backbone", "release slices", "mvp", "jeff patton", "backlog map"],
    libraries: ["basic", "strategy"],
    defaultShape: "basic/note",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Lay out a grid of basic/note stickies with explicit coordinates (layout 'none'): a top row of activities (one colour, each as wide as the tasks it covers), a second row with one user task per column in the order the user performs them, and the stories for each task stacked below it. Separate releases with dashed basic/divider lines and name each slice with a basic/text caption on the left; no connectors.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        storyMapCaption("activities", "Activities", STORY_MAP_ROWS.activities),
        { id: "find", shape: "basic/note", text: "Find a product", x: storyMapX(0), y: 0, w: storyMapX(2) - storyMapX(0) - STORY_MAP.gap, h: 46, color: "blue", style: { fontSize: 14 } },
        { id: "buy", shape: "basic/note", text: "Buy it", x: storyMapX(2), y: 0, w: storyMapX(4) - storyMapX(2) - STORY_MAP.gap, h: 46, color: "blue", style: { fontSize: 14 } },
        { id: "receive", shape: "basic/note", text: "Receive it", x: storyMapX(4), y: 0, w: STORY_MAP.columnW, h: 46, color: "blue", style: { fontSize: 14 } },
        storyMapCaption("tasks", "User tasks", STORY_MAP_ROWS.tasks),
        ...storyMapRow("task", STORY_MAP_ROWS.tasks, "teal", ["Search the shop", "View a product", "Fill the basket", "Pay", "Track the order"]),
        storyMapCaption("release-1", "Release 1\nMVP", STORY_MAP_ROWS.release1),
        ...storyMapRow("mvp", STORY_MAP_ROWS.release1, "yellow", ["Keyword search", "Photos and price", "Basket page", "Card payment", "Confirmation email"]),
        storyMapSlice("slice-1", STORY_MAP_ROWS.release2),
        storyMapCaption("release-2", "Release 2", STORY_MAP_ROWS.release2),
        ...storyMapRow("next", STORY_MAP_ROWS.release2, "yellow", ["Filter by category", "Customer reviews", "Save for later", "Apple Pay", "Live tracking"]),
        storyMapSlice("slice-2", STORY_MAP_ROWS.later),
        storyMapCaption("release-later", "Later", STORY_MAP_ROWS.later),
        ...storyMapRow("later", STORY_MAP_ROWS.later, "yellow", ["Search suggestions", "", "", "Pay in instalments", "Easy returns"]),
      ],
      edges: [],
    },
  },
  {
    id: "storyboard",
    name: "Storyboard",
    category: "ux",
    description: "A scenario told as a sequence of numbered scenes with captions, to show how a product fits into someone's day.",
    keywords: ["storyboard", "scenario", "comic strip", "use scenario", "narrative", "scenes", "customer story"],
    libraries: ["wireframe", "strategy", "basic"],
    defaultShape: "wireframe/image",
    routing: "straight",
    edgeKind: "flow",
    layout: FREEFORM,
    agentGuide:
      "There are no illustration shapes, so each scene is a wireframe/image placeholder whose text names what the drawing shows, with a strategy/step-circle number on its corner and a basic/text caption underneath telling that moment of the story. Lay the panels out left to right in rows with explicit coordinates (layout 'none') and link consecutive panels of a row with flow edges.",
    support: "generic",
    template: {
      layout: "none",
      nodes: storyboardNodes,
      edges: [
        { from: "wait", to: "check" },
        { from: "check", to: "coffee" },
        { from: "alert", to: "board" },
        { from: "board", to: "arrive" },
      ],
    },
  },
  {
    id: "persona",
    name: "Persona",
    category: "ux",
    description: "A one-page profile of a typical user: who they are, what they want to achieve and what gets in their way.",
    keywords: ["persona", "user persona", "user profile", "customer profile", "archetype", "empathy", "target user"],
    libraries: ["wireframe", "strategy", "basic"],
    defaultShape: "basic/text",
    routing: "orthogonal",
    edgeKind: "line",
    layout: FREEFORM,
    agentGuide:
      "Compose the card with explicit coordinates (layout 'none') inside a basic/frame: wireframe/avatar with basic/text for the name, role and a quote, wireframe/slider rows for traits (data.value 0–1), and titled strategy/kanban-column panels each holding one basic/text bullet list for goals, frustrations and needs. Set `parent` so the pieces move with their container; no connectors.",
    support: "generic",
    template: {
      layout: "none",
      nodes: [
        { id: "persona", shape: "basic/frame", text: "Persona · The busy freelancer", x: 0, y: 0, w: 800, h: 370 },
        { id: "photo", shape: "wireframe/avatar", parent: "persona", x: 90, y: 52, w: 88, h: 88 },
        { ...label("name", "Maya Torres", { x: 24, y: 150, w: 220, h: 30 }, { fontSize: 20, bold: true }), parent: "persona" },
        { ...label("role", "Freelance designer · 34 · Lisbon", { x: 24, y: 180, w: 220, h: 22 }, MUTED_TEXT), parent: "persona" },
        { ...label("quote", "“I became a designer to design,\nnot to chase invoices.”", { x: 24, y: 212, w: 220, h: 44 }, { fontSize: 13, italic: true }), parent: "persona" },
        ...personaTrait("tech", "Tech comfort", 270, 0.85),
        ...personaTrait("admin", "Time for admin", 300, 0.15),
        ...personaTrait("budget", "Price sensitivity", 330, 0.6),
        ...personaPanel("goals", "Goals", ["Get paid within two weeks", "Keep evenings free of admin", "Look professional to clients"], { x: 270, y: 48, w: 250, h: 146 }, "green"),
        ...personaPanel("frustrations", "Frustrations", ["Chasing late payments", "Five tools that do not talk", "Tax rules change every year"], { x: 530, y: 48, w: 250, h: 146 }, "red"),
        ...personaPanel(
          "needs",
          "What she needs from us",
          ["An invoice sent in two taps, straight from her phone", "Automatic, polite reminders when a client pays late", "One place for time tracking, invoices and tax reports"],
          { x: 270, y: 204, w: 510, h: 146 },
          "blue",
        ),
      ],
      edges: [],
    },
  },
];
