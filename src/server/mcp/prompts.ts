import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { getDiagramType, listDiagramTypes, resolveDiagramType, searchDiagramTypes, type DiagramTypeDef } from "@/core/catalog";
import type { DiagramDoc } from "@/core/model/types";

import { ServiceError } from "../errors";
import { diagramUrl } from "./format";
import type { ToolContext } from "./toolkit";

/**
 * MCP prompts: ready-made workflows that clients list as slash commands
 * (`/mcp__diagram-ai__diagram_review`). Each returns one user message that
 * tells the agent what to do with this server's tools, in order, and when it
 * is done. The text is product surface: `prompts.test.ts` checks that every
 * tool, argument, shape and diagram type it names exists.
 */
export const PROMPT_NAMES = [
  "diagram_repo_architecture",
  "diagram_code_flow",
  "diagram_er_from_schema",
  "diagram_from_description",
  "diagram_review",
  "diagram_address_comments",
  "diagram_tidy",
  "diagram_explain",
  "diagram_convert",
] as const;

const GROUND_RULES = [
  "Ground rules",
  "- Omit x, y, w and h: the layout engine sizes, places and routes everything.",
  "- Give every node a short kebab-case id and refer to it from edges.",
  "- Keep labels to 2-5 words; use a second line (\"\\n\") for detail.",
  "- Label every connector with what flows over it.",
  "- Look with diagram_preview before you report. The full guide is the diagram://guide resource.",
].join("\n");

const lines = (...parts: (string | false | undefined)[]): string => parts.filter((part): part is string => typeof part === "string").join("\n");

/** Optional arguments may arrive as empty strings from clients that always send every field. */
const given = (value: string | undefined): string | undefined => (value?.trim() ? value.trim() : undefined);

/* ----------------------------------------------------------------- arguments */

const optionalText = (description: string) => z.string().trim().max(500).optional().describe(description);

/**
 * Completion metadata goes on both the optional wrapper and the schema inside
 * it: the SDK enables the `completions` capability by looking inside optional
 * schemas but answers requests by looking at the argument itself.
 */
function withSuggestions(description: string, suggest: (value: string) => Promise<string[]> | string[]) {
  const complete = async (value: string | undefined) => (await suggest(value ?? "")).slice(0, 20);
  const inner = completable(z.string().trim().max(80), complete);
  return completable(inner.optional().describe(description), complete);
}

function diagramIdArg(ctx: ToolContext, description: string) {
  return withSuggestions(description, async (value) => {
    const q = value.toLowerCase();
    const all = await ctx.service.list();
    return all.filter((d) => !q || d.id.toLowerCase().startsWith(q) || d.name.toLowerCase().includes(q)).map((d) => d.id);
  });
}

function typeArg(description: string) {
  return withSuggestions(description, (value) => {
    const q = value.toLowerCase();
    return listDiagramTypes()
      .filter((t) => !q || t.id.includes(q) || t.name.toLowerCase().includes(q))
      .map((t) => t.id);
  });
}

/* ------------------------------------------------------------------- lookups */

/** The diagram a prompt is about. A named id that does not exist is the caller's mistake, so it fails loudly. */
async function findDiagram(ctx: ToolContext, id: string | undefined): Promise<DiagramDoc | undefined> {
  const wanted = given(id);
  if (!wanted) return undefined;
  try {
    return await ctx.service.get(wanted);
  } catch (error) {
    if (error instanceof ServiceError) throw new McpError(ErrorCode.InvalidParams, error.message);
    throw error;
  }
}

