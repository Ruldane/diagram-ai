# Troubleshooting

## The tools are not there, or every call fails

1. Is the app running? `http://localhost:3000` should show the home page. Start it with `npm run dev` in the Diagram AI repository. If it runs on another port, use that port in the URLs below.
2. Is the server registered?
   - Claude Code: `claude mcp list` should show `diagram-ai`. Add it with `claude mcp add --transport http diagram-ai http://localhost:3000/api/mcp`. Inside a session, `/mcp` shows status and reconnects. A `.mcp.json` in the Diagram AI repository registers it for sessions started there.
   - Codex: `codex mcp add diagram-ai --url http://localhost:3000/api/mcp/codex`, or `[mcp_servers.diagram-ai]` with `url = "http://localhost:3000/api/mcp/codex"` in `~/.codex/config.toml`.
   - Cursor, VS Code, Gemini CLI: `{ "mcpServers": { "diagram-ai": { "url": "http://localhost:3000/api/mcp" } } }`.
   - stdio-only clients: `npx -y mcp-remote http://localhost:3000/api/mcp`.
3. Restart the agent session after registering; most clients read the tool list once at start.
4. Opening `/api/mcp` in a browser answers "Method not allowed ... use POST". That is expected: the endpoint is stateless and POST-only.
5. "Cross-origin requests are not allowed" means a browser page called the endpoint. Agents do not send an `Origin` header and are not affected.

The app keeps no session, so restarting `npm run dev` needs no reconnect.

## Replies that start with "Error:"

They say what to do next. The usual ones:

| Reply | Do |
| --- | --- |
| `No diagram with id "..."` | `diagram_list` and use an id from it. |
| `invalid input` plus a path | The argument at that path has the wrong type or is too long; fix it and resend. |
| `confirm_name does not match` | Pass the diagram's exact name. Only delete when the user asked. |
| `Participant ids already exist in this diagram` | The sequence is already there. Delete the old lifelines with `diagram_delete_elements`, or give new ids. |
| `provide at least one node or edge` | Send `nodes` or `edges`. |

## Warnings in add and update replies

The call succeeded for everything else. Fix only the named elements and resend them.

| Warning | Meaning and fix |
| --- | --- |
| `unknown shape "x" ... did you mean` | A default shape was kept. Pick one of the suggestions or search with `diagram_list_shapes` and `query`, then `diagram_update_elements` with `shape`. |
| `unknown node id ... edge skipped` | The edge names a node that does not exist. Check the ids from the create reply (ids that were not URL-safe are normalised) and resend the edge. |
| `parent "x" ... is not a container shape` | Parents must be `basic/group`, `basic/frame`, or another container shape. Create the container first or use one. |
| `id already exists` | `diagram_add_elements` only creates. Use `diagram_update_elements` for an existing id. |
| `no node with this id` | `diagram_update_elements` only changes. Use `diagram_add_elements` or fix the id with `diagram_read`. |
| `unknown kind` / `unknown color` / `unknown icon` | Look the value up with `diagram_list_shapes` and `library` set to `edge-kinds`, `colors` or `icons-list`. |

## The picture looks wrong

- **Overlaps after an update.** Updates do not re-flow. Run `diagram_layout`, or only for a region with `ids`.
- **Labels cut off or crowded.** Shorten to 2-5 words, move detail to a second line, or give the node more room with `w`.
- **Many crossing connectors.** Try `direction: "right"`, group related nodes in a container, remove edges that add no meaning, or split the diagram. See `layout.md`.
- **Containers too small or children outside.** Use the `layered` algorithm (the only one that sizes containers), or size the container yourself when using explicit coordinates.
- **New nodes landed in an odd place.** The diagram was arranged by hand, so new nodes are placed beside their neighbours. Move them with `diagram_update_elements` or, if allowed, re-run `diagram_layout`.
- **A sequence diagram is messy.** Never run `diagram_layout` on it. Fix labels with `diagram_update_elements` or delete the lifelines and rebuild.
- **`diagram_preview` says the diagram is empty.** Nothing was added yet, or the ids you sent were all skipped; read the warnings.

## The user and the agent are out of sync

- MCP is pull-based. You see the user's edits and comments only when you read. Re-run `diagram_read` and `diagram_list_comments` before changing something they may have touched.
- `diagram_get_selection` and `diagram_highlight` report "no browser tab" when the user has no tab open on the diagram. Give them the URL, or ask which elements they mean.
- A reply was cut with "truncated". Page with `limit` and `offset`, or narrow with `ids`, on `diagram_read`, `diagram_list_types` and `diagram_list_shapes`.

## Exports

- `svg`, `mermaid`, `drawio` and `json` are returned inline; write them to a file yourself.
- `png`, `pdf` and `pptx` are written on the machine that runs the app; the reply gives the absolute path and a download URL. Copy the file where the user wants it.
- Mermaid export covers flowcharts and sequence diagrams only.
