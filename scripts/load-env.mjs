import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Parses dotenv text: `KEY=value` lines, optional `export`, quotes, `#` comments. */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Loads `.env.local`, then `.env`, into `process.env` the way Next.js does:
 * variables that are already set win, and `.env.local` wins over `.env`.
 * Returns the names of the files that were read.
 */
export function loadEnvFiles(dir = process.cwd()) {
  const loaded = [];
  for (const name of [".env.local", ".env"]) {
    const file = path.join(dir, name);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    loaded.push(name);
  }
  return loaded;
}
