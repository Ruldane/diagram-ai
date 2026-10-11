/** Display colour for an actor, as a CSS variable reference. */
export function actorColor(actor: { kind?: string; id: string }): string {
  if (actor.kind === "human") return "var(--ink)";
  if (actor.id.includes("claude")) return "var(--agent-claude)";
  if (actor.id.includes("codex")) return "var(--agent-codex)";
  return "var(--agent-other)";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}

/** "just now", "3 min ago", "14:02", "12 Mar". */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  const date = new Date(then);
  if (seconds < 86_400) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

export const isMac = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
