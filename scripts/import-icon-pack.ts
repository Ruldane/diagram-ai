/**
 * Imports a folder, zip or set of SVG files as an icon pack into the packs
 * store, so every editor and agent on the server gets it as a shape library.
 *
 *   npm run icons:import -- <folder|file.zip|file.svg…> [--name "AWS Architecture Icons"]
 *
 * Options:
 *   --name <text>         Pack name (default: taken from the first path)
 *   --id <id>             Library id (default: derived from the name)
 *   --description <text>  One line shown in the shape library
 *   --source <text>       Where the icons came from
 *   --data-dir <dir>      Data directory (default: DIAGRAM_DATA_DIR or ./data)
 *   --dry-run             Convert and report, write nothing
 *
 * Uses the same importer as the editor's "Icon packs" dialog (`src/core/shapes/pack-import.ts`).
 * A running server notices the new pack within a second.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { importIconFiles, readZip, type ImportFile } from "../src/core/shapes/pack-import";
import { packIdFromName } from "../src/core/shapes/packs";

const USAGE =
  'Usage: npm run icons:import -- <folder|file.zip|file.svg…> [--name "Pack name"] [--id id] [--description text] [--source text] [--data-dir dir] [--dry-run]';

const VALUE_FLAGS = new Set(["--name", "--id", "--description", "--source", "--data-dir"]);

function parseArgs(argv: string[]): { inputs: string[]; options: Record<string, string>; dryRun: boolean } {
  const inputs: string[] = [];
  const options: Record<string, string> = {};
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.`);
    else inputs.push(arg);
  }
  return { inputs, options, dryRun };
}

function walk(directory: string, root: string, out: ImportFile[]): void {
  for (const name of readdirSync(directory)) {
    if (name.startsWith(".")) continue;
    const full = path.join(directory, name);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, root, out);
    else if (/\.svg$/i.test(name)) out.push({ path: path.relative(root, full).replace(/\\/g, "/"), data: readFileSync(full, "utf8") });
  }
}

function collect(input: string): ImportFile[] {
  const info = statSync(input);
  const out: ImportFile[] = [];
  if (info.isDirectory()) {
    // Keep the top folder in the path: the importer decides what is a category.
    walk(input, path.dirname(path.resolve(input)), out);
  } else if (/\.zip$/i.test(input)) {
    const entries = readZip(new Uint8Array(readFileSync(input)));
    if (!entries) throw new Error(`${input} is not a readable .zip archive.`);
    out.push(...entries);
  } else if (/\.svg$/i.test(input)) {
    out.push({ path: path.basename(input), data: readFileSync(input, "utf8") });
  } else {
    throw new Error(`${input}: expected a folder, a .zip or an .svg file.`);
  }
  return out;
}

const humanize = (raw: string): string =>
  raw
    .replace(/\.[a-z0-9]{1,4}$/i, "")
    .replace(/[\s._-]+\d{6,}.*$/, "")
    .replace(/[_-]+/g, " ")
    .trim() || "Imported icons";

async function main(): Promise<void> {
  const { inputs, options, dryRun } = parseArgs(process.argv.slice(2));
  if (!inputs.length) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (options["data-dir"]) process.env.DIAGRAM_DATA_DIR = options["data-dir"];

  // Loaded late so --data-dir is in place before the config module reads the environment.
  const { availablePackId, createPack } = await import("../src/server/packs/service");
  const { PACKS_DIR } = await import("../src/server/packs/store");

  const files = inputs.flatMap(collect);
  const name = options.name ?? humanize(path.basename(inputs[0]));
  const id = options.id ?? availablePackId(packIdFromName(name));
  const report = importIconFiles(files, { name, id, description: options.description, source: options.source });
  for (const warning of report.warnings) console.warn(`! ${warning}`);
  if (report.skipped.length) {
    const preview = report.skipped.slice(0, 8).map((item) => `    ${item.path}: ${item.reason}`);
    console.warn(`! ${report.skipped.length} file(s) skipped${preview.length ? ":" : ""}\n${preview.join("\n")}${report.skipped.length > 8 ? "\n    …" : ""}`);
  }
  if (!report.pack) {
    console.error("Nothing to import.");
    process.exitCode = 1;
    return;
  }

  const categories = [...new Set(report.pack.icons.map((icon) => icon.category).filter(Boolean))];
  console.log(`${report.pack.icons.length} icons${categories.length ? ` in ${categories.length} categories` : ""} → pack "${report.pack.name}" (${report.pack.id})`);
  if (dryRun) {
    console.log("Dry run: nothing was written.");
    return;
  }

  const result = await createPack(report.pack);
  console.log(`${result.replaced ? "Replaced" : "Saved"} ${path.join(PACKS_DIR, `${result.pack.id}.json`)}`);
  console.log("Running servers pick it up within a second; open the shape library to use it.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
