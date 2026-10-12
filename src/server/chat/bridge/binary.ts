import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The command-line programs the bridge can drive. Only Claude Code is bridged (see docs/assistant.md). */
export type CliName = "claude";

/** Everything resolution reads from the machine, injectable so every platform layout can be tested. */
export interface Machine {
  platform: NodeJS.Platform;
  /** Case-insensitive lookup on Windows, like `process.env`. */
  env(name: string): string | undefined;
  isFile(file: string): boolean;
  homedir(): string;
}

export interface ResolvedBinary {
  path: string;
  /** `native`: run it directly. `shim`: a `.cmd`/`.bat` wrapper that Windows can only run through a shell. */
  kind: "native" | "shim";
  /** Where it was found, for diagnostics. */
  source: "override" | "known" | "path";
}

export function currentMachine(): Machine {
  const win = process.platform === "win32";
  // `process.env` is case-insensitive on Windows already; this makes the fake machines behave the same.
  const lookup = win
    ? (name: string) => {
        const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
        return key ? process.env[key] : undefined;
      }
    : (name: string) => process.env[name];
  return {
    platform: process.platform,
    env: lookup,
    isFile(file) {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    },
    homedir: () => os.homedir(),
  };
}

const OVERRIDE_VAR: Record<CliName, string> = { claude: "DIAGRAM_AI_CLAUDE_PATH" };

/** Real executables an npm shim points at, relative to the directory holding the shim. */
const PACKAGE_EXECUTABLES: Record<CliName, string[]> = {
  claude: ["node_modules/@anthropic-ai/claude-code/bin/claude.exe"],
};

function joinFor(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function knownLocations(name: CliName, machine: Machine): string[] {
  const p = joinFor(machine.platform);
  const home = machine.homedir();
  const out: string[] = [];
  if (machine.platform === "win32") {
    const appData = machine.env("APPDATA") ?? p.join(home, "AppData", "Roaming");
    out.push(p.join(home, ".local", "bin", `${name}.exe`), p.join(home, ".claude", "local", `${name}.exe`), p.join(appData, "npm", `${name}.cmd`));
  } else {
    out.push(
      p.join(home, ".local", "bin", name),
      p.join(home, ".claude", "local", name),
      p.join(home, ".npm-global", "bin", name),
      p.join(home, ".volta", "bin", name),
      `/usr/local/bin/${name}`,
      `/opt/homebrew/bin/${name}`,
      `/usr/bin/${name}`,
    );
  }
  return out;
}

const isShim = (file: string): boolean => /\.(cmd|bat)$/i.test(file);

/** Prefers the real executable behind an npm `.cmd` shim, which can be spawned without a shell. */
function unwrapShim(name: CliName, shim: string, machine: Machine): ResolvedBinary | null {
  const p = joinFor(machine.platform);
  for (const relative of PACKAGE_EXECUTABLES[name]) {
    const candidate = p.join(p.dirname(shim), ...relative.split("/"));
    if (machine.isFile(candidate)) return { path: candidate, kind: "native", source: "path" };
  }
  return null;
}

function classify(name: CliName, file: string, source: ResolvedBinary["source"], machine: Machine): ResolvedBinary {
  if (machine.platform === "win32" && isShim(file)) {
    return unwrapShim(name, file, machine) ?? { path: file, kind: "shim", source };
  }
  return { path: file, kind: "native", source };
}

/**
 * Finds the official CLI. Order: the `DIAGRAM_AI_*_PATH` override, well-known
 * install locations, then PATH (honouring PATHEXT on Windows, real `.exe`
 * before `.cmd`). Never runs anything; `.ps1` scripts are not considered.
 */
export function resolveBinary(name: CliName, machine: Machine = currentMachine()): ResolvedBinary | null {
  const override = machine.env(OVERRIDE_VAR[name])?.trim();
  if (override) return machine.isFile(override) ? classify(name, override, "override", machine) : null;

  for (const known of knownLocations(name, machine)) {
    if (machine.isFile(known)) return classify(name, known, "known", machine);
  }

  const p = joinFor(machine.platform);
  const dirs = (machine.env("PATH") ?? "").split(machine.platform === "win32" ? ";" : ":").map((dir) => dir.trim().replace(/^"|"$/g, "")).filter(Boolean);
  if (machine.platform !== "win32") {
    for (const dir of dirs) {
      const candidate = p.join(dir, name);
      if (machine.isFile(candidate)) return { path: candidate, kind: "native", source: "path" };
    }
    return null;
  }

  const pathext = (machine.env("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => ext.toLowerCase()).filter(Boolean);
  const executable = [".exe", ".com"].filter((ext) => pathext.includes(ext));
  const scripts = [".cmd", ".bat"].filter((ext) => pathext.includes(ext));
  for (const group of [executable, scripts]) {
    for (const dir of dirs) {
      for (const ext of group) {
        const candidate = p.join(dir, `${name}${ext}`);
        if (machine.isFile(candidate)) return classify(name, candidate, "path", machine);
      }
    }
  }
  return null;
}
