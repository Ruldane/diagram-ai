import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { nodeLabel } from "@/core/model/queries";

import { commentBlock } from "../format";
import { diagramId, IDEMPOTENT_WRITE, READ_ONLY, registerTool, WRITE, type ToolContext } from "../toolkit";

export function registerReviewTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, {
    name: "diagram_get_selection",
    title: "Get what the user has selected",
    description:
      "Return the elements the user currently has selected in the browser, and the part of the canvas they are looking at. Use it when the user says “this”, “these”, “the selected nodes” or “here”. Returns an empty selection when no browser tab is open on the diagram.",
    input: { diagram_id: diagramId },
    annotations: READ_ONLY,
    run: async ({ diagram_id }, { service, hub }) => {
      const doc = await service.get(diagram_id);
      const presence = hub.latestPresence(diagram_id);
      if (!presence) return "No browser tab is currently open on this diagram, so there is no selection. Ask the user which elements they mean, or use diagram_read.";
      const selected = presence.selection.filter((id) => id in doc.nodes || id in doc.edges);
      const lines = selected.map((id) => {
        const node = doc.nodes[id];
        if (node) return `- node \`${id}\` [${node.shape}] "${nodeLabel(node)}"`;
        const edge = doc.edges[id];
        return `- edge \`${id}\`: \`${edge.from.node ?? "?"}\` → \`${edge.to.node ?? "?"}\`${edge.text ? ` "${edge.text}"` : ""}`;
      });
      const view = presence.viewport;
      return {
        text: [
          selected.length ? `The user has ${selected.length} element(s) selected:` : "Nothing is selected right now.",
          ...lines,
          ...(view ? [`Visible canvas area: x ${Math.round(view.x)}…${Math.round(view.x + view.w)}, y ${Math.round(view.y)}…${Math.round(view.y + view.h)}.`] : []),
        ].join("\n"),
        structured: { selection: selected, viewport: view ?? null },
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_highlight",
    title: "Point at elements for the user",
    description:
      "Flash elements on the user's canvas and scroll them into view, with an optional short message. Use it to show the user what you are talking about (“this is the bottleneck”) or what you just changed. Nothing is modified.",
    input: {
      diagram_id: diagramId,
      ids: z.array(z.string().max(64)).min(1).max(100).describe("Node or edge ids to highlight."),
      message: z.string().max(200).optional().describe("Short note shown next to the highlight."),
    },
    annotations: READ_ONLY,
    run: async ({ diagram_id, ids, message }, { service, hub, actor }) => {
      const doc = await service.get(diagram_id);
      const known = ids.filter((id) => id in doc.nodes || id in doc.edges);
      if (!known.length) return `Error: none of these ids exist in the diagram: ${ids.join(", ")}. Use diagram_read to list ids.`;
      hub.publish(diagram_id, { type: "highlight", ids: known, message, actor });
      const viewers = hub.viewers(diagram_id);
      return `Highlighted ${known.length} element(s)${viewers ? "" : " — note: no browser tab is currently open on this diagram, so nobody saw it"}.`;
    },
  });

  registerTool(server, ctx, {
    name: "diagram_list_comments",
    title: "List comments",
    description:
      "Read the comment threads people left on a diagram: who said what, on which element, and whether it is resolved. Comments are how the user leaves review notes and change requests for you — check them before making changes, and resolve them when done.",
    input: {
      diagram_id: diagramId,
      include_resolved: z.boolean().default(false).describe("Also return resolved threads."),
    },
    annotations: READ_ONLY,
    run: async ({ diagram_id, include_resolved }, { service }) => {
      const doc = await service.get(diagram_id);
      const all = Object.values(doc.comments).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      const shown = all.filter((c) => include_resolved || !c.resolved);
      if (!shown.length) return all.length ? `No open comments (${all.length} resolved; pass include_resolved to see them).` : "There are no comments on this diagram.";
      return {
        text: [`${shown.length} comment thread(s):`, ...shown.map((c) => commentBlock(c, doc.nodes))].join("\n"),
        structured: { comments: shown },
      };
    },
  });

  registerTool(server, ctx, {
    name: "diagram_add_comment",
    title: "Add a comment or reply",
    description:
      "Leave a comment pinned to an element, or reply to an existing thread. Use comments to ask the user a question about a specific part, explain a design choice, or flag something that needs their decision — instead of silently guessing.",
    input: {
      diagram_id: diagramId,
      text: z.string().min(1).max(2000).describe("The comment."),
      target: z.string().max(64).optional().describe("Node or edge id to pin a new comment to. Omit for a general comment."),
      reply_to: z.string().max(64).optional().describe("Comment id to reply to (from diagram_list_comments). Takes precedence over target."),
    },
    annotations: WRITE,
    run: async ({ diagram_id, text, target, reply_to }, { service, actor }) => {
      if (reply_to) {
        const comment = await service.replyToComment(diagram_id, reply_to, text, actor);
        return `Replied to comment ${comment.id} (${comment.replies.length} repl${comment.replies.length === 1 ? "y" : "ies"} in the thread).`;
      }
      const comment = await service.addComment(diagram_id, { text, target }, actor);
      return `Added comment ${comment.id}${target ? ` on ${target}` : ""}.`;
    },
  });

  registerTool(server, ctx, {
    name: "diagram_resolve_comment",
    title: "Resolve or re-open a comment",
    description: "Mark a comment thread as resolved once you have addressed it (or re-open it). Reply first with diagram_add_comment to say what you did.",
    input: {
      diagram_id: diagramId,
      comment_id: z.string().max(64).describe("Comment id from diagram_list_comments."),
      resolved: z.boolean().default(true),
    },
    annotations: IDEMPOTENT_WRITE,
    run: async ({ diagram_id, comment_id, resolved }, { service, actor }) => {
      const comment = await service.resolveComment(diagram_id, comment_id, resolved, actor);
      return `Comment ${comment.id} is now ${comment.resolved ? "resolved" : "open"}.`;
    },
  });
}