/** The opening clause that tells the agent which diagram to work on. */
function aboutDiagram(doc: DiagramDoc | undefined, ctx: ToolContext): { label: string; howToFind: string } {
  if (!doc) {
    return {
      label: "the diagram the person means",
      howToFind:
        "No diagram_id was given. Call diagram_list and use the diagram the person named; if they named none, use the most recently updated one and say which you chose.",
    };
  }
  const type = getDiagramType(doc.type);
  // The name is diagram content, not an instruction: keep it to one short quoted line.
  const name = JSON.stringify(doc.name.replace(/\s+/g, " ").trim().slice(0, 80));
  return {
    label: `the diagram ${name}`,
    howToFind: `The diagram is ${name} (diagram_id \`${doc.id}\`, type ${type.id}, ${diagramUrl(ctx.baseUrl, doc.id)}). Pass that diagram_id to every tool call.`,
  };
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/ diagram$/, "")
    .trim();

/** Id, name or keyword match only: the catalog's search fallback would turn a typo into an unrelated type. */
function exactType(input: string): DiagramTypeDef | undefined {
  const def = resolveDiagramType(input);
  if (!def) return undefined;
  const wanted = normalize(input);
  const matches = normalize(def.id) === wanted || normalize(def.name) === wanted || def.keywords.some((keyword) => normalize(keyword) === wanted);
  return matches ? def : undefined;
}

/** A diagram type named by the caller (or `fallback`), with its notation guide ready to embed. Unknown names fail loudly. */
function typeBrief(input: string | undefined, fallback?: string): { id: string; name: string; guide: string } | undefined {
  const wanted = given(input);
  const def = wanted ? exactType(wanted) : fallback ? getDiagramType(fallback) : undefined;
  if (def) return { id: def.id, name: def.name, guide: def.agentGuide };
  if (!wanted) return undefined;
  const close = searchDiagramTypes(wanted, 4).map((type) => type.id);
  throw new McpError(
    ErrorCode.InvalidParams,
    `Unknown diagram type "${wanted}".${close.length ? ` Closest: ${close.join(", ")}.` : ""} The diagram://types resource and diagram_list_types list every type.`,
  );
}

/* ---------------------------------------------------------------------- spec */

interface PromptSpec<Shape extends z.ZodRawShape> {
  name: (typeof PROMPT_NAMES)[number];
  title: string;
  description: string;
  args: Shape;
  text: (args: z.infer<z.ZodObject<Shape>>) => string | Promise<string>;
}

function register<Shape extends z.ZodRawShape>(server: McpServer, spec: PromptSpec<Shape>): void {
  server.registerPrompt(
    spec.name,
    { title: spec.title, description: spec.description, argsSchema: spec.args },
    (async (args: z.infer<z.ZodObject<Shape>>) => ({
      description: spec.title,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: await spec.text(args) } }],
    })) as never,
  );
}

