/** What each tool is doing while it runs, shown on its step row. */
const RUNNING: Record<string, string> = {
  diagram_list: "Looking for diagrams…",
  diagram_create: "Creating a diagram…",
  diagram_read: "Reading the diagram…",
  diagram_configure: "Updating settings…",
  diagram_add_elements: "Drawing…",
  diagram_update_elements: "Editing…",
  diagram_delete_elements: "Removing elements…",
  diagram_layout: "Arranging…",
  diagram_build_sequence: "Building a sequence…",
  diagram_list_types: "Browsing diagram types…",
  diagram_list_shapes: "Browsing shapes…",
  diagram_preview: "Looking at the result…",
  diagram_get_selection: "Checking your selection…",
  diagram_highlight: "Pointing things out…",
  diagram_list_comments: "Reading comments…",
  diagram_add_comment: "Commenting…",
  diagram_resolve_comment: "Resolving a comment…",
  diagram_review_status: "Checking what is under review…",
  diagram_import: "Importing…",
  diagram_checkpoint: "Working with checkpoints…",
};

export function runningLabel(tool: string): string {
  return RUNNING[tool] ?? "Working…";
}
