// Ingest step 2: design understanding with Claude (vision + structured output). Turns the raw MuPDF extraction into
// the elements a marketer edits: merged paragraphs, roles, human names, CTA buttons, and — for outlined files — text
// overlays reconstructed from the render. Parsing is done by MuPDF; this step only decides what things *are*.
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import * as mupdf from 'mupdf';
import path from 'node:path';
import { ROLES } from '../shared/scene.js';
import { MODEL, getClient } from './chat.mjs';

const ALIGN = ['left', 'center', 'right'];
const box = { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } };
const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const nullable = (t) => ({ anyOf: [t, { type: 'null' }] });
export const SCHEMA = obj({
  merges: { type: 'array', items: obj({ ids: { type: 'array', items: { type: 'string' } }, content: { type: 'string' }, lineHeight: nullable({ type: 'number' }) }) },
  elements: { type: 'array', items: obj({ id: { type: 'string' }, role: { type: 'string', enum: ROLES }, name: { type: 'string' }, align: nullable({ type: 'string', enum: ALIGN }) }) },
  ctaButtons: { type: 'array', items: obj({ labelId: { type: 'string' }, fill: { type: 'string' }, ...box, cornerRadius: { type: 'number' } }) },
  overlays: { type: 'array', items: obj({ content: { type: 'string' }, ...box, fontSize: { type: 'number' }, fill: { type: 'string' }, fontFamilyGuess: { type: 'string' }, fontStyle: { type: 'string' }, align: { type: 'string', enum: ALIGN }, role: { type: 'string', enum: ROLES }, coverFill: nullable({ type: 'string' }) }) },
  cutouts: { type: 'array', items: obj({ name: { type: 'string' }, ...box, role: { type: 'string', enum: ['logo', 'product', 'decoration'] }, backgroundFill: nullable({ type: 'string' }) }) },
  warnings: { type: 'array', items: { type: 'string' } },
});

const SYSTEM = `You are the design-understanding step of an ad-creative ingestion pipeline. You receive (1) a flat render of an Illustrator artboard and (2) the raw elements MuPDF extracted from it: live text lines (one element per line), embedded images, filled shapes, and one locked "Artwork" raster that holds everything else. Your job is understanding, not parsing: turn raw lines into the semantic elements a marketer would edit, so that the editor can change copy, colours and positions and re-lay the creative out for other ad sizes.

Return JSON matching the schema. Coordinates are scene px (1 pt = 1 px), origin at the top-left of the artboard, y down. The render is previewScale × scene px, so divide pixel measurements by previewScale.

1. merges — Group consecutive text lines that read as ONE block (a wrapped headline, a two-line subhead, a paragraph): same font, size and colour, stacked with a vertical gap smaller than 0.6 × fontSize, consistently aligned. List ids in reading order; content = lines joined with "\\n"; lineHeight = distance between consecutive baselines in px (null for a single line). Never merge lines that play different roles even if adjacent (a headline and the subhead under it stay separate). A price or offer line stays its own element.
2. elements — One entry for every element id that survives merging (use the FIRST id of a merged group), including images and shapes. Assign the role and a short human name ("Headline", "Subhead", "Offer", "CTA label", "CTA button", "Logo mark", "Logo wordmark", "Product shot", "Disclaimer", "Decoration"). Exactly one headline per artboard; at most one CTA label; the biggest photo is usually the product. Small text at the very bottom is disclaimer. Uppercase short text next to a small graphic is a logo wordmark. For text, align is how the block is aligned within its column (left/center/right); null for non-text.
3. ctaButtons — If a CTA label sits on a button that is NOT already one of the listed shape elements (the button is baked into the artwork), describe it: fill sampled from the render (hex), bounds in scene px with the visible padding around the label, cornerRadius (half the height for a pill). If a listed shape already IS the button, do not add one here; give that shape the role "cta" in elements instead.
4. overlays — Only when needsVision is true (the file has no live text because copy was outlined). Transcribe every text block visible in the render exactly. For overlays ONLY, give bounds and fontSize in RENDER PIXELS exactly as you measure them on the image (do not divide by previewScale; the server converts), fontSize ≈ cap height × 1.4, fill sampled from the glyphs, fontFamilyGuess (closest common font), fontStyle (Regular/Bold/…), align, role, and coverFill = the flat background colour immediately around the glyphs (null when the text sits on a photo or gradient). Otherwise return an empty array.
5. cutouts — Logos, logo marks, wordmarks (with their underline or tagline), product shots and badges that are VISIBLE in the render but NOT in the element list because they are baked into the Artwork raster (or a listed shape is only one piece of them). Give a tight box in RENDER PIXELS around each whole mark, a short name ("Federal Bank wordmark", "Kotak logo"), its role, and backgroundFill = the flat colour behind it (hex) or null when it sits on a photo or gradient. The server cuts those pixels out as a movable image. Never list text blocks (those are overlays) or anything that already exists as a separate element.
6. warnings — Short notes a client should know: missing fonts, low-confidence roles, outlined text, anything you could not place.

Be precise with coordinates; every bounds must land on the object in the render.`;

