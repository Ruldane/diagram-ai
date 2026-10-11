import type { DiagramDoc, Id } from "@/core/model/types";

import { describeContext, EDITOR_BRIEF } from "../prompt";
import type { HistoryMessage } from "../request";

/** Earlier messages carried into a fresh CLI session (switching engine, or a lost session), capped. */
const HISTORY_LIMIT_CHARS = 6_000;

/**
 * What a CLI is told about its job: the shared editor brief, which diagram is
 * open and what is selected, and what it may touch. The MCP server's own
 * instructions and drawing guide reach it through the tool connection.
 */
export function bridgeBrief(doc: DiagramDoc, selection: Id[], options: { folderName?: string } = {}): string {
  const files = options.folderName
    ? `You may read files in the working folder (${options.folderName}) with the read-only file tools when the person asks about them. Never change files.`
    : "Do not read or change files, and do not run commands: only the diagram tools are for you to use.";
  return `${EDITOR_BRIEF}\n- ${files}\n\n${describeContext(doc, selection)}`;
}

/** The text sent on stdin: the new message, preceded by the conversation so far when the CLI has no session to resume. */
export function bridgePrompt(history: HistoryMessage[], resumed: boolean): string {
  const last = history.at(-1)?.text ?? "";
  if (resumed || history.length < 2) return last;
  let earlier = history
    .slice(0, -1)
    .map((message) => `${message.role === "user" ? "Person" : "Assistant"}: ${message.text}`)
    .join("\n\n");
  if (earlier.length > HISTORY_LIMIT_CHARS) earlier = `…${earlier.slice(-HISTORY_LIMIT_CHARS)}`;
  return `Earlier in this conversation:\n\n${earlier}\n\n---\n\nThe person's new message:\n\n${last}`;
}
