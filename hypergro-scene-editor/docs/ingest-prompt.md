# Ingest an Illustrator file into a Hypergro scene bundle

You are connected to Illustrator through the `illustrator-mcp` MCP server. Convert the file below into a scene bundle that follows `scene-format.md` in this repo. Work autonomously; do not ask questions unless the file cannot be opened.

- Source file: `{{AI_PATH}}`
- Output folder: `{{OUT_DIR}}` (create `scene.json`, `reference-<n>.png`, `assets/`)

## Steps

1. `open_document` the file. `get_document_info`; if `colorMode` is CMYK, call `set_workflow` with `web` so all coordinates are artboard-relative, y-down.
2. `get_artboards`. The active artboard is the scene's `document.width/height`; list all artboards under `document.artboards`.
3. `export` each artboard as PNG at 100% into `reference-<index>.png` (visual ground truth).
4. `get_document_structure` for the layer → group → object tree. Keep the hierarchy: every Illustrator group becomes a `type:"group"` element; children carry `parentId`. Use the tool's UUIDs as element ids (prefix `el_`), so re-ingest is stable.
5. Text: `list_text_frames`, then `get_text_frame_detail` for each. Fill `text.content`, `fontFamily`, `fontStyle`, `postScriptName`, `fontSize`, `lineHeight` (null when auto), `letterSpacing` (tracking/1000 × fontSize), `align`, `kind`. `fill` is the first character's colour as hex. Mark `mixed:true` when styling varies within the frame.
6. Images: `get_images`. One `type:"image"` element per placed/embedded image. `export` each by UUID as PNG @2× into `assets/image-<id>.png`. Record `meta.source` (file path or "embedded").
7. Vectors: `get_path_items` and `get_groups`. A group containing only paths (a logo, an icon) is one `type:"vector"` element with `meta.collapsedGroup:true` and `meta.pathCount`; export it once by UUID as PNG @2× and SVG into `assets/vector-<id>.(png|svg)`. Standalone paths are individual `vector` elements; record `fill`, `stroke`, `gradient` where present, and `meta.kind:"rect"` for 4-point axis-aligned paths.
8. Opacity / blend: `get_effects` → `opacity` (0–1) and `blendMode`.
9. Roles: leave `role` null unless the object name contains `#headline`, `#subhead`, `#cta`, `#logo`, `#offer`, `#product`, `#background`, `#disclaimer`; the editor's `understand()` assigns the rest. Strip the `#tag` from `name`.
10. Fonts: collect unique family/style/postScriptName under `fonts`.
11. Write `scene.json` (UTF-8, 2-space indent). Set `generator` to `"illustrator-mcp ingest"`, `version` `"1.0"`, and put anything you could not read into `warnings[]`.

## Verify before finishing

- Element count in `scene.json` equals the leaf count from `get_document_structure` (minus guides, hidden items, clip paths).
- Every `asset` path exists on disk.
- Sanity-check three elements against `reference-0.png`: their `bounds` should land where the object is visible.
- Report: element count by type, detected fonts, warnings.

## Rules

- Never modify the source document; if you must temporarily unlock or unhide, `undo` afterwards.
- `zIndex` ascends toward the viewer, following document stacking order.
- Coordinates in px = pt, origin top-left of the element's artboard, y down.
