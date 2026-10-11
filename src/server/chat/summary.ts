import type { ToolResult } from "../mcp/registry";

export interface ToolOutcome {
  status: "done" | "error";
  /** One line for the step row: "Added 4 nodes and 3 connectors". */
  summary: string;
  /** Longer text for the expanded row. */
  detail?: string;
}

const DETAIL_LIMIT = 1_500;

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string => `${count} ${count === 1 ? singular : pluralForm}`;

const length = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** "4 nodes and 3 connectors", skipping empty parts. */
function elementCounts(nodes: number, edges: number): string {
  return [nodes ? plural(nodes, "node") : "", edges ? plural(edges, "connector") : ""].filter(Boolean).join(" and ");
}

export function resultText(result: ToolResult): string {
  return result.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Tools report some failures as plain "Error: …" text without setting the error flag. */
export function isFailure(result: ToolResult): boolean {
  return Boolean(result.isError) || /^Error:/.test(resultText(result).trimStart());
}

function successSummary(name: string, input: Record<string, unknown>, structured: Record<string, unknown>, text: string): string {
  const created = record(structured.created);
  const updated = record(structured.updated);
  const warnings = length(structured.warnings);
  const warned = warnings ? ` (${plural(warnings, "warning")})` : "";

  switch (name) {
    case "diagram_add_elements": {
      const added = elementCounts(length(created.nodes), length(created.edges));
      return `${added ? `Added ${added}` : "Nothing added"}${warned}`;
    }
    case "diagram_update_elements": {
      const changed = elementCounts(length(updated.nodes), length(updated.edges));
      return `${changed ? `Updated ${changed}` : "Nothing changed"}${warned}`;
    }
    case "diagram_delete_elements": {
      const removed = length(structured.removed);
      return removed ? `Removed ${plural(removed, "element")}` : "Nothing removed";
    }
    case "diagram_layout": {
      const ids = length(input.ids);
      return ids ? `Arranged ${plural(ids, "node")}` : "Arranged the diagram";
    }
    case "diagram_build_sequence":
      return `Built a sequence of ${plural(length(input.participants), "lifeline")} and ${plural(length(input.messages), "message")}`;
    case "diagram_create": {
      const name = typeof input.name === "string" ? input.name : "";
      return name ? `Created “${oneLine(name, 60)}”` : "Created a diagram";
    }
    case "diagram_import":
      return "Imported a diagram";
    case "diagram_configure":
      return "Updated the diagram settings";
    case "diagram_list":
      return "Listed the diagrams";
    case "diagram_read":
      return "Read the diagram";
    case "diagram_preview":
      return "Looked at the diagram";
    case "diagram_get_selection":
      return "Checked your selection";
    case "diagram_highlight": {
      const ids = length(input.ids);
      return `Highlighted ${plural(ids, "element")}`;
    }
    case "diagram_list_comments":
      return "Read the comments";
    case "diagram_add_comment":
      return input.reply_to ? "Replied to a comment" : "Added a comment";
    case "diagram_resolve_comment":
      return input.resolved === false ? "Re-opened a comment" : "Resolved a comment";
    case "diagram_review_status":
      return "Checked what is awaiting review";
    case "diagram_list_types":
      return "Browsed diagram types";
    case "diagram_list_shapes":
      return "Browsed shapes";
    case "diagram_checkpoint": {
      const action = input.action;
      if (action === "save") return "Saved a checkpoint";
      if (action === "restore") return "Restored a checkpoint";
      return "Listed checkpoints";
    }
    default:
      return oneLine(text.split("\n")[0] ?? name, 120) || name;
  }
}

/** Turns a finished tool call into the status and one-line description shown in the chat. */
export function summarizeToolCall(name: string, input: unknown, result: ToolResult): ToolOutcome {
  const text = resultText(result);
  const detail = text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT)}…` : text;
  if (isFailure(result)) {
    return { status: "error", summary: oneLine(text.replace(/^\s*Error:\s*/, ""), 180) || "The tool failed", detail };
  }
  return { status: "done", summary: successSummary(name, record(input), record(result.structuredContent), text), detail };
}
