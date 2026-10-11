@AGENTS.md

# Claude Code

- Drawing a diagram for the user: use the `diagram-ai` MCP server from `.mcp.json` together with the `diagram-ai` skill in `.claude/skills/`. [docs/agent-skill.md](docs/agent-skill.md) explains both.
- Delegating to subagents: give each its own set of files, tell them port 3000 and `./data` belong to the user, and keep the Playwright MCP browser to one agent at a time. Have each write its topic doc under `docs/` when it finishes.