const pick = (s) => ({ id: s.id, type: s.type, name: s.name, role: s.role, bounds: s.bounds, ...(s.text ? { text: s.text.content, font: [s.text.fontFamily, s.text.fontStyle].filter(Boolean).join(' '), fontSize: s.text.fontSize, align: s.text.align } : {}), ...(s.type === 'vector' ? { fill: s.fill, kind: s.meta?.kind } : {}), ...(s.type === 'text' ? { fill: s.fill } : {}) });
const hexOk = (h) => /^#[0-9a-f]{6}$/i.test(h || '');
const r2 = (v) => Math.round(v * 100) / 100;
const union = (bs) => { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)); return { x: r2(x0), y: r2(y0), width: r2(Math.max(...bs.map((b) => b.x + b.width)) - x0), height: r2(Math.max(...bs.map((b) => b.y + b.height)) - y0) }; };

// Structured outputs are the preferred way to get schema-valid JSON. Some platforms/org policies (e.g. Vertex AI
// `constraints/vertexai.allowedPartnerModelFeatures`) reject the feature with a 400; then we fall back to asking for
// JSON in the prompt and parsing it. The flag is sticky per process so later calls skip the failing attempt.
let structuredOutputs = process.env.CLAUDE_STRUCTURED_OUTPUTS !== '0';
const structuredOutputsBlocked = (e) => e instanceof Anthropic.BadRequestError && /structured_outputs|allowedPartnerModelFeatures|output_config|json_schema/i.test(e.message);
const JSON_FALLBACK = `\n\nOutput format: reply with ONLY a JSON object — no prose, no code fences — that validates against this JSON Schema:\n`;
export const extractJson = (text) => { const t = String(text).trim(); const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); const body = (m ? m[1] : t).trim(); return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1)); };

const request = (content, useFormat) => getClient().messages.create({
  model: MODEL, max_tokens: 16000, system: useFormat ? SYSTEM : SYSTEM + JSON_FALLBACK + JSON.stringify(SCHEMA),
  thinking: { type: 'adaptive' }, output_config: useFormat ? { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } } : { effort: 'high' },
  messages: [{ role: 'user', content }],
});

