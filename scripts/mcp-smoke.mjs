#!/usr/bin/env node
/**
 * Drives the MCP endpoint the way an agent would: connect, list tools, create
 * a diagram, draw, look at it, comment, export. Requires the app to be running.
 *
 *   node scripts/mcp-smoke.mjs [baseUrl] [agentName]
 *   node scripts/mcp-smoke.mjs http://localhost:3000 claude-code
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const agent = process.argv[3] ?? "claude-code";
const endpoint = `${base}/api/mcp/${agent}`;
let nextId = 1;

async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function call(name, args, { quiet = false } = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  console.log(`\n▸ ${name}${result.isError ? "  ✗ ERROR" : ""}`);
  if (!quiet) console.log(text.split("\n").slice(0, 14).map((line) => `  ${line}`).join("\n"));
  return { text, result };
}

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "mcp-smoke", version: "1.0.0" },
});
console.log(`Connected to ${init.serverInfo.name} ${init.serverInfo.version} (protocol ${init.protocolVersion})`);

const { tools } = await rpc("tools/list", {});
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

// Prompts and resources: what clients show as slash commands and attachable documents.
const { prompts } = await rpc("prompts/list", {});
console.log(`${prompts.length} prompts: ${prompts.map((p) => p.name).join(", ")}`);
const promptArgs = { diagram_code_flow: { entry_point: "POST /orders" }, diagram_from_description: { description: "Login with a retry" } };
const isKnownName = (word) =>
  tools.some((t) => t.name === word || word in (t.inputSchema.properties ?? {})) || prompts.some((p) => p.name === word || (p.arguments ?? []).some((a) => a.name === word));
for (const prompt of prompts.filter((p) => !(p.arguments ?? []).some((a) => a.name === "diagram_id"))) {
  const got = await rpc("prompts/get", { name: prompt.name, arguments: promptArgs[prompt.name] ?? {} });
  const text = got.messages.map((m) => m.content.text ?? "").join("\n");
  const unknown = [...new Set(text.match(/\bdiagram_[a-z]+(?:_[a-z]+)*\b/g) ?? [])].filter((word) => !isKnownName(word));
  console.log(`  ▸ prompt ${prompt.name}: ${text.length} characters${unknown.length ? `  ✗ names unknown tools: ${unknown.join(", ")}` : ""}`);
}

const { resources } = await rpc("resources/list", {});
console.log(`${resources.length} resources: ${resources.slice(0, 6).map((r) => r.uri).join(", ")}${resources.length > 6 ? ", …" : ""}`);
for (const uri of ["diagram://guide", "diagram://types", "diagram://shapes", "diagram://diagrams"]) {
  const { contents } = await rpc("resources/read", { uri });
  console.log(`  ▸ read ${uri}: ${contents[0].text.length} characters`);
}

const created = await call("diagram_create", { name: "MCP smoke — order service", type: "flowchart" });
const id = created.result.structuredContent.id;

await call("diagram_add_elements", {
  diagram_id: id,
  nodes: [
    { id: "client", shape: "infra/browser", text: "Web client" },
    { id: "backend", shape: "group", text: "Backend" },
    { id: "api", shape: "infra/api-gateway", text: "API gateway", parent: "backend" },
    { id: "orders", text: "Order service", color: "blue", parent: "backend" },
    { id: "queue", shape: "kafka", text: "Order events", parent: "backend" },
    { id: "db", shape: "postgres", text: "Orders DB", parent: "backend" },
    { id: "bogus", shape: "no-such-shape", text: "Unknown shape falls back" },
  ],
  edges: [
    { from: "client", to: "api", text: "HTTPS" },
    { from: "api", to: "orders" },
    { from: "orders", to: "db", text: "SQL" },
    { from: "orders", to: "queue", kind: "dashed", text: "publishes" },
    { from: "orders", to: "missing-node" },
  ],
});

await call("diagram_update_elements", { diagram_id: id, nodes: [{ id: "bogus", text: "Notification worker", shape: "infra/worker", parent: "backend" }], edges: [] });
await call("diagram_add_elements", { diagram_id: id, nodes: [], edges: [{ from: "queue", to: "bogus", text: "consumes" }], layout: { algorithm: "layered", direction: "right" } });
await call("diagram_read", { diagram_id: id });
await call("diagram_add_comment", { diagram_id: id, target: "queue", text: "Should this be a dead-letter queue as well?" });
await call("diagram_list_comments", { diagram_id: id });
await call("diagram_get_selection", { diagram_id: id });
await call("diagram_list_shapes", { query: "queue" });
await call("diagram_list_types", { query: "sequence" });
await call("diagram_checkpoint", { diagram_id: id, action: "save", name: "after first draft" });

const outDir = path.resolve(".gallery");
mkdirSync(outDir, { recursive: true });
const preview = await call("diagram_preview", { diagram_id: id });
const image = preview.result.content.find((c) => c.type === "image");
if (image) {
  writeFileSync(path.join(outDir, "mcp-preview.png"), Buffer.from(image.data, "base64"));
  console.log("  preview saved to .gallery/mcp-preview.png");
}

for (const format of ["svg", "mermaid", "drawio", "pdf", "pptx", "png"]) {
  await call("diagram_export", { diagram_id: id, format }, { quiet: ["svg", "drawio"].includes(format) });
}

const sequence = await call("diagram_create", { name: "MCP smoke — checkout sequence", type: "uml-sequence" });
const sequenceId = sequence.result.structuredContent.id;
await call("diagram_build_sequence", {
  diagram_id: sequenceId,
  participants: [{ id: "user", name: "User", kind: "actor" }, { id: "api", name: "API" }, { id: "db", name: "Database" }],
  messages: [
    { from: "user", to: "api", text: "POST /orders" },
    { from: "api", to: "api", text: "validate" },
    { from: "api", to: "db", text: "INSERT order" },
    { from: "db", to: "api", text: "order id", kind: "return" },
    { from: "api", to: "user", text: "201 Created", kind: "return" },
  ],
});
const sequencePreview = await call("diagram_preview", { diagram_id: sequenceId });
const sequenceImage = sequencePreview.result.content.find((c) => c.type === "image");
if (sequenceImage) writeFileSync(path.join(outDir, "mcp-sequence.png"), Buffer.from(sequenceImage.data, "base64"));

const outline = await rpc("resources/read", { uri: `diagram://diagram/${id}` });
console.log(`\n▸ resource diagram://diagram/${id}: ${outline.contents[0].text.split("\n").length} lines`);
const review = await rpc("prompts/get", { name: "diagram_review", arguments: { diagram_id: id } });
console.log(`▸ prompt diagram_review for ${id}: ${review.messages[0].content.text.length} characters`);

console.log(`\nDone. Open ${base}/d/${id}`);