export function registerPrompts(server: McpServer, ctx: ToolContext): void {
  register(server, {
    name: "diagram_repo_architecture",
    title: "Diagram this repository's architecture",
    description:
      "Explore the repository you are working in and draw its architecture (a C4 container diagram by default) on the live canvas, with grouped containers, labelled connectors and a legend.",
    args: {
      focus: optionalText("Part or concern to concentrate on, e.g. 'the checkout flow' or 'data stores'. Default: the whole repository."),
      diagram_type: typeArg("Diagram type id. Default c4-container; others: c4-context, c4-component, system-architecture, microservices, module-map."),
    },
    text: ({ focus, diagram_type }) => {
      const type = typeBrief(diagram_type, "c4-container")!;
      return lines(
        `Draw the architecture of the repository you are working in, in Diagram AI, as a diagram of type "${type.id}" (${type.name}).`,
        given(focus) && `Focus: ${given(focus)}. Leave out whatever does not serve that focus.`,
        "",
        "1. Explore first, using your own file and search tools. Draw nothing yet. Collect, with the file each fact comes from:",
        "   - entry points: servers, route handlers, CLIs, workers, scheduled jobs",
        "   - deployable units: apps, services, packages, containers (docker-compose, Dockerfiles, Kubernetes or Helm files, workspace packages)",
        "   - data stores, queues, caches and file storage (connection config, ORM setup, migrations, environment variables)",
        "   - external systems it calls (SDK clients, base URLs, webhooks) and who calls it (users, other services, CI)",
        "   - how the units talk: HTTP, gRPC, events, a shared database, in-process imports. Read the call sites, not just the config.",
        "   Skip tests, generated code, vendored dependencies and build output. Aim for 6-20 nodes. If the repository is bigger, draw the top level now and say which part deserves its own diagram.",
        `2. Create. Call diagram_list: if a diagram of this repository already exists, diagram_read it and update that one. Otherwise call diagram_create with a name such as "<repo> - containers" and type "${type.id}". Tell the person the URL straight away so they can watch.`,
        `   Notation for ${type.id}: ${type.guide}`,
        "3. Draw with one diagram_add_elements call:",
        "   - one node per unit: text \"Name\\n[technology]\" and, if it fits, a third line saying what it does; put the source path in the node's note",
        "   - group with containers: your system's units inside one boundary container (set parent), people and external systems outside it; add inner containers only for real groupings such as a bounded context or deployment unit",
        "   - one edge per verified interaction, from caller to callee, with text = what is exchanged and the protocol (\"JSON/HTTPS\", \"SQL\", \"publishes OrderPlaced\"); kind \"dashed\" for asynchronous or event-driven links",
        "   - colour by role, not decoration: three or four colours at most, for example gray for external systems and one accent for data stores",
        "   Where the notation above differs from these defaults, the notation wins.",
        "4. Check. Call diagram_preview and fix what you see with diagram_update_elements, diagram_delete_elements or diagram_layout (direction \"right\" suits wide diagrams). Repeat at most twice.",
        "5. Annotate. Add a legend with diagram_add_comment and no target: what the colours and dashed edges mean and what is in scope. Pin a comment to every node whose existence or links you inferred rather than verified, naming the assumption and where to confirm it.",
        "",
        "Done when diagram_preview shows no overlapping or truncated labels, every node has at least one connector, every connector has a label and every assumption is flagged. Then reply with the diagram URL, a 3-5 line summary of what it shows and what you could not determine.",
        "",
        GROUND_RULES,
      );
    },
  });

  register(server, {
    name: "diagram_code_flow",
    title: "Diagram a request or code flow",
    description:
      "Trace a function, endpoint or job through the code and draw it as a sequence diagram, plus an activity diagram when the flow branches a lot.",
    args: {
      entry_point: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe("What to trace: a function, route, command or job, e.g. 'POST /orders' or 'processPayment()'."),
      depth: optionalText("How many call levels to follow. Default 3."),
    },
    text: ({ entry_point, depth }) => {
      const activity = getDiagramType("uml-activity");
      return lines(
        `Trace what happens when \`${entry_point}\` runs and draw it as a sequence diagram in Diagram AI.`,
        "",
        `1. Trace first, using your own file and search tools. Start at the entry point and follow the calls ${given(depth) ? `to this depth: ${given(depth)}` : "three levels deep"} or until the data leaves the system. For each hop note the caller, the callee, what is passed (method, route, event name) and what comes back. Mark every boundary where the flow leaves the process: database query, HTTP call, queue publish, cache. Note branches, retries and error paths separately; the sequence diagram shows the main path.`,
        "2. Choose participants: one per component that does something visible, such as the caller (kind \"actor\" for a person or outside client), the route or controller, the service, the repository, the database and each external API. Fold internal helper functions into their owner. Aim for 3-8 participants and about 25 messages at most; collapse repeated steps into one message.",
        "3. Create. Call diagram_list in case the flow is already drawn, then diagram_create with name \"Flow: <entry point>\" and type \"uml-sequence\". Tell the person the URL.",
        "4. Draw with one diagram_build_sequence call: participants (a short id plus a display name) and messages in execution order. kind \"sync\" for calls, \"async\" for fire-and-forget and queue publishes, \"return\" for replies. A message from a participant to itself is a self-call; show one only when it is a real step (validate, hash). Label messages concretely (\"POST /orders\", \"INSERT order\", \"OrderPlaced\"), never \"call\" or \"process\".",
        `5. If the flow has more than two real decision points, retries or parallel paths, draw a second diagram for the logic: diagram_create with type "uml-activity" (or "flowchart") and name "Flow: <entry point> (logic)", then one diagram_add_elements call. Notation for uml-activity: ${activity.agentGuide} Mention each diagram in the other with diagram_add_comment.`,
        "6. Check. Call diagram_preview, then fix. A built sequence is not re-flowed: correct labels with diagram_update_elements (edge ids come from diagram_read). To restructure, remove the lifelines with diagram_delete_elements and call diagram_build_sequence again, because building on top of the old one adds a second copy and fails on duplicate participant ids. Never call diagram_layout on a sequence diagram.",
        "",
        "Done when the messages read top to bottom in the order the code runs, every label is concrete, diagram_preview shows no overlapping labels and the participants match the components you found. Reply with the URL, a two-line summary and anything on the path you could not trace.",
        "",
        GROUND_RULES,
      );
    },
  });

  register(server, {
    name: "diagram_er_from_schema",
    title: "Draw an ER diagram from a schema",
    description: "Read the project's migrations, schema file or ORM models and draw the tables, columns, keys and relationships as an ER diagram.",
    args: {
      source: optionalText("Path to the schema or models, or an ORM hint such as 'prisma', 'migrations/' or 'django models'. Default: find it."),
    },
    text: ({ source }) => {
      const er = getDiagramType("er-diagram");
      return lines(
        "Draw the database schema of this project as an ER diagram in Diagram AI.",
        "",
        `1. Find the schema with your own file tools. ${
          given(source)
            ? `Start from ${given(source)}.`
            : "Look in this order: SQL migrations or schema.sql, schema.prisma, ORM models (Drizzle, TypeORM, Sequelize, SQLAlchemy, Django, Rails, Ecto), GraphQL SDL."
        } When migrations exist, replay them in order: later ones add, alter and drop columns, so the final state is the schema. Ignore seed data and test fixtures.`,
        "2. Extract, per table: its name, the columns with their types, the primary key, each foreign key and the table it references, and unique or NOT NULL constraints where they matter. Note indexes only if the person wants the physical design. Note views separately.",
        "3. Decide each relationship's cardinality. A foreign key makes the referenced table the \"one\" side. Use zero-to-many by default (a parent may have no children), one-to-many when the domain requires at least one child, one-to-one or zero-to-one for a unique foreign key. A table whose only job is two foreign keys is a junction table: keep it as an entity with two one-to-many edges.",
        "4. Create. Call diagram_list and update an existing schema diagram if there is one. Otherwise diagram_create with name \"<project> - schema\" and type \"er-diagram\" (\"database-schema\" when the person wants types, indexes and constraints). Tell the person the URL.",
        `   Notation for er-diagram: ${er.agentGuide}`,
        "5. Draw with one diagram_add_elements call:",
        "   - one er/entity per table, id = the table name, text \"table_name\\n---\\nPK id: uuid\\nFK customer_id: uuid\\nstatus: varchar\" (one column per line); er/view for views",
        "   - one edge per foreign key, from the referenced table to the table that holds it, with the kind decided in step 3 and the foreign key column as text when the link is not obvious",
        "   - a table with more than about 8 columns: show the keys and the columns that matter, and end with \"+N more\"",
        "   - more than about 25 tables: group by domain with containers (shape \"group\", set parent), or draw one diagram per domain and repeat the tables that link them",
        "6. Check. Call diagram_preview and fix what you see with diagram_update_elements or diagram_layout (direction \"right\" suits schemas). Repeat at most twice.",
        "",
        "Done when every foreign key is an edge (count them), no table is unconnected unless it really stands alone, every column line is readable and diagram_preview shows no overlaps. Reply with the URL, the table and relationship counts, and anything ambiguous: polymorphic references, soft deletes, columns you could not type.",
        "",
        GROUND_RULES,
      );
    },
  });

  register(server, {
    name: "diagram_from_description",
    title: "Draw a diagram from a description",
    description: "Turn a plain-language description into a diagram: pick the right diagram type, create it, draw it, check it and iterate once.",
    args: {
      description: z.string().trim().min(1).max(4000).describe("What the diagram should show, in your own words."),
      diagram_type: typeArg("Diagram type id if you know it, e.g. flowchart, uml-sequence, er-diagram. Default: chosen for you."),
    },
    text: ({ description, diagram_type }) => {
      const type = typeBrief(diagram_type);
      return lines(
        "Create a diagram in Diagram AI from this description:",
        "",
        ...description.split("\n").map((line) => `> ${line}`),
        "",
        type
          ? `1. Use diagram type "${type.id}" (${type.name}). Notation: ${type.guide}`
          : "1. Choose the type. Call diagram_list_types with a query for the key word in the description (for example \"sequence\", \"org chart\", \"roadmap\") unless the type is obvious. Prefer a dedicated type over \"blank\".",
        "2. Settle the content before drawing: list the nodes (about 20 at most) and the connections. Ask the person one question only if the description is ambiguous in a way that changes the structure; otherwise take the likeliest reading and state your assumptions at the end.",
        "3. Create with diagram_create (name taken from the description), then draw with one diagram_add_elements call, or diagram_build_sequence for a sequence diagram. Follow the \"How to draw\" paragraph in the diagram_create reply. Tell the person the URL.",
        "4. Check with diagram_preview and fix what you see with diagram_update_elements or diagram_layout. Iterate once; a second round only for something clearly broken.",
        "",
        "Done when diagram_preview shows no overlapping labels, every node is connected and every connector is labelled. Reply with the URL and your assumptions in a line or two.",
        "",
        GROUND_RULES,
      );
    },
  });

  register(server, {
    name: "diagram_review",
    title: "Review a diagram",
    description: "Read and look at a diagram, then leave comments on what is unclear, wrong or hard to read. Changes nothing.",
    args: { diagram_id: diagramIdArg(ctx, "Diagram to review. Default: the diagram the person means.") },
    text: async ({ diagram_id }) => {
      const about = aboutDiagram(await findDiagram(ctx, diagram_id), ctx);
      return lines(
        `In Diagram AI, review ${about.label}. You are the reviewer: leave comments and do not change the diagram.`,
        about.howToFind,
        "",
        "1. Call diagram_read, then diagram_list_comments, so you know what is there and do not repeat open points.",
        "2. Call diagram_preview and look at it the way the person sees it. Zoom into dense regions with diagram_preview and ids.",
        "3. Check, in this order:",
        "   - Correctness: does it follow its diagram type's notation (diagram_list_types with a query for the type gives the guide)? Wrong shapes or edge kinds, arrows pointing the wrong way, something missing that the rest implies (a queue nobody consumes, a database nobody reads).",
        "   - Labels: missing, vague (\"Service\", \"Thing\"), longer than five words, inconsistent naming or casing, abbreviations a newcomer would not know.",
        "   - Structure: orphan nodes, unlabelled connectors where the meaning is not obvious, the same thing twice under different names, unrelated things grouped together, related things not grouped.",
        "   - Readability: overlaps, crossing connectors, labels sitting on lines, wildly different node sizes, colours without meaning.",
        "4. Leave one diagram_add_comment per problem, with target = the element id. Write each as: what is wrong, why it matters, the fix you suggest. Use a comment without a target for problems that concern the whole diagram. Start with a summary comment (\"Review: 7 findings, 2 important: ...\"). Prioritise: about 12 comments at most, most important first.",
        "5. Do not use diagram_add_elements, diagram_update_elements, diagram_delete_elements or diagram_layout, and do not resolve other people's comments. You may point at the most important finding with diagram_highlight.",
        "",
        "Done when every finding is a comment on the diagram, or the diagram is clean and you say so plainly. Reply with the number of findings by importance and the URL.",
      );
    },
  });

  register(server, {
    name: "diagram_address_comments",
    title: "Address open comments",
    description: "List the open comment threads on a diagram, make the requested changes, reply in each thread and resolve it.",
    args: { diagram_id: diagramIdArg(ctx, "Diagram whose comments to address. Default: the diagram the person means.") },
    text: async ({ diagram_id }) => {
      const about = aboutDiagram(await findDiagram(ctx, diagram_id), ctx);
      return lines(
        `In Diagram AI, address the open comments on ${about.label}.`,
        about.howToFind,
        "",
        "1. Call diagram_list_comments (open threads only) and diagram_read. If nothing is open, say so and stop. Call diagram_review_status too, so you do not redraw anything the person has just reverted or deleted.",
        "2. Before anything beyond a trivial edit, call diagram_checkpoint with action \"save\" and name \"before addressing comments\".",
        "3. Treat each thread on its own terms:",
        "   - a change request: make it with diagram_update_elements, diagram_add_elements or diagram_delete_elements, using the element the comment points at (its target) or the ids from diagram_read",
        "   - a question: answer it in a reply and leave the diagram alone",
        "   - unclear, or in conflict with another comment: reply with a question or the options and leave the thread open",
        "4. After each change, reply in the thread with diagram_add_comment and reply_to = the comment id, saying exactly what changed (\"Renamed to 'Order API' and added the missing edge to Billing\"), then call diagram_resolve_comment. Resolve only threads you fully addressed.",
        "5. Call diagram_preview once at the end. If your changes caused overlaps, fix them with diagram_update_elements. Call diagram_layout only when a comment asked for it or diagram_read says auto-layout is on.",
        "",
        "Done when every open thread has a reply and is either resolved or waiting on a question to the person. Reply with what changed, what is still open and the URL.",
      );
    },
  });

  register(server, {
    name: "diagram_tidy",
    title: "Tidy up a diagram",
    description: "Fix layout, labels and colours and group related nodes, without changing what the diagram says. Saves a checkpoint first.",
    args: { diagram_id: diagramIdArg(ctx, "Diagram to tidy. Default: the diagram the person means.") },
    text: async ({ diagram_id }) => {
      const about = aboutDiagram(await findDiagram(ctx, diagram_id), ctx);
      return lines(
        `In Diagram AI, tidy up ${about.label} without changing what it says.`,
        about.howToFind,
        "",
        "1. Call diagram_read and diagram_preview to see where it stands. Then call diagram_checkpoint with action \"save\" and name \"before tidy\" so the person can go back. If diagram_read shows a Review line, call diagram_review_status and leave alone anything the person reverted.",
        "2. Decide how much to move. diagram_read says whether auto-layout is on. If it is, a full diagram_layout is safe. If it is off, a person arranged this diagram by hand: do not re-flow all of it. Move single nodes with diagram_update_elements (x and y), or arrange only the messy region with diagram_layout and ids, and check afterwards that the rest stayed put.",
        "3. Fix, in this order:",
        "   - Grouping: put related nodes into a container (add the container with diagram_add_elements, then set parent with diagram_update_elements).",
        "   - Labels: shorten anything over five words, make naming and casing consistent, add the connector labels the meaning needs.",
        "   - Colour: one meaning per colour, four or five colours at most; recolour strays with color.",
        "   - Layout: diagram_layout with the algorithm that fits the type (layered for flows and architectures, tree for hierarchies); direction \"right\" for wide diagrams. Never on a sequence diagram.",
        "4. Do not add or delete nodes other than containers, change what connects to what, or rename ids. If something looks missing or wrong, leave a diagram_add_comment instead.",
        "5. Call diagram_preview after the layout step and again at the end; fix what you see.",
        "",
        "Done when diagram_preview shows no overlapping or cut-off labels, connectors cross only where unavoidable, colours are consistent and nothing was added or removed except containers. Reply with what you changed and the name of the checkpoint.",
      );
    },
  });

  register(server, {
    name: "diagram_explain",
    title: "Explain a diagram",
    description: "Read and look at a diagram and explain it in prose: what it shows, how it flows, what the groups and colours mean. Changes nothing.",
    args: { diagram_id: diagramIdArg(ctx, "Diagram to explain. Default: the diagram the person means.") },
    text: async ({ diagram_id }) => {
      const about = aboutDiagram(await findDiagram(ctx, diagram_id), ctx);
      return lines(
        `In Diagram AI, explain ${about.label} in prose. This is read-only: change nothing and add no comments.`,
        about.howToFind,
        "",
        "1. Call diagram_read for the structure, diagram_list_comments with include_resolved true for the intent and history, and diagram_preview to see grouping and colour the way the person sees it. If the person said \"this\" or \"these\", call diagram_get_selection and explain only what is selected.",
        "2. Write the explanation:",
        "   - one sentence on what the diagram shows and who it is for",
        "   - the main flow or structure, following the connectors in order and naming nodes by their labels, not their ids",
        "   - what the groups, colours and dashed lines mean",
        "   - open comments, and anything that looks unfinished or inconsistent, phrased as observations",
        "3. Keep it to about 250 words unless more was asked for; a short numbered list suits a flow.",
        "",
        "Done when someone who has not seen the diagram could redraw its main structure from your text.",
      );
    },
  });

  register(server, {
    name: "diagram_convert",
    title: "Convert to another diagram type",
    description: "Re-draw a diagram's content in another notation (for example flowchart to BPMN) as a new diagram, leaving the original untouched.",
    args: {
      diagram_id: diagramIdArg(ctx, "Diagram to convert. Default: the diagram the person means."),
      to_type: typeArg("Diagram type to convert to, e.g. bpmn-process, uml-activity, c4-container."),
    },
    text: async ({ diagram_id, to_type }) => {
      const about = aboutDiagram(await findDiagram(ctx, diagram_id), ctx);
      const target = typeBrief(to_type);
      return lines(
        `In Diagram AI, re-draw ${about.label} as ${target ? `a diagram of type "${target.id}" (${target.name})` : "another diagram type"} in a NEW diagram. Leave the source diagram unchanged.`,
        about.howToFind,
        "",
        "1. Call diagram_read on the source (response_format \"json\" if styles or data fields matter), then diagram_preview and diagram_list_comments. List what it contains: entities or steps, relationships, groupings, labels, and notes worth carrying over.",
        target
          ? `2. Target notation "${target.id}" (${target.name}): ${target.guide}`
          : "2. No target type was given: ask the person which notation they want, offering the two or three best fits from diagram_list_types, then continue.",
        "3. Map concept by concept and keep every element: the content stays, the notation changes. For flowchart to BPMN, for example: start and end terminators become start and end events, process steps become tasks, decisions become exclusive gateways, swimlanes become a pool with lanes. If the target needs something the source lacks (roles for lanes, a system boundary), infer the minimum and mark it with a comment.",
        "4. Call diagram_create with name \"<source name> (as <target name>)\", the target type and a description saying it was converted from the source diagram's id. Draw with one diagram_add_elements call (diagram_build_sequence for a sequence target); reuse the source node ids where they are still valid.",
        "5. Call diagram_preview and fix what you see. Compare against your list from step 1: every source element appears in the new diagram, or is named as dropped, with the reason, in a comment.",
        "",
        "Done when nothing from the source is missing without a note and diagram_preview shows no overlapping labels. Reply with the URL of the new diagram, the mapping you used and the elements that could not be expressed.",
        "",
        GROUND_RULES,
      );
    },
  });
}