/** Ask Claude; returns the raw classification object. */
export async function askClaude(scene, outDir) {
  const ab = scene.document.activeArtboard ?? 0;
  const previewPath = path.join(outDir, scene.document.artboards?.[ab]?.preview || scene.ingest?.preview || 'preview-0.png');
  const image = (await readFile(previewPath)).toString('base64');
  const payload = {
    canvas: { width: scene.document.width, height: scene.document.height }, previewScale: scene.ingest?.previewScale ?? 1,
    needsVision: !!scene.ingest?.needsVision, fonts: scene.fonts, extractorWarnings: scene.warnings,
    elements: scene.elements.filter((e) => e.type !== 'group' && (e.artboardId ?? 0) === ab).map(pick),
  };
  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
    { type: 'text', text: 'Extracted elements and context (JSON):\n' + JSON.stringify(payload) },
  ];
  let res = null;
  if (structuredOutputs) {
    try { res = await request(content, true); }
    catch (e) { if (!structuredOutputsBlocked(e)) throw e; structuredOutputs = false; console.warn('[classify] structured outputs rejected by the platform; using prompt-enforced JSON from now on:', e.message.slice(0, 200)); }
  }
  if (!res) res = await request(content, false);
  if (res.stop_reason === 'refusal') throw new Error('classification refused' + (res.stop_details?.explanation ? ': ' + res.stop_details.explanation : ''));
  if (res.stop_reason === 'max_tokens') throw new Error('classification output truncated');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return extractJson(text);
}

