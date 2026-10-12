// A stand-in for the `claude` executable, driven by environment variables, for process-level tests.
// It answers `auth status`, records how it was started, and plays a captured transcript to stdout.
//   FAKE_CLAUDE_RECORD      file that receives { args, stdin, env, cwd } as JSON
//   FAKE_CLAUDE_TRANSCRIPT  JSONL file to play
//   FAKE_CLAUDE_STYLE       "crlf-bom": CRLF line ends and a BOM; "chunked": writes small odd-sized pieces
//   FAKE_CLAUDE_MODE        "play" (default) | "hang" (start a grandchild, then wait forever) | "crash" (stderr, exit 3)
//   FAKE_CLAUDE_PIDFILE     where "hang" writes the grandchild's pid
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const env = process.env;
const style = env.FAKE_CLAUDE_STYLE ?? "";

const write = (text) => {
  const payload = style.includes("crlf-bom") ? `\uFEFF${text.replace(/\n/g, "\r\n")}` : text;
  process.stdout.write(payload);
};

if (args[0] === "auth" && args[1] === "status") {
  write(`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "someone@example.com" })}\n`);
  process.exit(0);
}

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (stdin += chunk));
process.stdin.on("end", () => {
  if (env.FAKE_CLAUDE_RECORD) {
    const names = Object.keys(env).filter((name) => /^(ANTHROPIC_|CLAUDE_|DIAGRAM_AI_BRIDGE)/i.test(name));
    writeFileSync(env.FAKE_CLAUDE_RECORD, JSON.stringify({ args, stdin, env: Object.fromEntries(names.map((name) => [name, env[name]])), cwd: process.cwd() }));
  }
  const mode = env.FAKE_CLAUDE_MODE ?? "play";
  if (mode === "crash") {
    process.stderr.write("Error: something broke inside the fake CLI\n");
    process.exit(3);
  }
  if (mode === "hang") {
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    if (env.FAKE_CLAUDE_PIDFILE) writeFileSync(env.FAKE_CLAUDE_PIDFILE, String(grandchild.pid));
    const first = readFileSync(env.FAKE_CLAUDE_TRANSCRIPT, "utf8").split("\n").filter(Boolean)[0];
    write(`${first}\n`);
    setInterval(() => {}, 1000);
    return;
  }
  const text = `${readFileSync(env.FAKE_CLAUDE_TRANSCRIPT, "utf8").trim()}\n`;
  if (!style.includes("chunked")) return write(text);
  const payload = Buffer.from(style.includes("crlf-bom") ? `\uFEFF${text.replace(/\n/g, "\r\n")}` : text, "utf8");
  for (let at = 0; at < payload.length; at += 37) process.stdout.write(payload.subarray(at, at + 37));
});
