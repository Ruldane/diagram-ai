import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasDiagramType, listDiagramTypes } from "@/core/catalog";
import { isEdgeKind } from "@/core/edges/kinds";
import { hasShape } from "@/core/shapes/registry";

import { DRAWING_GUIDE, SKILL_GUIDE_PATH, skillGuideFile } from "./guide";
import { PROMPT_NAMES } from "./prompts";
import { backticked, collectKnownNames, createHarness, findUnknownReferences, type Harness, type KnownNames } from "./test-support";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SKILL_DIR = path.join(ROOT, ".claude/skills/diagram-ai");
const read = (relative: string): string => readFileSync(path.join(ROOT, relative), "utf8");

let harness: Harness;
let known: KnownNames;

beforeAll(async () => {
  harness = await createHarness();
  known = await collectKnownNames(harness.client);
});

afterAll(async () => {
  await harness.close();
});

/** Cells of the markdown table rows (header and separator skipped) under `heading`. */
function tableRows(markdown: string, heading: string): string[][] {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`No "${heading}" in the document`);
  const rows: string[][] = [];
  for (const line of markdown.slice(start).split("\n").slice(1)) {
    if (!line.startsWith("|")) {
      if (rows.length) break;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.every((cell) => /^-+$/.test(cell))) continue;
    rows.push(cells);
  }
  return rows.slice(1);
}

describe("the drawing guide", () => {
  it("is mirrored byte for byte in the skill; run `npx tsx scripts/sync-skill.ts` after editing guide.ts", () => {
    expect(read(SKILL_GUIDE_PATH)).toBe(skillGuideFile());
  });

  it("names only tools, arguments, shapes, edge kinds, types and resources that exist", () => {
    expect(findUnknownReferences(DRAWING_GUIDE, known, "all")).toEqual([]);
  });

  it("uses real type ids in its type table", () => {
    const rows = tableRows(DRAWING_GUIDE, "## Choosing a type");
    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      const ids = backticked(row[1]);
      expect(ids.length, row[0]).toBeGreaterThan(0);
      for (const id of ids) expect(hasDiagramType(id), `${id} in "${row[0]}"`).toBe(true);
    }
  });

  it("covers the workflow, conventions and prohibitions the skill relies on", () => {
    for (const heading of ["## Workflow", "## Choosing a type", "## Nodes", "## Edges", "## Layout", "## Preview checklist", "## Don't"]) {
      expect(DRAWING_GUIDE).toContain(heading);
    }
    for (const tool of ["diagram_list", "diagram_create", "diagram_read", "diagram_add_elements", "diagram_preview", "diagram_build_sequence"]) {
      expect(DRAWING_GUIDE).toContain(tool);
    }
  });
});

describe("the Claude Code skill", () => {
  const skill = read(".claude/skills/diagram-ai/SKILL.md");

  it("has frontmatter with a name and a trigger-style description", () => {
    const match = skill.match(/^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---\n/);
    expect(match, "SKILL.md must start with name and description frontmatter").not.toBeNull();
    expect(match![1]).toBe("diagram-ai");
    const description = match![2];
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).toMatch(/\bUse when\b/);
    for (const word of ["draw", "diagram", "architecture", "sequence"]) expect(description.toLowerCase()).toContain(word);
  });

  it("stays short enough to load whole", () => {
    expect(skill.split("\n").length).toBeLessThanOrEqual(120);
  });

  it("tells the agent how to check the connection and what to do when it is down", () => {
    expect(skill).toContain("diagram_list");
    expect(skill).toContain("claude mcp add --transport http diagram-ai http://localhost:3000/api/mcp");
  });

  it("points only at reference files that exist", () => {
    const referenced = [...skill.matchAll(/`(references\/[a-z-]+\.md)`/g)].map((m) => m[1]);
    expect(new Set(referenced)).toEqual(new Set(["references/guide.md", "references/notations.md", "references/layout.md", "references/troubleshooting.md"]));
    const present = readdirSync(path.join(SKILL_DIR, "references"));
    for (const file of referenced) expect(present, file).toContain(path.basename(file));
  });

  it("names only tools, shapes, types and resources that exist", () => {
    expect(findUnknownReferences(skill, known, "all")).toEqual([]);
    const rows = tableRows(skill, "## Pick the type");
    for (const row of rows) for (const id of backticked(row[1])) expect(hasDiagramType(id), id).toBe(true);
  });

  it("names the prompts that exist, and each of them is documented", () => {
    const mentioned = new Set((skill.match(/\bdiagram_(?:repo_architecture|code_flow|er_from_schema|from_description|review|address_comments|tidy|explain|convert)\b/g) ?? []));
    for (const name of PROMPT_NAMES) expect(mentioned.has(name), `SKILL.md should mention the ${name} prompt`).toBe(true);
  });

  it("keeps the other references free of unknown names", () => {
    for (const file of ["layout.md", "troubleshooting.md"]) {
      const text = readFileSync(path.join(SKILL_DIR, "references", file), "utf8");
      expect(findUnknownReferences(text, known), file).toEqual([]);
    }
  });
});

