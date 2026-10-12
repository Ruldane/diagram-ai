import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BRIDGE_ACK_HEADER, bridgeAck } from "@/core/chat-terms";

import { buildClaudeArgs, claudeMcpConfig, folderReadRules, MODEL_NAME } from "./args";
import { resolveBinary, type Machine } from "./binary";
import { buildChildEnv } from "./child-env";
import { LineSplitter, quoteForCmd } from "./child-process";
import { assertAcknowledged, assertLocalRequest, bridgeDisabledReason } from "./gating";
import { validateWorkdir } from "./workdir";

/** A machine described by the files that exist on it. */
function machine(platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}, home = platform === "win32" ? "C:\\Users\\me" : "/home/me"): Machine {
  const fold = platform === "win32";
  const lookup = new Map(Object.entries(env).map(([key, value]) => [fold ? key.toLowerCase() : key, value]));
  const present = new Set(files.map((file) => (fold ? file.toLowerCase() : file)));
  return {
    platform,
    env: (name) => lookup.get(fold ? name.toLowerCase() : name),
    isFile: (file) => present.has(fold ? file.toLowerCase() : file),
    homedir: () => home,
  };
}

describe("binary resolution", () => {
  it("honours the override before anything else, and does not fall back from a bad one", () => {
    const good = machine("linux", ["/opt/c/claude", "/home/me/.local/bin/claude"], { DIAGRAM_AI_CLAUDE_PATH: "/opt/c/claude" });
    expect(resolveBinary("claude", good)).toEqual({ path: "/opt/c/claude", kind: "native", source: "override" });
    const bad = machine("linux", ["/home/me/.local/bin/claude"], { DIAGRAM_AI_CLAUDE_PATH: "/nope/claude" });
    expect(resolveBinary("claude", bad)).toBeNull();
  });

  it("finds the official install locations on Linux and macOS, then PATH", () => {
    expect(resolveBinary("claude", machine("linux", ["/home/me/.local/bin/claude"]))?.path).toBe("/home/me/.local/bin/claude");
    expect(resolveBinary("claude", machine("darwin", ["/opt/homebrew/bin/claude"], {}, "/Users/me"))?.path).toBe("/opt/homebrew/bin/claude");
    expect(resolveBinary("claude", machine("darwin", ["/Users/me/tools/claude"], { PATH: "/usr/bin:/Users/me/tools" }, "/Users/me"))).toEqual({
      path: "/Users/me/tools/claude",
      kind: "native",
      source: "path",
    });
    expect(resolveBinary("claude", machine("linux", [], { PATH: "/usr/bin" }))).toBeNull();
  });

  it("prefers a real .exe over a .cmd shim on Windows, wherever each is on PATH", () => {
    const files = ["C:\\npm\\claude.cmd", "C:\\tools\\claude.exe"];
    const found = resolveBinary("claude", machine("win32", files, { Path: "C:\\npm;C:\\tools", PATHEXT: ".COM;.EXE;.BAT;.CMD" }));
    expect(found).toEqual({ path: "C:\\tools\\claude.exe", kind: "native", source: "path" });
  });

  it("unwraps an npm shim to the package's own executable, and only falls back to the shim without one", () => {
    const shim = "C:\\nvm\\nodejs\\claude.cmd";
    const exe = "C:\\nvm\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe";
    const env = { PATH: "C:\\nvm\\nodejs" };
    expect(resolveBinary("claude", machine("win32", [shim, exe], env))).toEqual({ path: exe, kind: "native", source: "path" });
    expect(resolveBinary("claude", machine("win32", [shim], env))).toEqual({ path: shim, kind: "shim", source: "path" });
  });

  it("looks in the Windows well-known locations without PATH", () => {
    const claude = "C:\\Users\\me\\.local\\bin\\claude.exe";
    expect(resolveBinary("claude", machine("win32", [claude]))?.path).toBe(claude);
  });

  it("ignores PowerShell scripts", () => {
    expect(resolveBinary("claude", machine("win32", ["C:\\npm\\claude.ps1"], { PATH: "C:\\npm" }))).toBeNull();
  });
});

