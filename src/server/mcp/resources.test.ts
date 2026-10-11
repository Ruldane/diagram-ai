import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATEGORIES, listDiagramTypes } from "@/core/catalog";
import { EDGE_KIND_NAMES } from "@/core/edges/kinds";
import { PALETTE_NAMES } from "@/core/model/palette";
import { getLibrary, listLibraries } from "@/core/shapes/registry";

import { DRAWING_GUIDE } from "./guide";
import { createHarness, type Harness } from "./test-support";

let harness: Harness;
let diagramId: string;

const agent = { kind: "agent" as const, id: "test", name: "Test" };

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.close();
});

async function read(uri: string): Promise<string> {
  const result = await harness.client.readResource({ uri });
  expect(result.contents).toHaveLength(1);
  const [content] = result.contents;
  expect(content.uri).toBe(uri);
  expect(content.mimeType).toBe("text/markdown");
  if (!("text" in content) || typeof content.text !== "string") throw new Error(`${uri} returned no text`);
  return content.text;
}

describe("resources/list", () => {
  it("lists the fixed documents", async () => {
    const { resources } = await harness.client.listResources();
    const uris = resources.map((r) => r.uri);
    for (const uri of ["diagram://guide", "diagram://types", "diagram://shapes", "diagram://diagrams"]) expect(uris).toContain(uri);
    for (const resource of resources) {
      expect(resource.name, resource.uri).toBeTruthy();
      expect(resource.mimeType, resource.uri).toBe("text/markdown");
    }
  });

  it("lists one shape resource per library plus the vocabularies", async () => {
    const { resources } = await harness.client.listResources();
    const uris = new Set(resources.map((r) => r.uri));
    for (const library of listLibraries()) expect(uris.has(`diagram://shapes/${library.id}`), library.id).toBe(true);
    for (const extra of ["edge-kinds", "colors", "icons-list"]) expect(uris.has(`diagram://shapes/${extra}`), extra).toBe(true);
  });

  it("offers templates for shape libraries and diagrams", async () => {
    const { resourceTemplates } = await harness.client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual(["diagram://diagram/{id}", "diagram://shapes/{library}"]);
  });
});

describe("diagram://guide", () => {
  it("serves the drawing guide verbatim", async () => {
    expect(await read("diagram://guide")).toBe(DRAWING_GUIDE);
  });
});

describe("diagram://types", () => {
  it("lists every diagram type under its category", async () => {
    const text = await read("diagram://types");
    const types = listDiagramTypes();
    expect(text).toContain(`${types.length} types`);
    for (const type of types) expect(text, type.id).toContain(`\`${type.id}\` — ${type.name}`);
    for (const category of CATEGORIES) expect(text).toContain(`## ${category.name}`);
  });

  it("marks generic types", async () => {
    const generic = listDiagramTypes().find((t) => t.support === "generic");
    expect(generic).toBeDefined();
    expect(await read("diagram://types")).toContain(`\`${generic!.id}\` — ${generic!.name} (generic)`);
  });
});

describe("diagram://shapes", () => {
  it("indexes the libraries with their sizes", async () => {
    const text = await read("diagram://shapes");
    for (const library of listLibraries()) expect(text).toContain(`\`${library.id}\` — ${library.name} (${library.shapes.length} shapes)`);
    expect(text).toContain("diagram://shapes/{library}");
  });

  it("serves one library with every shape id", async () => {
    const text = await read("diagram://shapes/uml");
    for (const shape of getLibrary("uml")!.shapes) expect(text, shape.id).toContain(`\`${shape.id}\``);
    expect(text).toContain("container");
  });

  it("serves the edge kinds, colours and icons", async () => {
    const kinds = await read("diagram://shapes/edge-kinds");
    for (const kind of EDGE_KIND_NAMES) expect(kinds).toContain(`\`${kind}\``);
    const colors = await read("diagram://shapes/colors");
    for (const color of PALETTE_NAMES) expect(colors).toContain(`\`${color}\``);
    expect(await read("diagram://shapes/icons-list")).toContain("database");
  });

  it("answers an unknown library with the list of real ones", async () => {
    await expect(harness.client.readResource({ uri: "diagram://shapes/nope" })).rejects.toThrow(/Unknown shape library "nope"[\s\S]*uml/);
  });
});

describe("diagrams", () => {
  it("says the workspace is empty before anything exists", async () => {
    expect(await read("diagram://diagrams")).toContain("workspace is empty");
    const { resources } = await harness.client.listResources();
    expect(resources.some((r) => r.uri.startsWith("diagram://diagram/"))).toBe(false);
  });

  it("lists a created diagram and serves its outline", async () => {
    const doc = await harness.service.create({ name: "Orders flow", type: "flowchart" }, agent);
    diagramId = doc.id;
    await harness.service.applyElements(
      doc.id,
      {
        nodes: [
          { id: "start", shape: "terminator", text: "Start" },
          { id: "check", shape: "decision", text: "Valid?" },
          { id: "save", text: "Save order" },
        ],
        edges: [
          { from: "start", to: "check" },
          { from: "check", to: "save", text: "Yes" },
        ],
      },
      { actor: agent, mode: "create" },
    );
    await harness.service.addComment(doc.id, { text: "Where does the retry go?", target: "check" }, agent);

    const index = await read("diagram://diagrams");
    expect(index).toContain("Orders flow");
    expect(index).toContain(`id: \`${doc.id}\``);
    expect(index).toContain(`${harness.baseUrl}/d/${doc.id}`);

    const { resources } = await harness.client.listResources();
    const listed = resources.find((r) => r.uri === `diagram://diagram/${doc.id}`);
    expect(listed?.title).toBe("Orders flow");
    expect(listed?.description).toMatch(/flowchart · 3 nodes, 2 edges, 1 open comments/);

    const outline = await read(`diagram://diagram/${doc.id}`);
    expect(outline).toContain("# Orders flow");
    expect(outline).toContain("`start`");
    expect(outline).toContain("`check`");
    expect(outline).toContain("Save order");
    expect(outline).toContain("## Edges (2)");
    expect(outline).toContain("Where does the retry go?");
  });

  it("returns the same outline as diagram_read", async () => {
    const outline = await read(`diagram://diagram/${diagramId}`);
    const viaTool = await harness.client.callTool({ name: "diagram_read", arguments: { diagram_id: diagramId } });
    const content = viaTool.content as { type: string; text?: string }[];
    expect(content[0].text).toBe(outline);
  });

  it("completes diagram ids", async () => {
    const result = await harness.client.complete({
      ref: { type: "ref/resource", uri: "diagram://diagram/{id}" },
      argument: { name: "id", value: "" },
    });
    expect(result.completion.values).toContain(diagramId);
  });

  it("answers an unknown diagram with a pointer to the diagram list", async () => {
    await expect(harness.client.readResource({ uri: "diagram://diagram/nosuchdiagram" })).rejects.toThrow(/No diagram with id "nosuchdiagram"[\s\S]*diagram_list/);
  });

  it("rejects an unsafe id", async () => {
    await expect(harness.client.readResource({ uri: "diagram://diagram/..%2F..%2Fetc" })).rejects.toThrow(/not a valid id/);
  });

  it("rejects a URI nothing serves", async () => {
    await expect(harness.client.readResource({ uri: "diagram://nothing" })).rejects.toThrow(/not found/);
  });
});
