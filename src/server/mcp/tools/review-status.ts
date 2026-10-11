import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { diagramId, READ_ONLY, registerTool, type ToolContext } from "../toolkit";

const KIND_WORDS = { added: "added", removed: "removed", modified: "changed" } as const;

const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? "" : "s"}`;

/** "2 shapes, 1 connector": what the rearranged entries are made of. */
const rearrangedWhat = ({ nodes, edges }: { nodes: number; edges: number }): string =>
  [nodes ? count(nodes, "shape") : "", edges ? count(edges, "connector") : ""].filter(Boolean).join(", ") || "comments";

/**
 * Lets an agent see how the user is dealing with its work: what is still
 * awaiting review, and which of its elements the user put back or deleted.
 */
export function registerReviewStatusTools(server: McpServer, ctx: ToolContext): void {
  registerTool(server, ctx, {
    name: "diagram_review_status",
    title: "See what the user is reviewing",
    description:
      "Agent changes wait for the user's review: they can accept each one or revert it. This returns what is still pending (counts, and the elements added, removed or changed), and which of your elements the user reverted or deleted since — so you do not redraw what they just rejected. Read-only. Elements you changed that the user later accepted are no longer listed.",
    input: { diagram_id: diagramId },
    annotations: READ_ONLY,
    run: async ({ diagram_id }, { service }) => {
      const status = await service.reviewStatus(diagram_id);
      const { review, counts, rearranged, changes, reverted } = status;

      const lines: string[] = [];
      if (!review.active) {
        lines.push("Nothing is awaiting review: the user has accepted all agent changes made so far (or none were made).");
      } else {
        const since = review.since ? ` since ${review.since.slice(11, 16)} UTC` : "";
        lines.push(`${counts.rows} change${counts.rows === 1 ? "" : "s"} awaiting the user's review${since}${review.by ? `, started by ${review.by.name}` : ""}:`);
        const parts = [
          counts.added ? `${counts.added} added` : "",
          counts.modified ? `${counts.modified} changed` : "",
          counts.removed ? `${counts.removed} removed` : "",
          counts.layout ? `${counts.layout} rearranged (${rearrangedWhat(rearranged)})` : "",
        ].filter(Boolean);
        lines.push(parts.length ? `- ${parts.join(", ")}` : "- no differences remain; the review closes by itself");
        const listed = changes.slice(0, 40);
        for (const change of listed) {
          lines.push(`  - ${KIND_WORDS[change.kind as keyof typeof KIND_WORDS]} ${change.element} \`${change.id}\` "${change.label}"`);
        }
        if (changes.length > listed.length) lines.push(`  - …and ${changes.length - listed.length} more`);
      }

      if (reverted.length) {
        lines.push("", `The user put back or deleted ${reverted.length} of your elements (since the server started):`);
        for (const item of reverted.slice(0, 40)) {
          lines.push(`- \`${item.id}\` "${item.label}" — ${item.how === "removed" ? "deleted by the user" : "restored to how it was before your change"}`);
        }
        lines.push("Do not recreate these unless the user asks.");
      }

      return {
        text: lines.join("\n"),
        structured: {
          active: review.active,
          since: review.since ?? null,
          by: review.by?.name ?? null,
          counts,
          rearranged,
          changes,
          reverted,
        },
      };
    },
  });
}