describe("child environment", () => {
  it("removes credentials and routing overrides, keeping everything else", () => {
    const env = buildChildEnv("claude", {
      ANTHROPIC_API_KEY: "sk-ant-secret",
      ANTHROPIC_AUTH_TOKEN: "t",
      CLAUDE_CODE_OAUTH_TOKEN: "o",
      ANTHROPIC_BASE_URL: "http://x",
      ANTHROPIC_PROFILE: "p",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_SIMPLE: "1",
      CLAUDE_CONFIG_DIR: "/elsewhere",
      HOME: "/home/me",
      PATH: "/usr/bin",
      APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    });
    expect(Object.keys(env).sort()).toEqual(["APPDATA", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_DISABLE_CLAUDE_MDS", "HOME", "PATH"]);
  });

  it("matches names case-insensitively, as Windows treats them, and never doubles PATH", () => {
    const env = buildChildEnv("claude", { anthropic_api_key: "k", Anthropic_Auth_Token: "t", Path: "C:\bin", USERPROFILE: "C:\Users\me" });
    expect(env).toMatchObject({ Path: "C:\bin", USERPROFILE: "C:\Users\me" });
    expect(Object.keys(env).filter((name) => /anthropic/i.test(name))).toEqual([]);
  });

  it("strips the whole set, whatever the case", () => {
    const names = [
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
    const source = Object.fromEntries(names.flatMap((name) => [[name, "x"], [name.toLowerCase(), "x"]]));
    const env = buildChildEnv("claude", { ...source, KEEP: "1" });
    expect(Object.keys(env).filter((name) => /^ANTHROPIC_|CLAUDE_CODE_(OAUTH|USE|SIMPLE)|CLAUDE_CONFIG_DIR/i.test(name))).toEqual([]);
    expect(env.KEEP).toBe("1");
  });
});

describe("argument construction", () => {
  const base = { sessionId: "11111111-2222-3333-4444-555555555555", mcpConfigFile: "/tmp/run/mcp.json" };

  it("builds the first Claude Code run with a session id, no folder tools and the blocked tools denied", () => {
    expect(buildClaudeArgs({ ...base, resume: false, brief: "Brief." })).toMatchInlineSnapshot(`
      [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--disable-slash-commands",
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        "/tmp/run/mcp.json",
        "--permission-mode",
        "dontAsk",
        "--allowedTools",
        "mcp__diagram-ai__*",
        "--disallowedTools",
        "mcp__diagram-ai__diagram_delete",
        "mcp__diagram-ai__diagram_export",
        "--tools",
        "",
        "--max-turns",
        "20",
        "--session-id",
        "11111111-2222-3333-4444-555555555555",
        "--append-system-prompt",
        "Brief.",
      ]
    `);
  });

  it("resumes with --resume, adds read-only file tools only with a folder, and never any bypass flag", () => {
    const args = buildClaudeArgs({ ...base, resume: true, folder: "C:\\Users\\me\\My Project", model: "haiku" });
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--continue");
    expect(args).not.toContain("--bare");
    expect(args.join(" ")).not.toMatch(/dangerously|bypass/i);
    // Reads are confined to the chosen folder; a bare `Read` would allow any path on the computer.
    expect(args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"))).toEqual([
      "mcp__diagram-ai__*",
      "Read(//c/Users/me/My Project/**)",
      "Glob(//c/Users/me/My Project/**)",
      "Grep(//c/Users/me/My Project/**)",
    ]);
    expect(args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2)).toEqual(["--setting-sources", ""]);
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep");
    expect(args).toContain("haiku");
  });

  it("writes folder scopes as absolute-path rules, and offers no file tools for paths it cannot express", () => {
    expect(folderReadRules("/home/me/app/")).toEqual(["Read(//home/me/app/**)", "Glob(//home/me/app/**)", "Grep(//home/me/app/**)"]);
    expect(folderReadRules("D:\\work\\José's app")?.[0]).toBe("Read(//d/work/José's app/**)");
    for (const odd of ["relative/dir", "C:\\Projects\\app (v2)", "/srv/a*b", "\\\\server\\share\\x", "/a/{b}", ""]) expect(folderReadRules(odd), odd).toBeNull();
    // No usable rule means no file tools at all, not a bare "Read".
    const args = buildClaudeArgs({ sessionId: "11111111-2222-3333-4444-555555555555", resume: false, mcpConfigFile: "m.json", folder: "/srv/a*b" });
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("Read");
  });

  it("points Claude Code at this app's server only", () => {
    expect(JSON.parse(claudeMcpConfig("http://localhost:3000/api/mcp/claude-code"))).toEqual({
      mcpServers: { "diagram-ai": { type: "http", url: "http://localhost:3000/api/mcp/claude-code", alwaysLoad: true } },
    });
    expect(MODEL_NAME.test("claude-haiku-5-5")).toBe(true);
    expect(MODEL_NAME.test("haiku; rm -rf /")).toBe(false);
  });
});

describe("shell quoting for .cmd shims", () => {
  it("passes plain arguments and quotes spaces, empty strings and wildcards", () => {
    expect(quoteForCmd("--verbose")).toBe("--verbose");
    expect(quoteForCmd("C:\\Users\\me\\AppData\\Local\\Temp\\run\\mcp.json")).toBe("C:\\Users\\me\\AppData\\Local\\Temp\\run\\mcp.json");
    expect(quoteForCmd("C:\\Program Files\\claude\\claude.cmd")).toBe('"C:\\Program Files\\claude\\claude.cmd"');
    expect(quoteForCmd("")).toBe('""');
    expect(quoteForCmd("mcp__diagram-ai__*")).toBe('"mcp__diagram-ai__*"');
    // Profile folders named after the person: accents, spaces, parentheses.
    const profile = "C:\\Users\\José Müller\\AppData\\Local\\Temp (2)\\mcp.json";
    expect(quoteForCmd(profile)).toBe(`"${profile}"`);
  });

  it("refuses anything that could be interpreted by cmd.exe", () => {
    for (const bad of ["a&calc", "a|b", "%PATH%", 'a"b', "a^b", "a>b", "$(x)", "a\nb", "{\"a\":1}"]) {
      expect(() => quoteForCmd(bad), bad).toThrow();
    }
  });
});

describe("line splitting", () => {
  const collect = (chunks: (string | Buffer)[]) => {
    const lines: string[] = [];
    const splitter = new LineSplitter((line) => lines.push(line));
    for (const chunk of chunks) splitter.push(chunk);
    splitter.end();
    return lines;
  };

  it("buffers partial lines, handles CRLF and a BOM, and skips blanks", () => {
    expect(collect(['\uFEFF{"a":', "1}\r\n\r\n", '{"b":2}\n{"c"', ":3}"])).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("does not split a multi-byte character across chunks", () => {
    const bytes = Buffer.from('{"t":"héllo ✓"}\n', "utf8");
    expect(collect([bytes.subarray(0, 8), bytes.subarray(8)])).toEqual(['{"t":"héllo ✓"}']);
  });
});

describe("who may use the bridge", () => {
  const request = (headers: Record<string, string>) => new Request("http://localhost:3000/api/diagrams/x/chat", { method: "POST", headers });
  const open = { multiUser: false };

  it("accepts loopback hosts, with or without Next's own forwarding headers", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3100", "[::1]:3000", "LOCALHOST"]) {
      expect(() => assertLocalRequest(request({ host }), open), host).not.toThrow();
    }
    expect(() => assertLocalRequest(request({ host: "localhost:3000", "x-forwarded-host": "localhost:3000", "x-forwarded-for": "::1" }), open)).not.toThrow();
    expect(() => assertLocalRequest(request({ host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" }), open)).not.toThrow();
  });

  it("refuses other hosts, forged Host headers from other machines, and proxies", () => {
    for (const host of ["example.com", "192.168.1.20:3000", "my-laptop.local:3000", "localhost.evil.com"]) {
      expect(() => assertLocalRequest(request({ host }), open), host).toThrow(/same computer/);
    }
    // A remote client forging Host: localhost still arrives with its own address appended by the dev proxy.
    expect(() => assertLocalRequest(request({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1, 192.168.1.20" }), open)).toThrow(/same computer/);
    expect(() => assertLocalRequest(request({ host: "localhost:3000", "x-forwarded-for": "203.0.113.9" }), open)).toThrow();
    expect(() => assertLocalRequest(request({ host: "localhost:3000", "x-forwarded-host": "app.example.com" }), open)).toThrow();
    expect(() => assertLocalRequest(request({ host: "localhost:3000", forwarded: "for=203.0.113.9" }), open)).toThrow();
  });

  it("is off in multi-user mode and with the switch, and the switch cannot override multi-user", () => {
    expect(bridgeDisabledReason({ multiUser: true })).toMatch(/accounts/);
    expect(bridgeDisabledReason({ switch: "off", multiUser: false })).toMatch(/DIAGRAM_AI_LOCAL_AGENTS=off/);
    expect(bridgeDisabledReason({ switch: "on", multiUser: true })).toMatch(/accounts/);
    expect(bridgeDisabledReason({ switch: "on", multiUser: false })).toBeNull();
    expect(() => assertLocalRequest(request({ host: "localhost:3000" }), { multiUser: true })).toThrow(/unavailable/);
  });

  it("requires the acknowledgement for the engine being used, at the current wording", () => {
    expect(() => assertAcknowledged(request({}), "claude-code")).toThrow(/confirmation/);
    expect(() => assertAcknowledged(request({ [BRIDGE_ACK_HEADER]: bridgeAck("claude-api") }), "claude-code")).toThrow();
    expect(() => assertAcknowledged(request({ [BRIDGE_ACK_HEADER]: "claude-code:0" }), "claude-code")).toThrow();
    expect(() => assertAcknowledged(request({ [BRIDGE_ACK_HEADER]: bridgeAck("claude-code") }), "claude-code")).not.toThrow();
  });
});

describe("working folder", () => {
  it("accepts an existing absolute directory and rejects everything else", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "diagram-ai-workdir-"));
    try {
      const file = path.join(dir, "file.txt");
      writeFileSync(file, "x");
      mkdirSync(path.join(dir, "sub"));
      expect(validateWorkdir(path.join(dir, "sub"))).toBeTruthy();
      expect(() => validateWorkdir(file)).toThrow(/not a folder|does not exist/);
      expect(() => validateWorkdir(path.join(dir, "missing"))).toThrow(/does not exist/);
      expect(() => validateWorkdir("relative/dir")).toThrow(/absolute/);
      expect(() => validateWorkdir("")).toThrow(/absolute/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
