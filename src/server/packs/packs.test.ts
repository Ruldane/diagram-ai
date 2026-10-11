import { rmSync } from "node:fs";

import { strToU8, zipSync } from "fflate";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const dataDir = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/diagram-ai-packs-test-${process.pid}`;
  process.env.DIAGRAM_DATA_DIR = dir;
  return dir;
});

import { DELETE as deleteRoute, GET as getRoute } from "@/app/api/packs/[id]/route";
import { GET as listRoute, POST as postRoute } from "@/app/api/packs/route";
import { createDoc } from "@/core/model/defaults";
import type { DiagramDoc } from "@/core/model/types";
import type { IconPack } from "@/core/shapes/packs";
import { getShape, hasShape, isRuntimeLibrary, listLibraries, resolveShape, unregisterLibrary } from "@/core/shapes/registry";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SYSTEM_ACTOR } from "../service";
import { getContext } from "../context";
import { registerCatalogTools } from "../mcp/tools/catalog";
import { exportDiagram } from "../render/export";
import { ensurePacks } from "./runtime";
import { getPackStore } from "./store";

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

afterEach(async () => {
  const store = getPackStore();
  for (const summary of await store.list()) await store.delete(summary.id);
  await ensurePacks();
  for (const library of listLibraries()) if (isRuntimeLibrary(library.id)) unregisterLibrary(library.id);
});

const svg = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${fill}"/><path d="M12 12h24v24H12z" fill="#fff"/></svg>`;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  postRoute(
    new Request("http://localhost:3000/api/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost:3000", ...headers },
      body: JSON.stringify(body),
    }),
  );

const list = (query = "") => listRoute(new Request(`http://localhost:3000/api/packs${query}`));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const remove = (id: string) => deleteRoute(new Request(`http://localhost:3000/api/packs/${id}`, { method: "DELETE", headers: { host: "localhost:3000" } }), params(id));

const docWith = (shape: string): DiagramDoc => {
  const doc = createDoc({ name: "Pack doc", type: "blank" });
  return { ...doc, nodes: { n_1: { id: "n_1", shape, x: 0, y: 0, w: 120, h: 96, z: 1, text: "Function" } } };
};

