# Hypergro Scene Editor

Federal Bank creative editor: turn an Adobe Illustrator creative into an editable scene, edit it by clicking or by chatting inside the brand's guardrails, and download print-ready PDF / .ai / JPG / PNG.

```
.ai upload ─► MuPDF extract ─► Claude classify (vision) ─► understand() ─► scene bundle
   (any OS, no Illustrator)     roles · merged copy · CTA     layout rules     scene.json + PNGs
                                                                                    │
                     click / drag / form ──────┐                                    ▼
                     chat (Claude tool use) ───┼─► TOOLS (shared/scene.js) ─► scene ─► canvas / export
                     MCP client ───────────────┘
```

One operations layer (`shared/scene.js`: `TOOLS`, `runTool`, `applyOps`) is used by the in-app chat, direct manipulation, and the MCP server, so behaviour is identical everywhere and every edit is one undo step.

## Quick start

Requires Node 20.6+.

```bash
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY=sk-ant-…  (optional, see below)
npm run dev                 # API on :8787, editor on http://localhost:5173
```

Then press **Try sample** (runs `samples/cashback-kv.ai` through the pipeline) or **Upload .ai**.

Without an API key everything still runs: roles come from heuristics (`understand()`), and the assistant uses an offline parser (colours, sizes, visibility, moves, quoted copy). With a key, ingestion adds a vision pass (merged paragraphs, human names, CTA buttons, outlined-text reconstruction) and the assistant becomes Claude driving the same tools.

Production: `npm run build && npm start` serves the built editor and the API from one process on `PORT` (default 8787).

## What you can do in the editor

Built for Federal Bank's marketing team and laid out like Canva, which most of them already use, minus Canva's left panel of templates and elements (there is nothing to add from a library: the creative already exists).

- **My creatives** (home): every uploaded creative as a card with its thumbnail and when it was last edited, a big "Upload Illustrator file" tile (`.ai` saved with "Create PDF Compatible File", Illustrator's default) and a sample to try. Edits are **auto-saved** per creative (server-side for uploads, in the browser for the sample) and picked up again when you reopen it.
- **The creative fills the screen.** Click anything and the **toolbar above it changes**: text gets font (brand fonts first), style, size, colour (brand swatches first, "more brand colours", and a free colour picker), alignment and "Edit text"; pictures get Replace image and, for logos, Swap logo from the approved set (the picker knows what sits behind the logo and puts the versions the brand book allows there first; a logo on the wrong surface becomes a "Ready to publish" item with a one-click fix); buttons and shapes get colour and corner roundness. Every toolbar ends with Hide, Reset, Duplicate and Delete. Brand-controlled items (logo, small print, background) show "🔒 Fixed by brand" with a one-click Unlock.
- **Direct editing**: drag to move (the keep-clear area appears only while dragging), circular handles to resize, a rotate handle under the selection, double-click text to type at the click point, arrows nudge, ⌘Z undo, ⌘D duplicate, ⌫ delete.
- **✦ Ask for a change** (bottom-right button): "Change the offer to 10%", "Make the headline shorter", "Translate to Malayalam". One-sentence replies with an Undo link. Runs on Claude via Vertex; falls back to a small offline parser for simple edits.
- **Bottom bar**: a green "Ready to publish" pill, or "2 things to look at" that opens up to three plain-language items with one-click fixes (shrink to fit, move away from the edge, use a brand colour or font, replace a missing font); "Show original"; "Start over"; zoom.
- **Header**: undo/redo, the creative's name (click to rename), **Contents** (a list of everything on the creative, grouped Text / Images & logo / Colours), **Activity** (this session's changes with Undo, plus the record kept with the creative: who did what, when; the name is set once per browser), **Languages** (make the creative in other languages, see the versions), **Save a copy**, one **Download** menu (JPG for social, print PDF, editable .ai) and a **⋯** menu with the file check, "Start a new one like this", rename and the brand guidelines. There is no approval step: the record and the copies are the trail.
- **Waiting is narrated.** Uploads show four named steps and keep running if you browse away (a toast offers to open the creative when it is ready); downloads show their phase on the button and offer "Download again"; language versions tick off one by one and can be left running; the assistant shows a sent/reply bar and says how long it usually takes. Animations use three durations (150/200/300 ms) and switch off entirely under the system's reduce-motion setting.
- **File check** after every upload (opens by itself only for files graded Limited; otherwise a banner under the toolbar links to it): what the file lets a marketer change, in plain words (live text, fonts on file, movable logos, replaceable photos), and a ready-made note to send the designer when something is missing.
- **Language versions**: pick languages under Languages; each becomes its own creative ("Name · Malayalam") with the copy translated by the assistant and set in a Unicode face for that script. They sit under the parent on the home page. Read every line before use.
- **Home**: search, rename, "Start a new one like this", remove from the list; uploading a file with the same name replaces the earlier upload (the old one stays on disk, hidden).
- **Legacy-font copy**: "Read the words" on such a line reads the printed text from the original render, shows it for checking, and turns the line into normal Unicode text.
- **Developer extras** (`?designer=1` in the URL): SVG and scene.json downloads, a layers panel, roles, opening scene folders/zips and the Illustrator exporter script.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API server + Vite dev server |
| `npm run build` / `npm start` | Build the web app, serve app + API in one process |
| `npm run extract -- <file.ai> <outdir>` | MuPDF extraction only (raw scene, no roles) |
| `npm run ingest -- <file.ai> <outdir> [--no-claude]` | Full pipeline to a bundle folder |
| `npm run worker -- --inbox queue/inbox --outbox queue/outbox` | Watch a folder; each `.ai` becomes `<id>.zip` + `<id>.json` in the outbox |
| `npm run mcp` | Editor as an MCP server (stdio) |
| `npm run sample` | Regenerate `samples/cashback-kv.ai` |
| `npm run check-claude` | One tiny request through the configured provider; explains failures |
| `npm run vertex-models` | Probe which Claude models/regions the GCP project can call |
| `npm test` | Unit tests for the scene layer, classifier application and the extractor |

