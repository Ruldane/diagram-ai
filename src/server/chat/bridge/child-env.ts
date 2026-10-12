import type { CliName } from "./binary";

/**
 * Variables that would change how the Claude Code CLI authenticates or where
 * it talks to. An API key left in this server's environment would silently
 * make a "plan" run bill the API instead, so none of these reach the child.
 */
const STRIPPED: Record<CliName, string[]> = {
  claude: [
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
  ],
};

/**
 * Set for every child: this is a diagramming helper, so the person's own
 * CLAUDE.md files (user level and every parent of the working folder) and the
 * auto-memory they feed must not steer it. Older versions ignore the names.
 */
const ADDED: Record<CliName, Record<string, string>> = {
  claude: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
};

/**
 * The environment for a CLI child: this process's, minus credentials and
 * routing overrides, plus the `ADDED` settings. Names are matched
 * case-insensitively (Windows treats `Path` and `PATH` as one variable) and
 * the result has each name once.
 */
export function buildChildEnv(cli: CliName, source: Record<string, string | undefined> = process.env): Record<string, string> {
  const added = ADDED[cli];
  const stripped = new Set([...STRIPPED[cli], ...Object.keys(added)].map((name) => name.toLowerCase()));
  const out: Record<string, string> = { ...added };
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || stripped.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}
