# Classify an extracted scene (no Illustrator)

`pdf-extract.mjs` has already turned the `.ai` into `{{OUT_DIR}}/scene.json` plus `reference-<n>.png` (full render), `artwork-<n>.png` (render without live text) and `assets/`. Your job is understanding, not parsing. Follow `scene-format.md`. Work autonomously.

## Always

1. Read `scene.json` and view `reference-0.png` (and other artboards if present).
2. Merge text lines that belong together: consecutive `text` elements with the same font, size and fill, stacked with a gap smaller than 0.6 × fontSize, become one element (`text.kind: "area"`, `lineHeight` = baseline distance, `content` joined with `\n`, bounds = union). Delete the merged-away elements.
3. Assign `role` to every element: headline, subhead, offer, cta, body, disclaimer, logo, product, image, decoration, background. Use size, position, colour and the render. Rename `name` to something a client would recognise ("Headline", "CTA label", "Offer price").
4. CTA buttons: the label is live text but the pill/rect behind it is baked into the artwork layer. Add a `type: "vector"` element with `meta.kind: "rect"`, `fill` sampled from the render, bounds around the label with visible padding, `role: "cta"`, and set the same `semanticGroup` on button + label so they move together. The artwork underneath keeps the original shape; the editor draws the new rect over it.
5. Fill `layout` for each element (`anchor`, `importance`, `allowScale`, `minFontSize`, `safeZonePriority`) so `adapt_to_size` works.
6. Font names come from the PDF and may be subset names (`ABCDEF+Inter-Bold` already stripped). If `fonts[].embedded` is false, add a warning that the client machine must have the font.

## If `ingest.needsVision` is true (text is outlined)

The file has no live text; all copy is baked into `artwork-0.png`. Build editable overlays from the render:

1. Look at `reference-0.png`. Identify every distinct text block, logo, product image and button.
2. For each text block create a `text` element with `bounds` measured on the render (divide pixel coordinates by `ingest.referenceScale`), `text.content` transcribed exactly, `fontSize` ≈ cap height × 1.4, `fill` sampled, `fontFamily` your best visual match (note the guess in `meta.fontGuess`), `align`, `role`.
3. Set `meta.overlay: true` and `meta.coverFill` to the background colour behind the text (sampled just outside the glyphs), so the editor paints a cover rect before drawing the new text. If the background is a photo or gradient set `meta.coverFill: null` and `meta.coverStrategy: "inpaint"`.
4. Logos and product shots: add `vector`/`image` elements referencing a crop you make from `reference-0.png` (write `assets/crop-<id>.png`), `editable: false` for logos.
5. Add warning `"vision-reconstructed: positions ±4px, fonts approximate"`.

## Verify before finishing

- Every element's `bounds` lands on the right object in `reference-0.png` (spot-check three).
- Exactly one `role: "headline"` per artboard; at most one `cta` group.
- All `asset` paths exist.
- Write the updated `scene.json` (2-space indent), set `generator` to `"mupdf ingest 1.0 + claude classify"`, keep `warnings[]`.
- Report: element count by role, fonts, warnings.