## API

| Route | Body → Response |
|---|---|
| `POST /api/ingest` | multipart `file`, or JSON `{"sample":"cashback-kv.ai"}` → `{jobId}` |
| `GET /api/jobs/:id` | → `{status: queued|running|done|failed, step, result: {bundle, classifier, warnings}}` |
| `POST /api/chat` | `{scene, message, selected, history}` → `{scene, reply, log}` |
| `GET /api/health` | → `{ok, claude, model}` |
| `GET /api/bundles` | recent ingested bundles |
| `GET/POST /api/bundles/:id/versions` | list / save named versions (`{name, scene, png}`) |
| `POST /api/bundles/:id/versions/:vid/review` | `{by, decision: approved|changes, comment}` |
| `GET /review/:id/:vid` | share-for-approval page |
| `GET /brand/<id>/brand.json` | brand kit (colours, fonts, logo files) used by the editor |
| `GET/PUT /api/bundles/:id/autosave` | working state per artwork (`{scene, png}`), restored on reopen |
| `GET /api/fonts/:family/:weight` | TrueType from Google Fonts (cached) for PDF/.ai embedding |
| `GET /bundles/<id>/…` | bundle files (`scene.json`, `reference-0.png`, `artwork-0.png`, `assets/`) |

Bundles land in `data/bundles/` (override with `DATA_DIR`).

## How ingestion works (no Illustrator)

`server/pdf-extract.mjs` opens the PDF stream inside the `.ai` with MuPDF (WASM):

- live text → one `text` element per line with font, size, fill, bounds;
- embedded images → `image` elements + `assets/image-*.png`;
- rectangle-, rounded-rectangle- and ellipse-shaped fills (buttons, badges, logo marks) → `vector` elements drawn by the editor (`meta.kind`, `meta.cornerRadius`), so they can be recoloured and moved;
- everything else → one locked `artwork-<n>.png` raster (rendered with the promoted elements left out), plus `reference-<n>.png` (full render) and `preview-<n>.png` (for the vision pass).

Files with outlined copy have no live text; the extractor flags `ingest.needsVision` and the classifier transcribes the render into editable overlays (`meta.overlay`, `meta.coverFill`).

`server/classify.mjs` sends the preview render and the raw elements to Claude (structured output) and applies the answer deterministically (`applyClassification`): merged lines, roles, names, CTA rectangles, semantic groups. `understand()` then assigns any remaining roles and locks brand elements.

