# Brand logos and icon packs

Two ways to put recognisable vendor and product artwork on the canvas: a bundled `brands` library of technology logos, and importable icon packs (the official AWS / Azure / Google Cloud sets, or your own SVGs). Everything is a shape, so it exports and renders like any built-in.

## Licensing, which decides the design

- **Brand logos are bundled.** Geometry comes from [simple-icons](https://simpleicons.org) (CC0 data). The marks themselves are trademarks of their owners and are included for identification in architecture diagrams only. Do not present a diagram as endorsed by a vendor.
- **Official cloud icon sets are not bundled.** AWS, Azure and Google Cloud publish theirs as free downloads under terms that do not allow redistribution inside another product. Users download them and import them; packs live on the server, not in the repo. Never commit vendor icons, test fixtures included.
- simple-icons dropped some marks at their owners' request (AWS, Azure, Microsoft, IBM, Oracle, OpenAI, Slack, Heroku, Twilio, Salesforce, Windows in 16.35). The generator skips them with a warning, except `amazonaws` and `microsoftazure`, which get a generic cloud glyph in the vendor colour under the same ids, so `aws` / `azure` still resolve. The real artwork is what the vendor packs are for.

## Brand library (`brands`)

| File | Role |
| --- | --- |
| `scripts/gen-brand-icons.mjs` | Curated slug list (grouped, with aliases) → `brand-data.ts`. `npm run icons:brands` |
| `src/core/shapes/brand-data.ts` | Generated, committed. `slug → { title, hex, group, aliases?, path?, icon? }` |
| `src/core/shapes/libraries/brands.ts` | One tile per brand, id `brands/<slug>` |
| `src/core/shapes/glyph-tile.ts` | Tile layout shared with imported packs (same proportions as `infra` tiles) |
| `src/core/shapes/glyph.ts` | `brandPrims` (filled 24×24 glyph) and `glyphPrims` (multi-colour layers), re-exported from `kit.ts` |

**Add a brand:** append `slug|alias, alias` to a group in the script and run `npm run icons:brands` (it warns when the slug is missing from `node_modules/simple-icons`), then `npx tsx scripts/gallery.ts brands`.

**Colour.** The glyph uses the brand colour; when its contrast against the tile fill is under 2 (pale yellows, near-black marks) it uses ink, or white on a dark fill. This is evaluated against the node's own fill, so recolouring the tile keeps the logo legible. Node fill and line apply to the tile body.

**Names.** `brands` sorts after `infra`, so generic names keep meaning generic tiles: `postgres`, `docker`, `kubernetes`, `kafka`, `redis`, `github` and about 120 more resolve to `infra/*` (`claude` / `gemini` hit `ai/llm`, `graphql` hits `ai/api`). The logo is always reachable as `brands/<slug>` or `<name>-logo`; `resolveShape(name, ["brands"])` prefers logos.

## Icon packs

### Format (`src/core/shapes/packs.ts`)

```json
{ "id": "aws-architecture-icons", "name": "AWS Architecture Icons", "description": "…", "source": "…",
  "icons": [{ "id": "aws-lambda", "name": "AWS Lambda", "category": "Compute",
              "viewBox": { "w": 64, "h": 64 },
              "layers": [{ "d": "M0 0h64v64H0z", "fill": "#ed7100" }, { "d": "M…", "fill": "#ffffff" }] }] }
```

A layer is one painted path: `d`, `fill`, `stroke`, `strokeWidth` (viewBox units), `opacity`, `round` (round caps), `evenOdd`. Colours are `#rrggbb` or `none`. Limits (`PACK_LIMITS`): 2000 icons, 200 KB per icon, 20 MB per pack; ids are lower-case words joined by hyphens (pack id up to 32). `validatePack` normalises and never throws.

`packToLibrary` makes one tile shape per icon: `<pack id>/<icon id>`, artwork scaled to fit and centred, label underneath. Aliases are the icon id, the name without its vendor prefix, and `<prefix>-<name>` where the prefix comes from the pack name (`aws-lambda`, `gcp-pubsub`). Built-in aliases still win, so use the full id when it matters. For a bare icon (the usual AWS diagram look) set the node's fill and line to none.

### SVG → icon (`svg-import.ts`) and files → pack (`pack-import.ts`)

Pure TypeScript, no DOM: the browser converts and previews, then uploads one ready pack; the server and the CLI use the same code for `files` / `zip` requests and folders.

- Supported: `path rect (rx/ry) circle ellipse line polyline polygon g a switch use symbol` and nested `svg`; `transform` (translate, scale, rotate, matrix, skew); `fill`, `stroke`, `opacity` as attributes, `style=""` and simple `<style>` rules (tag, `.class`, `#id`) with inheritance; named colours, `rgb()`, `hsl()`, `currentColor`.
- Flattened with a warning: gradients become the mean of their stops. Dropped with a warning: `image`, `text`, filters, masks, clip paths, patterns; dashes are drawn solid.
- A full-viewBox rectangle is dropped only when plain white or transparent. A coloured one is the icon (AWS puts a white glyph on a coloured square).
- Files: the folder becomes the category after dropping size folders (`16/32/48/64`), download wrappers (`Asset-Package…`, `…Icons_01312023`) and the leading folders every file shares; `Arch_` / `Res_` prefixes are stripped. File name → name (`Arch_AWS-Lambda_64` → `AWS Lambda`, `10021-icon-service-Virtual-Machine` → `Virtual Machine`, `cloud_sql` → `Cloud SQL`). One icon per category and name; the size nearest 56 px wins. Over the limits it truncates with a warning, never half-writes.

## Runtime

- `registry.ts`: `registerLibrary`, `unregisterLibrary`, `isRuntimeLibrary`, `registryVersion`, `subscribeRegistry`. Runtime libraries sort last, replace by id and cannot take a built-in id. Unknown shape ids fall back to `basic/rect`, so a document survives its pack being removed.
- Display lists are cached per node object (`nodePrims`, `nodeMarkup`) and both caches reset when `registryVersion()` changes. Anything new that caches shape output must do the same.
- Storage: `src/server/packs/store.ts`. `PackStore` is `list / get / save / delete`; files are `<DATA_DIR>/packs/<id>.json`. A database implementation only has to satisfy the interface and be returned by `getPackStore()`.
- `src/server/packs/runtime.ts`: `ensurePacks()` makes this module's registry match the store (one `readdir` per second at most). It runs in `DiagramService.get` and `diagram_list_shapes`, so exports, previews, thumbnails and agent tools see packs. Every Next route bundle has its own registry copy, which is why this state is per module and not on `globalThis`; `packsChanged()` after a write wakes the other bundles.
- API: `GET /api/packs[?full=1]`; `POST /api/packs` with a pack, `{ name, files: [{ name, content }] }` or `{ name, zip: base64 }` (same id replaces); `GET` and `DELETE /api/packs/<id>`. Writes are same-origin only.
- Client: `usePacksSync()` (mounted in `Editor`) loads packs and refreshes on focus. The palette lists them under "Icon packs"; the palette footer and command `packs.open` open `PacksDialog`.

## CLI

```bash
npm run icons:import -- ./Asset-Package.zip --name "AWS Architecture Icons"
npm run icons:import -- ./Azure_Public_Service_Icons ./extra.svg --dry-run
```

Options: `--id`, `--description`, `--source`, `--data-dir`, `--dry-run`. A running server picks the pack up within a second.

## Gotchas

- On Windows pass native paths for `--data-dir` / `DIAGRAM_DATA_DIR` (`C:/…`); Git Bash `/c/…` strings are not converted inside environment variables.
- A pack id cannot equal a built-in library id (`brands`, `infra`…); ids derived from a name get `-pack` appended.
- Packs are not de-duplicated against each other: importing one set under two names gives two libraries.
