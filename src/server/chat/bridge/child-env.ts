import type { CliName } from "./binary";

/**
 * Variables that would change how the Claude Code CLI authenticates or where
 * it talks to. An API key left in this server's environment would silently
 * make a "plan" run bill the API instead, so none of these reach the child.
 */
const CLAUDE_STRIPPED = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_PROFILE",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_SIMPLE",
  "CLAUDE_CONFIG_DIR",
];

/** Codex keeps its own auth. Only Anthropic's variables are removed, as they have no business there. */
const CODEX_STRIPPED = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_BASE_URL"];

/**
 * The environment for a CLI child: this process's, minus credentials and
 * routing overrides. Names are matched case-insensitively (Windows treats
 * `Path` and `PATH` as one variable) and the result has each name once.
 */
export function buildChildEnv(cli: CliName, source: Record<string, string | undefined> = process.env): Record<string, string> {
  const stripped = new Set((cli === "claude" ? CLAUDE_STRIPPED : CODEX_STRIPPED).map((name) => name.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || stripped.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}