Limits vs. the Illustrator route: no layer/object names, vectors other than simple shapes are one raster, and fonts must be installed on the client (or on Google Fonts) for an exact re-render. The Illustrator script (`illustrator/Export Hypergro Scene.jsx`) remains for machines that have Illustrator and gives per-object vectors and names.


What the extractor handles in real files:

- **Font names**: PostScript names such as `SourceSans3-Bold`, `HelveticaNeueLTStd-Bd` or `SourceSerif4Italic` become a human family and style (`shared/fontname.js`), so the browser, Google Fonts and the font library are asked for "Source Sans 3 · Bold", not "Source Sans3".
- **Layered artwork**: everything that is not promoted to its own element is rasterised into transparent layers. A new layer starts after each promoted element (clips and transparency groups are replayed onto it), so a logo the file draws on top of a full-bleed photo stays above the photo instead of being buried under it. The layers are `artwork-N.png`, `artwork-N-1.png`… (elements `el_art_N_k`, locked, not clickable).
- **Custom-encoded wordmarks** (glyphs with no readable characters, e.g. a "Credit Cards" logotype) stay as pixels in the artwork instead of turning into `����` text.
- **Letter-spaced text** ("S E A S O N 2") is rebuilt from the glyph positions and carried as `letterSpacing`.
- **Logos baked into the artwork** are lifted out as their own image (`assets/cutout-N.png`) using the box the vision pass reports, and the artwork layer is left transparent there, so the logo can be moved or swapped. When the mark sits on a photo or gradient with no flat colour to paint back, it stays in the artwork and the upload notes say so.
- **Outlined text** (no live text at all) is transcribed from the render by the vision pass in render pixels and scaled to the artboard by the server; the editor shrinks each transcribed block into its box once on first open.

## MCP

```bash
claude mcp add hypergro-editor -- node /abs/path/hypergro-scene-editor/server/editor-server.mjs
```

Tools: `load_scene`, `save_scene`, `list_elements`, `set_text`, `set_fill`, `move_element`, `resize_element`, `set_visibility`, `set_role`, `set_font`, `set_order`, `duplicate_element`, `delete_element`, `set_lock` — the same `TOOLS` the chat uses. Locked elements refuse mutating tools until `set_lock` unlocks them.

## Configuration

`.env` (loaded by the server, the worker and the scripts). Pick one provider:

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | First-party Claude API |
| `CLAUDE_PROVIDER` | `anthropic` (`vertex` when `VERTEX_PROJECT_ID` is set) | Which API to call |
| `VERTEX_PROJECT_ID` | – | GCP project with Claude enabled in Vertex AI Model Garden |
| `VERTEX_REGION` | `global` | Vertex endpoint region (`global`, `us-east5`, `europe-west1`, …) |
| `GOOGLE_APPLICATION_CREDENTIALS` | – | Service-account JSON path (relative to the project root); omit to use `gcloud auth application-default login` |
| `CLAUDE_MODEL` | `claude-opus-5` | Model for classification and chat |
| `CLAUDE_FALLBACKS` | `1` | First-party only: server-side refusal fallbacks (beta); `0` disables |
| `PORT` | `8787` | API port |
| `DATA_DIR` | `./data` | Uploads and bundles |

### Vertex AI

```bash
# 1. put the service-account key where .env expects it (secrets/ is gitignored)
mkdir -p secrets && cp ~/Downloads/gro-main-xxxx.json secrets/gro-main-sa.json
# 2. .env
CLAUDE_PROVIDER=vertex
VERTEX_PROJECT_ID=gro-main
VERTEX_REGION=global
GOOGLE_APPLICATION_CREDENTIALS=secrets/gro-main-sa.json
# 3. verify with one tiny request
npm run check-claude
```

The service account needs `roles/aiplatform.user`, the Vertex AI API must be enabled, and the model must be enabled for the project in Model Garden. `check-claude` explains 401/403/404/429 in those terms; `npm run vertex-models` lists what the project can actually call per region. Server-side refusal fallbacks are not available on Vertex and are skipped automatically.

If the organisation policy `constraints/vertexai.allowedPartnerModelFeatures` blocks `structured_outputs` for the model (a 400 mentioning that constraint), classification falls back to prompt-enforced JSON automatically; ask the org admin to allow `publishers/anthropic/models/<model>:structured_outputs` to get schema-validated output back (`CLAUDE_STRUCTURED_OUTPUTS=0` forces the fallback).

