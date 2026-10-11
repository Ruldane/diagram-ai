/**
 * Writes the generated part of the Claude Code skill: the drawing guide, which
 * lives in `src/server/mcp/guide.ts` and is also served as the `diagram://guide`
 * MCP resource. `src/server/mcp/guide.test.ts` fails when the copy is stale.
 *
 *   npx tsx scripts/sync-skill.ts           → rewrite the skill's copy
 *   npx tsx scripts/sync-skill.ts --check   → exit 1 when it is out of date
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SKILL_GUIDE_PATH, skillGuideFile } from "../src/server/mcp/guide";

const target = path.resolve(SKILL_GUIDE_PATH);
const expected = skillGuideFile();
const current = existsSync(target) ? readFileSync(target, "utf8") : null;

if (process.argv.includes("--check")) {
  if (current === expected) {
    console.log(`${SKILL_GUIDE_PATH} is up to date.`);
  } else {
    console.error(`${SKILL_GUIDE_PATH} is out of date. Run: npx tsx scripts/sync-skill.ts`);
    process.exit(1);
  }
} else if (current === expected) {
  console.log(`${SKILL_GUIDE_PATH} already up to date.`);
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, expected, "utf8");
  console.log(`Wrote ${SKILL_GUIDE_PATH}`);
}
