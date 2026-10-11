import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { hasDiagramType } from "@/core/catalog";
import { isEdgeKind } from "@/core/edges/kinds";
import { hasShape, listLibraries } from "@/core/shapes/registry";

import type { DiagramService } from "../service";
import { PROMPT_NAMES } from "./prompts";

/**
 * Helpers for the MCP surface tests: a real server over an in-memory
 * transport, backed by a service over a temporary data directory, and a
 * checker that finds names in free text that do not exist.
 */

export interface Harness {
  client: Client;
  service: DiagramService;
  baseUrl: string;
  close(): Promise<void>;
}

const BASE_URL = "http://localhost:3000";

/** `DIAGRAM_DATA_DIR` is read when `config` loads, so the server modules are imported only after it is set. */
export async function createHarness(): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), "diagram-ai-mcp-"));
  process.env.DIAGRAM_DATA_DIR = dir;
  const { DATA_DIR } = await import("../config");
  if (DATA_DIR !== path.resolve(dir)) {
    throw new Error(`config was loaded before DIAGRAM_DATA_DIR was set (${DATA_DIR}); refusing to run against a real data directory.`);
  }

  const [{ createMcpServer }, { FileRepository, createRepositoryState }, { DiagramService, createServiceState }, { Hub, createHubState }] = await Promise.all([
    import("./server"),
    import("../store/repository"),
    import("../service"),
    import("../realtime/hub"),
  ]);

  const repository = new FileRepository(createRepositoryState());
  const hub = new Hub(createHubState());
  const service = new DiagramService(repository, hub, createServiceState());
  const server = createMcpServer({ service, hub, actor: { kind: "agent", id: "test-agent", name: "Test agent" }, baseUrl: BASE_URL });

  const client = new Client({ name: "mcp-surface-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    service,
    baseUrl: BASE_URL,
    async close() {
      await client.close();
      await server.close();
      await repository.flush();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Text of a prompt message or resource, joined. */
export function promptText(result: { messages: { content: { type: string; text?: string } }[] }): string {
  return result.messages.map((message) => message.content.text ?? "").join("\n");
}

/* ---------------------------------------------------------- reference check */

export interface KnownNames {
  /** Tool names. */
  tools: Set<string>;
  /** Everything snake_case that may legitimately appear: tool names, their argument names, prompt names and arguments. */
  identifiers: Set<string>;
  /** Resource URIs and URI templates the server serves. */
  resources: Set<string>;
}

/** Collects the real tool and argument names from a connected client. */
export async function collectKnownNames(client: Client): Promise<KnownNames> {
  const { tools } = await client.listTools();
  const { prompts } = await client.listPrompts();
  const { resources } = await client.listResources();
  const { resourceTemplates } = await client.listResourceTemplates();
  const names = new Set(tools.map((tool) => tool.name));
  const identifiers = new Set<string>([...names, ...PROMPT_NAMES]);
  for (const tool of tools) {
    for (const property of Object.keys(tool.inputSchema.properties ?? {})) identifiers.add(property);
  }
  for (const prompt of prompts) {
    for (const argument of prompt.arguments ?? []) identifiers.add(argument.name);
  }
  return { tools: names, identifiers, resources: new Set([...resources.map((r) => r.uri), ...resourceTemplates.map((t) => t.uriTemplate)]) };
}

/** Snake_case words used as example data in prompts and guides (column names, not API names). */
const EXAMPLE_IDENTIFIERS = new Set(["table_name", "customer_id"]);

/** Message-level `kind` values that are not edge kinds. */
const OTHER_KINDS = new Set(["sync", "actor", "participant"]);

/**
 * Finds names in `text` that the product does not have: tools and arguments,
 * shape ids, edge kinds, diagram types and resources. Returns one line per problem.
 *
 * `identifiers` picks how strict the snake_case check is: `"diagram"` only
 * vets `diagram_*` words (tool names), which is right for text that also talks
 * about other systems (column names, config keys); `"all"` vets every
 * snake_case word, for text we write ourselves.
 */
export function findUnknownReferences(text: string, known: KnownNames, identifiers: "diagram" | "all" = "diagram"): string[] {
  const problems: string[] = [];
  const libraries = listLibraries().map((library) => library.id);

  const identifierPattern = identifiers === "all" ? /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g : /\bdiagram(?:_[a-z0-9]+)+\b/g;
  for (const word of new Set(text.match(identifierPattern) ?? [])) {
    if (!known.identifiers.has(word) && !EXAMPLE_IDENTIFIERS.has(word)) problems.push(`unknown identifier \`${word}\``);
  }

  const shapePattern = new RegExp(`\\b(?:${libraries.join("|")})/[a-z0-9]+(?:-[a-z0-9]+)*\\b`, "g");
  for (const id of new Set(text.match(shapePattern) ?? [])) {
    if (!hasShape(id)) problems.push(`unknown shape \`${id}\``);
  }

  for (const uri of new Set(text.match(/diagram:\/\/[A-Za-z0-9{}/_-]+/g) ?? [])) {
    if (!known.resources.has(uri)) problems.push(`unknown resource \`${uri}\``);
  }

  for (const match of text.matchAll(/\bkind\s*[:=]?\s*["`]([a-z-]+)["`]/g)) {
    const kind = match[1];
    if (!isEdgeKind(kind) && !OTHER_KINDS.has(kind)) problems.push(`unknown edge kind \`${kind}\``);
  }

  for (const match of text.matchAll(/\btype\s*[:=]?\s*["`]([a-z0-9-]+)["`]/g)) {
    if (!hasDiagramType(match[1])) problems.push(`unknown diagram type \`${match[1]}\``);
  }

  return problems;
}

/** Backticked tokens in one table column or `- Label:` line, for checking lists of ids. */
export function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}