## Output quality

- **Print files keep the original's resolution where it matters.** Photos placed in the file are extracted at their native pixels. Everything else in the artwork is rasterised at a scale chosen by artboard size (4× for A4 and similar print sizes, giving ~288 dpi at 1 pt = 1 px; 2× for large social artboards), and the PDF/.ai keeps those pixels (cap 4500 px on the long side).
- **Fonts are embedded as the exact cuts** (SemiBold, Black, italics) by registering each weight under its own name, since the PDF library only knows regular and bold per family. Copy in Indic or Arabic scripts is drawn by the browser (which shapes it correctly) at 4× and placed as a sharp image in the PDF/.ai, because the PDF library cannot shape those scripts; the download note says so.
- **Check any export against its original** with `node scripts/compare-export.mjs <original.ai> <export.pdf>`: page size, every text line with font and size, images with their effective dpi, a pixel difference at 150 dpi, and 300 dpi crops of both.
- **Language versions** translate with the copy's numbers, brand names and line breaks kept, ask for lengths near the original, then shrink each translated line into its box (down to 72%, then wrapping down to 50%); anything still tight shows under "Ready to publish".

## Font library

Fonts the brand's designers actually use live in `data/fonts/library/` (upload from the home page under "Fonts on file", from the "Ready to publish" font item, or `POST /api/fontlib` with a `file`). The server reads the names inside each file (family, style, PostScript name, weight, script coverage) and:

- serves them to the editor as `@font-face` (`/api/fontlib/file/<file>`), under the family, full and PostScript names, so text renders with the real face;
- answers `/api/fonts/:family/:weight?ps=<PostScript name>` from the library before Google Fonts, so PDF and .ai downloads embed it;
- maps extracted text to the library face at ingest by PostScript name, and does the same on open for creatives ingested earlier.

On file today: Source Sans 3, Source Serif 4, Lato 2.0 (with ₹), Merriweather, Noto Sans for eight Indic scripts, and seven Shree Lipi faces. Google Fonts' download endpoint returns Latin-only cuts unless a script subset is requested; the proxy adds it.

Legacy-encoded Indic fonts (Shree Lipi and similar, ~220 glyphs mapped onto ASCII) work for creatives set in them: the text looks like Latin gibberish in the Contents list but renders and exports correctly. They cannot be used for Unicode text such as the assistant's translations; those use Noto Sans faces per script, or a Unicode brand font if one is on file. Text set in a legacy face is marked (`text.encoding: "legacy"`, `meta.legacyScript`): the assistant's tools refuse to rewrite it or change its font and explain why, the toolbar and Contents list show a note and disable font switching, and double-click typing is off for it. Size, colour and position still work. Converting such copy to Unicode needs a per-font mapping table and is a separate piece of work.

## Brand kits

A brand kit is a folder under `web/public/brand/<id>/` with a `brand.json` (`colors.primary|secondary|tertiary` as `{name, hex}`, `fonts.headline|body` as `{family, styles, rule, fallback}`, `rules[]`, `logos[]` as `{id, name, file, kind, on: light|dark|orange, w, h}`) plus the logo SVGs. The Federal Bank kit was extracted from the brand book PDF (colour values from the palette pages, logo vectors pulled from the page artwork with MuPDF and recoloured per the colour-usage pages). Point the editor at another kit by changing the id in `loadBrand()` in `web/src/App.jsx`.

## Layout

```
shared/scene.js        normalize · understand · applyOps · TOOLS · runTool (browser + Node)
server/                index.mjs (HTTP) · ingest.mjs · pdf-extract.mjs · classify.mjs · chat.mjs · editor-server.mjs (MCP) · ingest-worker.mjs
web/                   Vite + React editor (src/App.jsx; components/ Home, EditorHeader, Toolbar, Canvas, BottomBar, AskBox, Form, ReadyCard, Activity; lib/ render, export, issues, brand)
web/public/brand/      brand kits (federal-bank: brand.json + logo SVGs)
illustrator/           Export Hypergro Scene.jsx
samples/               cashback-kv.ai (synthetic, PDF-compatible); web/public/samples/demo is the built-in demo bundle
docs/                  scene-format.md, classify/ingest prompts, the original Claude Design prototype
```

See `docs/scene-format.md` for the bundle format.