/** Deterministically apply a classification to a scene (pure). */
export function applyClassification(scene, out) {
  const byId = new Map(scene.elements.map((e) => [e.id, { ...e, text: e.text ? { ...e.text } : undefined, meta: { ...(e.meta || {}) } }]));
  const warnings = [...(scene.warnings || []), ...(out.warnings || []).map((w) => 'classify: ' + w)];
  // 1. merge text lines
  for (const m of out.merges || []) {
    const parts = (m.ids || []).map((i) => byId.get(i)).filter((e) => e && e.type === 'text');
    if (parts.length < 2) continue;
    const head = parts[0], b = union(parts.map((p) => p.bounds));
    const lines = String(m.content || parts.map((p) => p.text.content).join('\n')).split('\n').length;
    // Merged lines keep their explicit line breaks and do not auto-wrap ('point'): the PDF had no wrapping semantics and
    // browser font metrics differ slightly from MuPDF's, which would otherwise re-wrap lines mid-word.
    head.bounds = b; head.text.content = m.content || parts.map((p) => p.text.content).join('\n'); head.text.kind = 'point';
    // Justified copy: most lines end on the same right edge and start on the same left edge. Keep that, or every line
    // comes back a little narrower than the original (the PDF stretched the spaces; we would not).
    if (parts.some((p) => p.text.align === 'justify')) head.text.align = 'justify'; // the extractor already saw the column edges
    if (parts.length >= 3) { const right = Math.max(...parts.map((p) => p.bounds.x + p.bounds.width)), left = Math.min(...parts.map((p) => p.bounds.x)); const full = parts.slice(0, -1).filter((p) => Math.abs(p.bounds.x + p.bounds.width - right) <= 2 && Math.abs(p.bounds.x - left) <= 2).length; if (full >= 2 && full >= (parts.length - 1) * 0.6) head.text.align = 'justify'; }
    head.text.lineHeight = m.lineHeight || (lines > 1 ? Math.round(((parts[parts.length - 1].bounds.y - head.bounds.y) / (parts.length - 1)) * 100) / 100 : null);
    head.name = head.text.content.replace(/\s+/g, ' ').slice(0, 40);
    parts.slice(1).forEach((p) => byId.delete(p.id));
  }
  // 2. roles + names + alignment
  for (const c of out.elements || []) {
    const e = byId.get(c.id); if (!e) continue;
    if (ROLES.includes(c.role)) e.role = c.role;
    if (c.name) e.name = c.name;
    if (e.text && ALIGN.includes(c.align) && e.text.align !== 'justify') e.text.align = c.align; // measured justification beats the model's guess
  }
  // 3. CTA buttons drawn under labels + semantic groups
  const els = [...byId.values()];
  for (const btn of out.ctaButtons || []) {
    const label = byId.get(btn.labelId); if (!label || label.type !== 'text') continue;
    const sg = 'sg_cta_' + label.id; label.semanticGroup = sg; label.role = 'cta';
    els.push({ id: 'el_btn_' + label.id.replace(/^el_/, ''), type: 'vector', name: 'CTA button', parentId: null, artboardId: label.artboardId ?? 0, zIndex: label.zIndex - 0.5,
      bounds: { x: btn.x, y: btn.y, width: btn.width, height: btn.height }, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: hexOk(btn.fill) ? btn.fill.toUpperCase() : '#E8541E', gradient: null, stroke: null, opacity: 1, blendMode: 'normal',
      asset: null, renderMode: 'css', editable: true, locked: false, visible: true, role: 'cta', semanticGroup: sg, meta: { kind: 'rect', cornerRadius: btn.cornerRadius || 0, addedBy: 'classify' } });
  }
  const ctaText = els.filter((e) => e.type === 'text' && e.role === 'cta' && !e.semanticGroup);
  for (const t of ctaText) {
    const cx = t.bounds.x + t.bounds.width / 2, cy = t.bounds.y + t.bounds.height / 2;
    const shape = els.find((e) => e.type === 'vector' && e.role === 'cta' && !e.semanticGroup && cx >= e.bounds.x && cx <= e.bounds.x + e.bounds.width && cy >= e.bounds.y && cy <= e.bounds.y + e.bounds.height);
    if (shape) { t.semanticGroup = shape.semanticGroup = 'sg_cta_' + t.id; if (shape.name === 'Shape') shape.name = 'CTA button'; }
  }
  // 4. logo group: mark + wordmark
  const logos = els.filter((e) => e.role === 'logo' && !e.semanticGroup);
  if (logos.length > 1) { const sg = 'sg_logo_' + logos[0].id; logos.forEach((e) => (e.semanticGroup = sg)); }
  // 5. overlays for outlined text. Measurements come back in render pixels; convert to scene px here. If the model
  //    already converted (boxes would fall off the artboard when scaled), keep them as they are.
  let n = 0;
  const W = scene.document.width, H = scene.document.height, k = 1 / (scene.ingest?.previewScale || 1);
  const ovl = out.overlays || [];
  const fits = (s) => ovl.every((o) => (o.x + o.width) * s <= W * 1.05 && (o.y + o.height) * s <= H * 1.05);
  const ks = fits(k) ? k : 1;
  const ROLE_NAMES = { headline: 'Headline', subhead: 'Subhead', offer: 'Offer', cta: 'Button label', body: 'Body copy', disclaimer: 'Small print', logo: 'Logo wordmark', decoration: 'Text' };
  const used = {};
  for (const o of ovl) {
    if (['logo', 'decoration'].includes(o.role)) { warnings.push(`classify: “${(o.content || '').slice(0, 30)}” is the logo / a decoration; kept as artwork, not rebuilt as text`); continue; }
    n++;
    const role = ROLES.includes(o.role) ? o.role : 'body'; const base = ROLE_NAMES[role] || 'Text'; used[base] = (used[base] || 0) + 1;
    const r2 = (v) => Math.round(v * ks * 100) / 100;
    els.push({ id: `el_ovl_${String(n).padStart(3, '0')}`, type: 'text', name: used[base] > 1 ? `${base} ${used[base]}` : base, parentId: null, artboardId: 0, zIndex: 1e4 + n,
      bounds: { x: r2(o.x), y: r2(o.y), width: r2(o.width), height: r2(o.height) }, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: hexOk(o.fill) ? o.fill.toUpperCase() : '#000000', gradient: null, stroke: null, opacity: 1, blendMode: 'normal',
      text: { content: o.content, fontFamily: o.fontFamilyGuess || null, fontStyle: o.fontStyle || 'Regular', postScriptName: null, fontSize: r2(o.fontSize), lineHeight: null, letterSpacing: 0, align: ALIGN.includes(o.align) ? o.align : 'left', kind: o.content.includes('\n') ? 'area' : 'point', mixed: false },
      editable: true, locked: false, visible: true, role, meta: { overlay: true, coverFill: hexOk(o.coverFill) ? o.coverFill : null, coverStrategy: hexOk(o.coverFill) ? 'flat' : 'inpaint', fontGuess: o.fontFamilyGuess } });
  }
  if (n) warnings.push('vision-reconstructed: positions ±4px, fonts approximate');
  els.sort((a, b) => a.zIndex - b.zIndex).forEach((e, i) => (e.zIndex = i));
  return { ...scene, generator: (scene.generator || 'mupdf ingest') + ' + claude classify', elements: els, warnings, source: { ...(scene.source || {}), classifier: 'claude', classifierModel: MODEL } };
}

