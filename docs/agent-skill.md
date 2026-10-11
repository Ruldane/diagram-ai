# Agent skill, prompts and resources

How agents are taught to draw well with Diagram AI: the MCP prompts and resources the server offers, the Claude Code skill, and a snippet for other repositories. The tools themselves are described in the README.

## What exists

| Piece | Where | Reaches |
| --- | --- | --- |
| Prompts (9 workflows) | `src/server/mcp/prompts.ts` | Any MCP client that lists prompts; Claude Code shows them as slash commands |
| Resources (guide, types, shapes, diagrams) | `src/server/mcp/resources.ts` | Any MCP client that reads resources |
| The drawing guide | `src/server/mcp/guide.ts` | The `diagram://guide` resource and the skill's `references/guide.md` |
| Claude Code skill | `.claude/skills/diagram-ai/` | Claude Code, loaded when a request matches its description |
| AGENTS.md snippet | below | Codex and any agent that reads `AGENTS.md` |

All of it assumes the MCP server is registered; see "Connect an agent" in the README.

## Install the skill

The skill is already active for sessions started inside this repository. To use it from any project, copy it to the user-level skills folder:

```bash
mkdir -p ~/.claude/skills && cp -r .claude/skills/diagram-ai ~/.claude/skills/diagram-ai
```

On Windows PowerShell: `Copy-Item -Recurse .claude\skills\diagram-ai $HOME\.claude\skills\diagram-ai`.

Restart Claude Code. A request such as "draw the architecture of this repo" now loads `SKILL.md` (about 75 lines); it pulls `references/notations.md`, `layout.md`, `troubleshooting.md` or `guide.md` only when needed. The skill opens by calling `diagram_list`, and says how to start the app and register the server when that fails. Copy the folder again after pulling changes to it.

## Prompts

Each prompt returns one message that scripts a whole job against this server's tools: the order of calls, the argument names to use, and a "done when" check that always includes a `diagram_preview`. Where a diagram type's notation matters, the prompt embeds that type's `agentGuide` from the catalog, so it cannot drift from `diagram_list_types`.

In Claude Code a prompt is `/mcp__<server>__<prompt> <arguments>`, with `<server>` the name given to `claude mcp add` (`diagram-ai` in the README). Arguments are positional, in the order below.

| Prompt | Arguments | Does |
| --- | --- | --- |
| `diagram_repo_architecture` | `focus`, `diagram_type` (default `c4-container`) | Explores the repository, then draws grouped containers with labelled connectors and a legend |
| `diagram_code_flow` | `entry_point` (required), `depth` | Traces a request or function, builds a sequence diagram, adds an activity diagram for branchy flows |
| `diagram_er_from_schema` | `source` | Reads migrations or models and draws an ER diagram with keys and cardinalities |
| `diagram_from_description` | `description` (required), `diagram_type` | Picks the type, creates, draws, previews, iterates once |
| `diagram_review` | `diagram_id` | Looks at a diagram and leaves comments; changes nothing |
| `diagram_address_comments` | `diagram_id` | Makes the changes the open comments ask for, replies and resolves |
| `diagram_tidy` | `diagram_id` | Checkpoints, then fixes layout, labels, colours and grouping |
| `diagram_explain` | `diagram_id` | Explains a diagram in prose; changes nothing |
| `diagram_convert` | `diagram_id`, `to_type` | Re-draws the content in another notation as a new diagram |

```text
/mcp__diagram-ai__diagram_repo_architecture payments
/mcp__diagram-ai__diagram_code_flow checkoutHandler 2
/mcp__diagram-ai__diagram_review k3x9a1b2c3d4
```

Without a `diagram_id` the prompt tells the agent to find the diagram with `diagram_list`. An id that does not exist, or a diagram type that is not in the catalog, fails with a message naming the fix. Clients that support completions suggest diagram ids and type ids.

## Resources

Read-only markdown, no side effects. In Claude Code, type `@diagram-ai:diagram://guide` in a message to attach one.

| URI | Content |
| --- | --- |
| `diagram://guide` | The drawing guide: workflow, type table, node and edge conventions, layout, preview checklist, what not to do |
| `diagram://types` | Every diagram type id with its category and one-line description |
| `diagram://shapes` | The shape libraries with sizes, and the edge-kind, colour and icon vocabularies |
| `diagram://shapes/{library}` | The shapes of one library (`uml`, `infra`, `ai`...) or `edge-kinds`, `colors`, `icons-list` |
| `diagram://diagrams` | The workspace's diagrams with ids, types, sizes and URLs |
| `diagram://diagram/{id}` | The outline `diagram_read` returns for one diagram, including the pending-review line |

Unknown ids and libraries answer with an error that lists the valid ones.

## Codex and other agents

Codex gets the tools and the server's `instructions` on connect; whether it lists prompts and resources depends on the client version. Paste this into the `AGENTS.md` of any repository where agents should draw with Diagram AI. It is the short form of the guide:

````markdown
## Diagrams

Use the Diagram AI MCP server (`diagram-ai`) for any request to draw, diagram or visualise something; do not produce Mermaid or ASCII art unless asked.

- Check it is connected with `diagram_list`. If it is not, start the app (`npm run dev` in the Diagram AI repository) and register it:
  `codex mcp add diagram-ai --url http://localhost:3000/api/mcp/codex` (Claude Code: `claude mcp add --transport http diagram-ai http://localhost:3000/api/mcp`).
- Choose the type with `diagram_list_types`: repository architecture is `c4-container`, a request flow is `uml-sequence` (built with `diagram_build_sequence`), a schema is `er-diagram`.
- Explore the code first and draw only what you verified. Send one `diagram_add_elements` call with short kebab-case ids, labelled edges and containers via `parent`; never x or y.
- Look with `diagram_preview` and fix what you see before reporting. Give the user the diagram URL.
- Read existing diagrams first (`diagram_read`, `diagram_list_comments`) and update them in place; do not delete the user's work unless asked.
- The full guide is the MCP resource `diagram://guide`.
````

## One source, no drift

- Edit the guide in `src/server/mcp/guide.ts`, then run `npx tsx scripts/sync-skill.ts` to rewrite the skill's `references/guide.md` (`--check` only verifies). `guide.test.ts` fails when they differ.
- `references/notations.md`, `layout.md` and `troubleshooting.md` are written by hand. The test checks every shape id, edge kind, diagram type, tool name and resource URI in the skill, the guide and the prompts against the live registries, so a rename elsewhere in the product shows up as a failing test here.
- `SKILL.md` must keep its frontmatter and stay under 120 lines; the test enforces both.

```bash
npx vitest run src/server/mcp          # prompts, resources, guide and skill checks
node scripts/mcp-smoke.mjs http://localhost:3000   # also exercises prompts and resources on a running app
```
