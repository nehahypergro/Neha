# Hypergro Scene Format v1.0

Illustrator interprets Illustrator once (`illustrator/Export Hypergro Scene.jsx`). Everything downstream reads a **scene bundle**:

```
<name>-scene/
  scene.json          normalized scene graph
  reference-0.png     flat render of each artboard (visual ground truth)
  assets/             one raster (@2x PNG) per image / vector element, plus .svg for vectors
```

## Pipeline

```
.ai ─► INGESTION (Illustrator script) ─► NORMALIZATION (scene.json) ─► UNDERSTANDING (scene.js: roles, layout, semantic groups)
    ─► CLIENT EDITOR (click / chat ─► operations ─► scene ─► renderer / adapt / export)
```

## scene.json

```json
{
  "version": "1.0",
  "generator": "Export Hypergro Scene.jsx 1.0",
  "source":   { "file": "…/kv.ai", "colorSpace": "RGB", "units": "pt", "exportedAt": "…" },
  "document": { "name": "kv", "width": 1080, "height": 1080, "activeArtboard": 0,
                "artboards": [{ "id": 0, "name": "Artboard 1", "x": 0, "y": 0, "width": 1080, "height": 1080, "reference": "reference-0.png" }] },
  "fonts":    [{ "family": "Inter", "style": "Bold", "postScriptName": "Inter-Bold" }],
  "elements": [ … ]
}
```

Coordinates: px (1 pt = 1 px), origin top-left of the element's artboard, y down. `zIndex` ascends toward the viewer.

### Element

```json
{
  "id": "el_014", "type": "text | image | vector | group", "name": "Headline", "parentId": "group_012",
  "artboardId": 0, "zIndex": 14,
  "bounds":    { "x": 92, "y": 120, "width": 720, "height": 130 },
  "transform": { "rotation": 0, "scaleX": 1, "scaleY": 1 },
  "fill": "#FFFFFF", "gradient": null, "stroke": { "color": "#000000", "width": 1 }, "opacity": 1, "blendMode": "normal",
  "asset": "assets/vector-el_014.png", "assetSvg": "assets/vector-el_014.svg",
  "text": { "content": "Get 5% cashback", "fontFamily": "Inter", "fontStyle": "Bold", "postScriptName": "Inter-Bold",
            "fontSize": 64, "lineHeight": 72, "letterSpacing": -1, "align": "left", "kind": "point | area | path", "mixed": false },
  "editable": true, "locked": false, "visible": true,
  "role": "headline",
  "semanticGroup": "sg_cta_el_020",
  "layout": { "role": "headline", "anchor": "top-left", "importance": 0.95, "allowScale": true, "allowCrop": false,
              "minFontSize": 28, "safeZonePriority": "high" },
  "meta": { "layer": "Copy", "pathCount": 12, "collapsedGroup": true }
}
```

- `type: group` preserves Illustrator hierarchy (not rendered; children carry `parentId`). Path-only groups (logos, icons) are collapsed into a single `vector` with `meta.collapsedGroup`.
- `role` ∈ background, logo, headline, subhead, offer, cta, product, disclaimer, body, image, shape, decoration. Assigned by `understand()` in scene.js unless already present in the file (the exporter reads an Illustrator item name like `#headline` as an explicit role).
- `layout.anchor` ∈ fill, center, top-left, top-center, top-right, center-left, center-right, bottom-left, bottom-center, bottom-right. Drives `adapt()` when a scene is re-sized to another format.
- `semanticGroup` binds parts that move together (CTA shape + label, logo mark + wordmark).

## Operations (client → scene)

```json
{ "id": "el_014", "set": { "text": { "content": "Get 6% cashback" }, "fill": "#0B4EA2", "bounds": { "x": 100 }, "visible": true, "role": "offer", "layout": { "anchor": "top-right" } } }
```
`applyOps(scene, ops)` deep-merges `bounds`, `text`, `layout`; other keys replace. Ops are the only way the editor (click or chat) mutates a scene, so history, chat and direct manipulation share one path.