export async function classify(scene, outDir) {
  const out = await askClaude(scene, outDir);
  return applyCutouts(applyClassification(scene, out), out, outDir);
}

// ---- cutouts: lift a logo / mark / product shot out of the artwork rasters into its own movable image
const hexRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
async function cutRegion(outDir, scene, box, fill, index) {
  const s = scene.ingest?.referenceScale || 2;
  // Only this page's layers: a multi-page file has the same logo on every page, and cutting it out of all of them would leave
  // pages 2+ without a logo and stack three slightly offset copies on page 1.
  const ab = scene.document?.activeArtboard ?? 0;
  const allLayers = scene.elements.filter((e) => e.meta?.collapsedGroup && e.asset && (e.artboardId ?? 0) === ab).sort((a, b) => a.zIndex - b.zIndex);
  if (!allLayers.length) return null;
  // A promoted shape or image that overlaps the box and sits between two artwork layers keeps those layers apart: the
  // clapperboard's yellow panel (its own element) hides part of the purple plate painted below it, and merging the plate
  // into a cutout drawn above the panel would bring that hidden part back. So only one run of layers with no such
  // element in between is lifted: the run with the most content inside the box.
  const hits = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const blockers = scene.elements.filter((e) => e.type !== 'text' && !(e.meta?.collapsedGroup && e.asset) && e.bounds && hits(e.bounds, box)).map((e) => e.zIndex);
  const runs = []; for (const l of allLayers) { const last = runs[runs.length - 1]; if (last && !blockers.some((z) => z > last[last.length - 1].zIndex && z < l.zIndex)) last.push(l); else runs.push([l]); }
  let layers = allLayers;
  if (runs.length > 1) {
    const content = async (l) => { try { const pix = new mupdf.Image(await readFile(path.join(outDir, l.asset))).toPixmap(); const W = pix.getWidth(), H = pix.getHeight(), px = pix.getPixels(); if (pix.getNumberOfComponents() !== 4) return 0; let c = 0; for (let y = Math.max(0, Math.round(box.y * s)); y < Math.min(H, Math.round((box.y + box.height) * s)); y += 3) for (let x = Math.max(0, Math.round(box.x * s)); x < Math.min(W, Math.round((box.x + box.width) * s)); x += 3) if (px[(y * W + x) * 4 + 3] > 40) c++; return c; } catch { return 0; } };
    let best = null, bestN = -1; for (const r of runs) { let n = 0; for (const l of r) n += await content(l); if (n > bestN) { bestN = n; best = r; } }
    layers = best;
  }
  const z = layers[layers.length - 1].zIndex + 0.5; // the cutout sits right above the layers it came from
  let outPix = null, rw = 0, rh = 0, cut = false, region = null; const fillRgb = hexRgb(fill);
  for (const layer of layers) {
    const file = path.join(outDir, layer.asset); let pix;
    try { pix = new mupdf.Image(await readFile(file)).toPixmap(); } catch { continue; }
    const W = pix.getWidth(), H = pix.getHeight(), n = pix.getNumberOfComponents(); if (n !== 4) continue;
    const grow = Math.round(2 * s); // a little past the reported box so anti-aliased edges come along
    const x0 = Math.max(0, Math.round(box.x * s) - grow), y0 = Math.max(0, Math.round(box.y * s) - grow), x1 = Math.min(W, Math.round((box.x + box.width) * s) + grow), y1 = Math.min(H, Math.round((box.y + box.height) * s) + grow);
    region = { x: x0 / s, y: y0 / s, width: (x1 - x0) / s, height: (y1 - y0) / s };
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    if (!outPix) { rw = x1 - x0; rh = y1 - y0; outPix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, rw, rh], true); outPix.clear(); }
    const px = pix.getPixels(); let inside = 0, ring = 0, ringTotal = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (px[(y * W + x) * 4 + 3] > 40) inside++;
    if (!inside) continue;
    // Is the background baked into this layer too? Look at a ring just outside the box: opaque there means a photo or
    // gradient continues under the mark, so cutting would leave a hole unless we know the flat colour to paint back.
    const pad = Math.max(6, Math.round(4 * s));
    for (let y = Math.max(0, y0 - pad); y < Math.min(H, y1 + pad); y += 2) for (let x = Math.max(0, x0 - pad); x < Math.min(W, x1 + pad); x += 2) { if (x >= x0 && x < x1 && y >= y0 && y < y1) continue; ringTotal++; if (px[(y * W + x) * 4 + 3] > 40) ring++; }
    const baked = ringTotal ? ring / ringTotal > 0.5 : false;
    // The hole left behind is filled from its own border, blended across the box, so a gradient or a soft vignette
    // behind the mark continues smoothly (a flat colour showed as a rectangle the moment the logo moved).
    const border = (x, y) => { const i = (Math.min(W - 1, Math.max(0, x)) * 1 + Math.min(H - 1, Math.max(0, y)) * W) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
    const patch = (x, y) => { const L = border(x0 - 1, y), R = border(x1, y), T = border(x, y0 - 1), Bt = border(x, y1); const fx = (x - x0 + 0.5) / (x1 - x0), fy = (y - y0 + 0.5) / (y1 - y0);
      const h = [0, 1, 2, 3].map((c) => L[c] * (1 - fx) + R[c] * fx), v = [0, 1, 2, 3].map((c) => T[c] * (1 - fy) + Bt[c] * fy); const wx = Math.min(fx, 1 - fx), wy = Math.min(fy, 1 - fy); const t = wx + wy > 0 ? wy / (wx + wy) : 0.5; // nearer edge weighs more
      return [0, 1, 2, 3].map((c) => Math.round(h[c] * t + v[c] * (1 - t))); };
    const op = outPix.getPixels();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4, o = ((y - y0) * rw + (x - x0)) * 4; const sa = px[i + 3] / 255; // premultiplied "over"
      for (let c = 0; c < 4; c++) op[o + c] = Math.min(255, px[i + c] + op[o + c] * (1 - sa));
      if (baked) { const q = patch(x, y);
        // The lifted image must be only the mark: any pixel that matches the background it sat on becomes transparent
        // (with a soft edge), so moving the logo does not drag a rectangle of the old background along.
        const dist = Math.max(Math.abs(op[o] - q[0]), Math.abs(op[o + 1] - q[1]), Math.abs(op[o + 2] - q[2])); const keep = dist <= 24 ? 0 : dist >= 60 ? 1 : (dist - 24) / 36;
        if (keep < 1) { const a = op[o + 3] * keep; for (let c = 0; c < 3; c++) op[o + c] = Math.round(op[o + c] * keep); op[o + 3] = Math.round(a); }
        px[i] = q[0]; px[i + 1] = q[1]; px[i + 2] = q[2]; px[i + 3] = q[3]; } else { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; }
    }
    await writeFile(file, pix.asPNG()); cut = true;
  }
  if (!cut) return null;
  const asset = `assets/cutout-${index}.png`; await writeFile(path.join(outDir, asset), outPix.asPNG());
  return { asset, pixelWidth: rw, pixelHeight: rh, box: region, z };
}
export async function applyCutouts(scene, out, outDir) {
  const list = out.cutouts || []; if (!list.length || !outDir) return scene;
  const W = scene.document.width, H = scene.document.height, k = 1 / (scene.ingest?.previewScale || 1);
  const ks = list.every((o) => (o.x + o.width) * k <= W * 1.05 && (o.y + o.height) * k <= H * 1.05) ? k : 1;
  const els = [...scene.elements], warnings = [...(scene.warnings || [])]; let n = 0;
  for (const o of list) {
    const box = { x: Math.round(o.x * ks), y: Math.round(o.y * ks), width: Math.round(o.width * ks), height: Math.round(o.height * ks) };
    if (box.width < 4 || box.height < 4) continue;
    let res = null; try { res = await cutRegion(outDir, scene, box, o.backgroundFill, ++n); } catch (e) { warnings.push(`cutout ${o.name}: ${e.message}`); }
    if (!res) { warnings.push(`“${o.name}” sits on a photo or gradient in the artwork, so it stays part of the artwork and cannot be moved on its own`); continue; }
    const role = ['logo', 'product', 'decoration'].includes(o.role) ? o.role : 'decoration';
    els.push({ id: `el_cut_${String(n).padStart(3, '0')}`, type: 'image', name: o.name || 'Logo', parentId: null, artboardId: 0, zIndex: res.z ?? 9000 + n, bounds: res.box || box, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: null, gradient: null, stroke: null, opacity: 1, blendMode: 'normal',
      asset: res.asset, assetSvg: null, editable: true, locked: false, visible: true, role, meta: { cutout: true, source: 'artwork', pixelWidth: res.pixelWidth, pixelHeight: res.pixelHeight } });
    warnings.push(`“${o.name}” was lifted out of the artwork as its own image so it can be moved or swapped`);
  }
  els.sort((a, b) => a.zIndex - b.zIndex).forEach((e, i) => (e.zIndex = i));
  return { ...scene, elements: els, warnings };
}

