import { mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { DATA_DIR } from "../../config";
import { invalid } from "../../errors";

/**
 * Where a CLI runs when the person has not chosen a folder: an empty directory
 * owned by the bridge. The CLIs read project hooks and MCP config from their
 * working directory, so running them somewhere with nothing in it keeps what
 * they load to what the app asks for.
 */
export function defaultBridgeWorkdir(): string {
  const configured = process.env.DIAGRAM_AI_BRIDGE_WORKDIR?.trim();
  const dir = configured ? path.resolve(configured) : path.join(/* turbopackIgnore: true */ DATA_DIR, "bridge", "workdir");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A folder the person picked, checked to be an existing absolute directory. Returns its real path. */
export function validateWorkdir(candidate: string): string {
  const value = candidate.trim();
  if (!value || value.includes("\0") || !path.isAbsolute(value)) throw invalid("The working folder must be an absolute path, for example C:\\Projects\\app or /home/me/app.");
  let real: string;
  try {
    real = realpathSync(value);
    if (!statSync(real).isDirectory()) throw new Error("not a directory");
  } catch {
    throw invalid(`The working folder "${value}" does not exist or is not a folder.`);
  }
  return real;
}