describe("POST /api/packs", () => {
  it("installs SVG files, registers the library and lists it", async () => {
    const response = await post({
      name: "AWS Architecture Icons",
      files: [
        { name: "Arch_Compute/48/Arch_AWS-Lambda_48.svg", content: svg("#ed7100") },
        { name: "Arch_Storage/48/Arch_Amazon-S3_48.svg", content: svg("#7aa116") },
      ],
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.pack).toMatchObject({ id: "aws-architecture-icons", iconCount: 2, categories: ["Compute", "Storage"] });
    expect(body.replaced).toBe(false);

    expect(hasShape("aws-architecture-icons/aws-lambda")).toBe(true);
    expect(resolveShape("aws-lambda")?.id).toBe("aws-architecture-icons/aws-lambda");

    const listed = await (await list()).json();
    expect(listed.packs).toHaveLength(1);
    expect(listed.packs[0]).not.toHaveProperty("icons");
    expect(typeof listed.version).toBe("string");

    const full = await (await list("?full=1")).json();
    expect(full.full[0].icons).toHaveLength(2);
    const single = await (await getRoute(new Request("http://localhost:3000/api/packs/x"), params("aws-architecture-icons"))).json();
    expect(single.icons[0].layers.length).toBeGreaterThan(0);
  });

  it("installs a base64 zip and a ready pack, and replaces a pack with the same id", async () => {
    const zip = zipSync({ "Set/Compute/compute_engine.svg": strToU8(svg("#4285f4")), "Set/Data/cloud_sql.svg": strToU8(svg("#669df6")) });
    const first = await post({ name: "Google Cloud", zip: Buffer.from(zip).toString("base64") });
    expect(first.status).toBe(201);
    expect((await first.json()).pack.iconCount).toBe(2);

    const ready: IconPack = {
      id: "google-cloud",
      name: "Google Cloud",
      icons: [{ id: "run", name: "Cloud Run", viewBox: { w: 24, h: 24 }, layers: [{ d: "M0 0h24v24H0z", fill: "#4285f4" }] }],
    };
    const second = await post(ready);
    expect(second.status).toBe(200);
    expect((await second.json()).replaced).toBe(true);
    expect(hasShape("google-cloud/run")).toBe(true);
    expect(hasShape("google-cloud/compute-engine")).toBe(false);
  });

  it("rejects bad input with a readable message", async () => {
    const reserved = await post({ id: "infra", name: "Infra", files: [{ name: "a.svg", content: svg("#111111") }] });
    expect(reserved.status).toBe(400);
    expect((await reserved.json()).error).toMatch(/built-in/);

    const brandNamed = await post({ name: "Brands", files: [{ name: "a.svg", content: svg("#111111") }] });
    expect(brandNamed.status).toBe(201);
    expect((await brandNamed.json()).pack.id).toBe("brands-pack");

    const nothing = await post({ name: "Empty", files: [{ name: "notes.txt", content: "x" }] });
    expect(nothing.status).toBe(400);
    const invalid = await post({ id: "Bad Id", name: "x", icons: [] });
    expect(invalid.status).toBe(400);
    const unknown = await post({ hello: "world" });
    expect(unknown.status).toBe(400);
    const notZip = await post({ name: "Nope", zip: Buffer.from("not a zip").toString("base64") });
    expect(notZip.status).toBe(400);
  });

  it("blocks cross-origin writes", async () => {
    const response = await post({ name: "X", files: [{ name: "a.svg", content: svg("#111111") }] }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect((await (await list()).json()).packs).toHaveLength(0);
  });
});

describe("DELETE /api/packs/[id]", () => {
  it("removes the pack and leaves documents rendering", async () => {
    await post({ name: "Cloud Icons", files: [{ name: "Function.svg", content: svg("#ed7100") }] });
    const shape = "cloud-icons/function";
    expect(hasShape(shape)).toBe(true);
    const doc = docWith(shape);

    const withPack = await exportDiagram(doc, "svg");
    expect(String(withPack.data)).toContain("#ed7100");

    expect((await remove("cloud-icons")).status).toBe(200);
    expect(hasShape(shape)).toBe(false);
    expect(getShape(shape).id).toBe("basic/rect");
    expect((await remove("cloud-icons")).status).toBe(404);
    expect((await getRoute(new Request("http://localhost:3000/api/packs/x"), params("cloud-icons"))).status).toBe(404);

    const after = await exportDiagram(doc, "svg");
    expect(String(after.data)).not.toContain("#ed7100");
    expect(String(after.data)).toContain("Function");
  });

  it("does not accept path-like ids", async () => {
    expect((await remove("..%2F..%2Fetc")).status).toBe(404);
  });
});

describe("rendering with packs", () => {
  it("exports SVG and PDF through the same pipeline as built-in shapes", async () => {
    await post({ name: "Cloud Icons", files: [{ name: "Function.svg", content: svg("#ed7100") }] });
    const doc = docWith("cloud-icons/function");

    const vector = await exportDiagram(doc, "svg");
    expect(String(vector.data)).toContain("#ed7100");

    const pdf = await exportDiagram(doc, "pdf");
    expect(pdf.mime).toBe("application/pdf");
    expect((pdf.data as Uint8Array).byteLength).toBeGreaterThan(1000);

    const png = await exportDiagram(doc, "png");
    expect((png.data as Uint8Array).byteLength).toBeGreaterThan(500);
  }, 60_000);

  it("notices packs written by another process", async () => {
    const pack: IconPack = {
      id: "from-cli",
      name: "From CLI",
      icons: [{ id: "box", name: "Box", viewBox: { w: 8, h: 8 }, layers: [{ d: "M0 0h8v8H0z", fill: "#336699" }] }],
    };
    await getPackStore().save(pack); // no `packsChanged`, as the CLI would
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await ensurePacks();
    expect(hasShape("from-cli/box")).toBe(true);

    await getPackStore().delete("from-cli");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await ensurePacks();
    expect(hasShape("from-cli/box")).toBe(false);
  }, 15_000);
});

describe("agents", () => {
  type Handler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[] }>;

  async function listShapes(args: Record<string, unknown>): Promise<string> {
    const handlers = new Map<string, Handler>();
    const server = { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as unknown as McpServer;
    const { service, hub } = getContext();
    registerCatalogTools(server, { service, hub, actor: SYSTEM_ACTOR, baseUrl: "http://localhost:3000" });
    const result = await handlers.get("diagram_list_shapes")!({ limit: 100, offset: 0, ...args });
    return result.content.map((part) => part.text ?? "").join(" ");
  }

  it("lists packs as libraries and resolves their aliases when drawing", async () => {
    await post({ name: "AWS Architecture Icons", files: [{ name: "Arch_Compute/Arch_AWS-Lambda_48.svg", content: svg("#ed7100") }] });

    expect(await listShapes({})).toContain("`aws-architecture-icons` — AWS Architecture Icons (1 shapes)");
    const library = await listShapes({ library: "aws-architecture-icons" });
    expect(library).toContain("`aws-architecture-icons/aws-lambda`");
    expect(library).toContain("aws-lambda");
    expect(await listShapes({ query: "lambda" })).toContain("aws-architecture-icons/aws-lambda");

    // Drawing by alias lands on the pack shape, not on a rectangle.
    const { service } = getContext();
    const doc = await service.create({ name: "Agent drawing", type: "blank" }, SYSTEM_ACTOR);
    const applied = await service.applyElements(
      doc.id,
      { nodes: [{ id: "fn", shape: "aws-lambda", text: "Orders" }] },
      { actor: SYSTEM_ACTOR, mode: "create", layout: "none" },
    );
    expect(Object.values(applied.doc.nodes)[0].shape).toBe("aws-architecture-icons/aws-lambda");
  });
});