/** Read the words of one element from the original render (for text typed in a legacy font). Returns { text, script, confidence }. */
export async function transcribeElement(scene, outDir, el, hint = {}) {
  const ab = scene.document.activeArtboard ?? 0; const ref = scene.document.artboards?.[ab]?.reference || 'reference-0.png';
  const s = scene.ingest?.referenceScale || 2;
  const img = new mupdf.Image(await readFile(path.join(outDir, ref))); const pix = img.toPixmap(); const W = pix.getWidth(), H = pix.getHeight();
  const pad = Math.round(6 * s); const b = el.bounds;
  const x0 = Math.max(0, Math.round(b.x * s) - pad), y0 = Math.max(0, Math.round(b.y * s) - pad), x1 = Math.min(W, Math.round((b.x + b.width) * s) + pad), y1 = Math.min(H, Math.round((b.y + b.height) * s) + pad);
  const crop = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, x1 - x0, y1 - y0], false); crop.clear(255);
  const src = pix.getPixels(), dst = crop.getPixels(), n = pix.getNumberOfComponents(), cw = x1 - x0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * n, o = ((y - y0) * cw + (x - x0)) * 3; dst[o] = src[i]; dst[o + 1] = src[i + 1]; dst[o + 2] = src[i + 2]; }
  const png = Buffer.from(crop.asPNG()).toString('base64');
  const client = getClient(); const script = hint.script || 'Indic';
  const r = await client.messages.create({ model: MODEL, max_tokens: 1000,
    system: `You read text out of a small crop of an advertisement render. The text is in ${script} script${hint.language ? ` (${hint.language})` : ''}. Transcribe it EXACTLY as printed, in Unicode, keeping line breaks as \n and any digits, ₹ amounts and punctuation. Return ONLY JSON: {"text": "...", "confidence": "high|medium|low", "notes": "..."}.`,
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'text', text: 'Transcribe this line.' }] }] });
  const text = r.content.filter((c) => c.type === 'text').map((c) => c.text).join(''); const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('unexpected reply');
  const out = JSON.parse(m[0]); return { text: String(out.text || '').replace(/\\n/g, '\n').trim(), confidence: out.confidence || 'medium', notes: out.notes || '' };
}