describe("the notation cheat sheet", () => {
  const notations = readFileSync(path.join(SKILL_DIR, "references/notations.md"), "utf8");

  it("uses only shape ids, edge kinds and diagram types that exist", () => {
    expect(findUnknownReferences(notations, known)).toEqual([]);

    const checked = { types: 0, shapes: 0, kinds: 0 };
    for (const line of notations.split("\n")) {
      const labelled = line.match(/^- (Types|Shapes|Edge kinds):/);
      if (!labelled) continue;
      const ids = backticked(line);
      expect(ids.length, line).toBeGreaterThan(0);
      for (const id of ids) {
        if (labelled[1] === "Types") {
          expect(hasDiagramType(id), `type ${id}`).toBe(true);
          checked.types++;
        } else if (labelled[1] === "Shapes") {
          expect(hasShape(id), `shape ${id}`).toBe(true);
          checked.shapes++;
        } else {
          expect(isEdgeKind(id), `edge kind ${id}`).toBe(true);
          checked.kinds++;
        }
      }
    }
    expect(checked.types).toBeGreaterThan(30);
    expect(checked.shapes).toBeGreaterThan(100);
    expect(checked.kinds).toBeGreaterThan(30);
  });

  it("gives every notation a type list, shapes and edge kinds", () => {
    const sections = notations.split(/^## /m).slice(1);
    expect(sections.length).toBeGreaterThanOrEqual(10);
    for (const section of sections) {
      const title = section.split("\n")[0];
      expect(section, title).toMatch(/^- Types:/m);
      expect(section, title).toMatch(/^- Shapes:/m);
      expect(section, title).toMatch(/^- Edge kinds:/m);
    }
  });

  it("covers the notations agents are asked for most", () => {
    for (const type of ["flowchart", "uml-class", "uml-sequence", "er-diagram", "c4-container", "bpmn-process", "cloud-architecture", "agent-architecture"]) {
      expect(notations, type).toContain(`\`${type}\``);
    }
  });
});

describe("docs/agent-skill.md", () => {
  const doc = read("docs/agent-skill.md");

  it("is short, starts with a title and names only things that exist", () => {
    expect(doc.startsWith("# ")).toBe(true);
    expect(doc.split("\n").length).toBeLessThanOrEqual(150);
    expect(findUnknownReferences(doc, known, "all")).toEqual([]);
  });

  it("documents every prompt and every resource", async () => {
    for (const name of PROMPT_NAMES) expect(doc, name).toContain(`\`${name}\``);
    for (const uri of ["diagram://guide", "diagram://types", "diagram://shapes", "diagram://shapes/{library}", "diagram://diagrams", "diagram://diagram/{id}"]) {
      expect(doc, uri).toContain(`\`${uri}\``);
      expect(known.resources.has(uri), uri).toBe(true);
    }
  });

  it("gives the drop-in AGENTS.md snippet", () => {
    const snippet = doc.match(/````markdown\n([\s\S]*?)\n````/);
    expect(snippet, "the snippet fence").not.toBeNull();
    expect(snippet![1]).toContain("diagram_list");
    expect(snippet![1]).toContain("diagram_preview");
    expect(snippet![1].split("\n").length).toBeLessThanOrEqual(15);
  });
});

describe("agent-facing text elsewhere in the product", () => {
  it("catalog guides name only tools and shapes that exist", () => {
    for (const type of listDiagramTypes()) {
      expect(findUnknownReferences(`${type.description}\n${type.agentGuide}`, known), type.id).toEqual([]);
    }
  });

  it("the connection instructions name only tools that exist", async () => {
    const { INSTRUCTIONS } = await import("./server");
    expect(findUnknownReferences(INSTRUCTIONS, known)).toEqual([]);
  });
});
