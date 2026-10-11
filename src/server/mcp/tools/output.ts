import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { EXPORT_FORMATS } from "@/core/protocol";
import { EXPORTS_DIR } from "@/server/config";

import { diagramUrl } from "../format";
import { diagramId, READ_ONLY, registerTool, WRITE, type ToolContext } from "../toolkit";

const TEXT_FORMATS = new Set(["svg", "drawio", "mermaid", "json"]);

export function registerOutputTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, {
    name: "diagram_preview",
    title: "See the diagram",
    description:
      "Render the diagram (or just some elements) to a PNG image and return it so you can look at your work. Use it after drawing or editing to check for overlapping nodes, unreadable labels, tangled connectors or a poor layout, then fix what you see. This is exactly what the user sees on their canvas.",
    input: {
      diagram_id: diagramId,
      ids: z.array(z.string().max(64)).max(500).optional().describe("Only render these elements (zoom in on a region)."),
      scale: z.number().min(0.25).max(3).default(1.5).describe("Pixel density. Large diagrams are scaled down automatically."),
    },
    annotations: READ_ONLY,
    run: async ({ diagram_id, ids, scale }, { service, hub, actor }) => {
      const doc = await service.get(diagram_id);
      if (Object.keys(doc.nodes).length === 0) return "The diagram is empty — nothing to preview yet. Add content with diagram_add_elements.";
      const { png, width, height } = await service.preview(diagram_id, { ids, scale });
      hub.log(diagram_id, actor, "preview", "looked at the diagram");
      return {
        text: `Preview of "${doc.name}" (${width}×${height}px, ${Object.keys(doc.nodes).length} nodes, ${Object.keys(doc.edges).length} edges).`,
        images: [{ data: Buffer.from(png).toString("base64"), mimeType: "image/png" }],
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_export",
    title: "Export a diagram to a file",
    description: `Export a diagram as SVG, PNG, PDF (vector, real text), PPTX (editable shapes or an image per slide), draw.io XML, Mermaid text or the native JSON.

Text formats (svg, drawio, mermaid, json) are returned inline so you can save them where the user wants with your own file tools. Binary formats (png, pdf, pptx) are written to the app's export folder; the response gives the absolute file path and a download URL — copy the file to its destination if the user asked for a specific location.

scope "frames" exports one page/slide per top-level frame; Mermaid export covers flowcharts and sequence diagrams.`,
    input: {
      diagram_id: diagramId,
      format: z.enum(EXPORT_FORMATS).describe("Output format."),
      scope: z.enum(["all", "frames"]).default("all").describe("'frames': one page per frame (PDF/PPTX)."),
      scale: z.number().min(0.5).max(6).default(2).describe("PNG pixel density."),
      transparent: z.boolean().default(false).describe("Transparent background (SVG/PNG)."),
      page_size: z.enum(["fit", "a4", "a3", "letter", "legal", "tabloid"]).default("fit").describe("PDF page: 'fit' sizes the page to the diagram; sheets scale the diagram to fit, centred."),
      slide_mode: z.enum(["editable", "image"]).default("editable").describe("PPTX: native editable shapes, or one pixel-exact picture per slide."),
    },
    annotations: READ_ONLY,
    run: async ({ diagram_id, format, scope, scale, transparent, page_size, slide_mode }, { service, hub, actor, baseUrl }) => {
      const file = await service.export(diagram_id, format, {
        scope: { kind: scope },
        scale,
        background: transparent ? "transparent" : "doc",
        pageSize: page_size,
        slideMode: slide_mode,
      });
      hub.log(diagram_id, actor, "export", `exported the diagram as ${format.toUpperCase()}`);
      const downloadUrl = `${baseUrl}/api/diagrams/${diagram_id}/export?format=${format}`;

      if (typeof file.data === "string" && TEXT_FORMATS.has(format)) {
        return `${file.fileName} (${file.data.length} characters). Save this content to a file for the user:\n\n${file.data}`;
      }
      await mkdir(EXPORTS_DIR, { recursive: true });
      const target = path.join(EXPORTS_DIR, file.fileName);
      await writeFile(target, file.data);
      return {
        text: [
          `Exported ${file.pages} page(s) to ${target}`,
          `Download URL: ${downloadUrl}`,
          "Copy the file to wherever the user wants it.",
        ].join("\n"),
        structured: { path: target, url: downloadUrl, file_name: file.fileName, pages: file.pages },
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_import",
    title: "Import Mermaid, draw.io or JSON",
    description: `Create a new diagram from existing source: Mermaid text (flowchart / graph and sequenceDiagram), a draw.io / diagrams.net XML file, or a Diagram AI JSON export. Pass the file's text content.

Handy when the user already has a diagram in their repo or docs: read the file with your own tools and pass its content here. Mermaid input is auto-arranged; draw.io keeps its positions. Unsupported constructs are reported as warnings.`,
    input: {
      format: z.enum(["mermaid", "drawio", "json"]),
      content: z.string().min(1).max(5_000_000).describe("The source text."),
      name: z.string().max(200).optional().describe("Name for the new diagram."),
    },
    annotations: WRITE,
    run: async ({ format, content, name }, { service, actor, baseUrl }) => {
      const { doc, warnings } = await service.importDiagram({ format, content, name }, actor);
      return {
        text: [
          `Imported "${doc.name}" — id: \`${doc.id}\`, ${Object.keys(doc.nodes).length} nodes, ${Object.keys(doc.edges).length} edges.`,
          `Open: ${diagramUrl(baseUrl, doc.id)}`,
          ...(warnings.length ? ["Warnings:", ...warnings.slice(0, 20).map((w) => `- ${w}`)] : []),
        ].join("\n"),
        structured: { id: doc.id, url: diagramUrl(baseUrl, doc.id), warnings },
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_checkpoint",
    title: "Save, list or restore checkpoints",
    description: `Checkpoints are named snapshots of a diagram.

- action "save": snapshot the current state. Do this before a large or risky rewrite so the user can go back.
- action "list": show saved checkpoints with their ids.
- action "restore": replace the diagram with a checkpoint (the current state is checkpointed automatically first, so it is reversible).`,
    input: {
      diagram_id: diagramId,
      action: z.enum(["save", "list", "restore"]),
      name: z.string().max(120).optional().describe("Label for a new checkpoint, e.g. 'before splitting the API'."),
      checkpoint_id: z.string().max(64).optional().describe("Required for restore."),
    },
    annotations: WRITE,
    run: async ({ diagram_id, action, name, checkpoint_id }, { service, actor }) => {
      if (action === "save") {
        const snapshot = await service.createSnapshot(diagram_id, name, actor);
        return `Saved checkpoint "${snapshot.name}" (id: ${snapshot.id}, ${snapshot.nodeCount} nodes).`;
      }
      if (action === "list") {
        const snapshots = await service.listSnapshots(diagram_id);
        if (!snapshots.length) return "No checkpoints yet. Save one with action \"save\".";
        return [
          `${snapshots.length} checkpoint(s), newest first:`,
          ...snapshots.map((s) => `- \`${s.id}\` — ${s.name} · ${s.createdAt.slice(0, 16).replace("T", " ")} · ${s.nodeCount} nodes, ${s.edgeCount} edges · by ${s.author.name}`),
        ].join("\n");
      }
      if (!checkpoint_id) return "Error: checkpoint_id is required to restore. Use action \"list\" to see ids.";
      const doc = await service.restoreSnapshot(diagram_id, checkpoint_id, actor);
      return `Restored. The diagram now has ${Object.keys(doc.nodes).length} nodes and ${Object.keys(doc.edges).length} edges. The previous state was saved as a checkpoint.`;
    },
  });
}
