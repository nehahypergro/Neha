# Handoff: OpenDesign probe → ai-extract.mjs

Read `README.md` and `../scene-format.md` first.

## Task 1 — run the probe

```
cd mcp && npm i @opendesign/illustrator-parser-pdfcpu
node probe-opendesign.mjs ../samples/<client>.ai
```

Check the summary:
- `textSamples` non-empty and readable → text path works
- `layerNames` contain author names ("CTA", "Logo", "Headline") → naming free, skip Claude classification for simple files
- `PROBE_FAIL`/`PROBE_PARTIAL` on recent Illustrator saves → private-data format drifted; stop here, MuPDF stays primary

Inspect `probe/<name>.json` for the actual node shape (keys vary between parser versions; the probe's summary is heuristic).

## Task 2 — if it looks good: `mcp/ai-extract.mjs`

Map the probe JSON to `scene.json` v1.0 (see scene-format.md):
- artboards → `document.artboards` (id, name, x, y, width, height); pt = px, y-down, origin top-left of artboard
- text nodes → `type: text` with `text.content`, `fontFamily`, `fontStyle`, `postScriptName`, `fontSize`, `fill`, `bounds`
- image XObjects → `type: image` + `assets/image-*.png`
- layer names → `name` and `meta.layer`; an item named `#headline` etc. sets `role` explicitly
- everything else → render with MuPDF (`pdf-extract.mjs` already does this) as one locked `artwork-<n>.png` + `reference-<n>.png`
- same CLI as pdf-extract: `node ai-extract.mjs <file.ai> <outdir>`; exit non-zero on parse failure

## Task 3 — wire into the worker

In `ingest-worker.mjs`, try `ai-extract.mjs` first; on non-zero exit fall back to `pdf-extract.mjs`. Record which parser ran in `scene.json` → `source.parser` (`"opendesign" | "mupdf"`) and in the outbox `<id>.json`. Skip the Claude classify step when every text element already has a `role` from layer names.

Add `hypergro-ai-extract` to `package.json` bins/scripts and update README's pipeline diagram.

## Task 2b — if it partially fails

Keep MuPDF primary. Use OpenDesign only to enrich: artboard names and layer names merged into the MuPDF scene by bounds overlap. Guard the whole call in try/catch; never let it fail an ingest.

## Verify

`node ai-extract.mjs ../samples/<client>.ai out/x` then open `out/x` in `Scene Editor.dc.html` (or zip it, use the ".zip" button). Text must be selectable/editable and positioned within ±2px of `reference-0.png`.
