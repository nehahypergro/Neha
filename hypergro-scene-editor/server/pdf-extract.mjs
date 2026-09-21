#!/usr/bin/env node
// Illustrator-free ingest, step 1: read the PDF stream inside an .ai (every "PDF compatible" save — the default) with
// MuPDF and write a raw scene bundle. Runs anywhere Node 20+ runs (mupdf is WASM, no native deps, no Adobe software).
//
//   node server/pdf-extract.mjs <file.ai|pdf> <outdir> [--scale 2]
//
// Output: <outdir>/scene.json (roles null except the artwork layer), reference-<n>.png (full render, @scale),
// preview-<n>.png (≤1400px render for the vision step), artwork-<n>.png (page rendered WITHOUT live text, promoted
// shapes and promoted images — those become editable elements), assets/image-*.png, extract.json (stats).
import * as mupdf from 'mupdf';
import { parseFontName } from '../shared/fontname.js';
import { library } from './fontlib.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const r1 = (v) => Math.round(v * 100) / 100;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const hex = (rgb) => '#' + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const toRGB = (n, color) => { // mupdf colour → [r,g,b] 0..1 (CMYK converted naively, no ICC)
  if (!color || !color.length) return [0, 0, 0];
  if (n === 1 || color.length === 1) return [color[0], color[0], color[0]];
  if (n === 4 || color.length === 4) { const [c, m, y, k] = color; return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]; }
  return color.slice(0, 3);
};
const rect = ([x0, y0, x1, y1], ox, oy) => ({ x: r1(x0 - ox), y: r1(y0 - oy), width: r1(x1 - x0), height: r1(y1 - y0) });
const el = (over) => ({ parentId: null, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: null, gradient: null, stroke: null, opacity: 1, blendMode: 'normal', asset: null, editable: true, locked: false, visible: true, role: null, meta: {}, ...over });
const inside = (a, b, tol = 1) => a[0] >= b[0] - tol && a[1] >= b[1] - tol && a[2] <= b[2] + tol && a[3] <= b[3] + tol;
const unitRect = (ctm) => { const [a, b, c, d, e, f] = ctm; const xs = [e, a + e, c + e, a + c + e], ys = [f, b + f, d + f, b + d + f]; return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

/** Designers sometimes place a word letter by letter ("P L E A S E"). Adjacent one-to-three-character text objects with the
 *  same font, size, colour and baseline become one line with tracking, so the marketer edits a word, not twelve letters. */
function mergeLetterRuns(elements, stats) {
  const texts = elements.filter((e) => e.type === 'text' && !e.transform?.rotation && e.text.kind === 'point' && !e.text.content.includes('\n') && e.text.content.trim().length <= 3);
  const key = (e) => `${e.artboardId}|${e.text.fontFamily}|${e.text.fontStyle}|${Math.round(e.text.fontSize * 2)}|${e.fill}|${Math.round((e.bounds.y + e.bounds.height) / Math.max(4, e.text.fontSize * 0.12))}`;
  const groups = new Map(); for (const e of texts) { const k = key(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const drop = new Set();
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.bounds.x - b.bounds.x); const size = list[0].text.fontSize;
    let chain = [list[0]];
    const flush = () => {
      if (chain.length >= 3) {
        const gaps = chain.slice(1).map((e, i) => e.bounds.x - (chain[i].bounds.x + chain[i].bounds.width));
        const med = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
        let text = chain[0].text.content; for (let i = 1; i < chain.length; i++) text += (gaps[i - 1] > med + size * 0.15 ? ' ' : '') + chain[i].text.content;
        const x0 = chain[0].bounds.x, x1 = Math.max(...chain.map((e) => e.bounds.x + e.bounds.width)), y0 = Math.min(...chain.map((e) => e.bounds.y)), y1 = Math.max(...chain.map((e) => e.bounds.y + e.bounds.height));
        const first = chain[0]; first.text = { ...first.text, content: text, letterSpacing: r1(Math.max(0, med - size * 0.06)) }; first.name = text.slice(0, 40); first.bounds = { x: x0, y: y0, width: r1(x1 - x0), height: r1(y1 - y0) };
        chain.slice(1).forEach((e) => drop.add(e.id)); stats.mergedLetters = (stats.mergedLetters || 0) + chain.length - 1;
      }
    };
    for (let i = 1; i < list.length; i++) { const prev = chain[chain.length - 1]; const gap = list[i].bounds.x - (prev.bounds.x + prev.bounds.width); if (gap >= -size * 0.2 && gap < size * 1.5) chain.push(list[i]); else { flush(); chain = [list[i]]; } }
    flush();
  }
  if (drop.size) { const kept = elements.filter((e) => !drop.has(e.id)); elements.length = 0; elements.push(...kept); }
}

/** TrueType/OpenType programs embedded in the PDF (subsets): saved into the library's "embedded" folder. */
async function keepEmbeddedFonts(doc) {
  const kept = []; const seen = new Set();
  const visit = async (fonts) => {
    if (!fonts || !fonts.isDictionary?.()) return; const items = [];
    fonts.forEach?.((v) => items.push(v));
    for (const f of items) {
      try {
        const base = f.get('BaseFont')?.asName?.() || ''; const ps = base.replace(/^[A-Z]{6}\+/, ''); if (!ps || seen.has(ps)) continue; seen.add(ps);
        let desc = f.get('FontDescriptor'); const kids = f.get('DescendantFonts'); if (kids && kids.isArray?.()) desc = kids.get(0).get('FontDescriptor');
        if (!desc || !desc.isDictionary?.()) continue;
        let file = desc.get('FontFile2'); let ok = file && file.isStream?.();
        if (!ok) { file = desc.get('FontFile3'); ok = file && file.isStream?.() && file.get('Subtype')?.asName?.() === 'OpenType'; }
        if (!ok) continue;
        const bytes = Buffer.from(file.readStream().asUint8Array()); if (bytes.length < 1000) continue;
        const r = await library.addEmbedded(ps, bytes); if (r) kept.push(r.family + (r.style !== 'Regular' ? ' ' + r.style : ''));
      } catch {}
    }
  };
  const n = Math.min(doc.countPages(), 8);
  for (let i = 0; i < n; i++) {
    const res = doc.loadPage(i).getObject?.()?.get('Resources'); if (!res || !res.isDictionary?.()) continue;
    await visit(res.get('Font'));
    const xo = res.get('XObject'); const forms = []; if (xo && xo.isDictionary?.()) xo.forEach?.((x) => forms.push(x));
    for (const x of forms) { try { const r2 = x.get('Resources'); if (r2 && r2.isDictionary?.()) await visit(r2.get('Font')); } catch {} }
  }
  return kept;
}

export class ExtractError extends Error { constructor(msg, code = 'EXTRACT_FAIL') { super(msg); this.code = code; } }

// Walk a filled path: bounds in device space, plus whether it is a rectangle / rounded rectangle / ellipse that can be
// promoted to an editable shape element (drawn by the editor as a CSS rect instead of being baked into the artwork raster).
function inspectPath(pth, ctm) {
  let lines = 0, curves = 0, subpaths = 0, cur = null; const anchors = [], all = [], hlines = [], arcs = [];
  pth.walk({
    moveTo(x, y) { subpaths++; cur = [x, y]; anchors.push(cur); all.push(cur); },
    lineTo(x, y) { lines++; if (cur && Math.abs(y - cur[1]) < 0.01) hlines.push(Math.abs(x - cur[0])); cur = [x, y]; anchors.push(cur); all.push(cur); },
    curveTo(x1, y1, x2, y2, x3, y3) { curves++; if (cur) arcs.push([cur, [x3, y3]]); all.push([x1, y1], [x2, y2]); cur = [x3, y3]; anchors.push(cur); all.push(cur); },
    closePath() {},
  });
  if (!all.length) return null;
  const [a, b, c, d, e, f] = ctm; const T = ([x, y]) => [a * x + c * y + e, b * x + d * y + f];
  const tp = all.map(T); const xs = tp.map((p) => p[0]), ys = tp.map((p) => p[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
  const out = { bounds, w, h, kind: null, radius: 0 };
  if (w <= 0 || h <= 0 || subpaths !== 1) return out;
  const rotated = Math.abs(b) > 1e-3 * Math.abs(a) + 1e-6 || Math.abs(c) > 1e-3 * Math.abs(d) + 1e-6;
  if (rotated) return out;
  const sc = Math.sqrt(Math.abs(a * d - b * c)) || 1;
  const poly = anchors.map(T); let area2 = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area2 += p[0] * q[1] - q[0] * p[1]; }
  const ratio = Math.abs(area2) / 2 / (w * h);
  // A straight-sided shape is only a rect when every corner sits on the bounding box: a clapperboard with a slanted top
  // edge fills 95% of its box but is not one, and drawing it as a CSS rect would cover what the slant leaves visible.
  const tol = Math.max(1, 0.01 * Math.min(w, h)); const near = (v, t) => Math.abs(v - t) <= tol;
  const onCorners = poly.every(([x, y]) => (near(x, bounds[0]) || near(x, bounds[2])) && (near(y, bounds[1]) || near(y, bounds[3])));
  if (curves === 0 && lines <= 5 && ratio > 0.9 && onCorners) out.kind = 'rect';
  // A rounded rectangle only curves at its corners: every curve is short (at most half the short side) and its ends sit on
  // the bounding box. A panel with one long sweeping side also fills most of its box, but drawing it as a CSS rectangle
  // would square that side off and cover what the curve leaves visible.
  const half = Math.min(w, h) / 2 * 1.08 + tol; const onBox = ([px, py]) => near(px, bounds[0]) || near(px, bounds[2]) || near(py, bounds[1]) || near(py, bounds[3]);
  const cornersOnly = arcs.every(([p, q]) => { const a = T(p), b2 = T(q); return Math.abs(a[0] - b2[0]) <= half && Math.abs(a[1] - b2[1]) <= half && onBox(a) && onBox(b2); });
  if (out.kind) { /* already a plain rectangle */ } else if (curves > 0 && curves <= 8 && lines <= 8 && ratio > 0.62 && cornersOnly) { out.kind = 'rect'; const span = hlines.length ? Math.max(...hlines) * sc : 0; out.radius = Math.min(span ? Math.max(0, (w - span) / 2) : Math.min(w, h) / 2, Math.min(w, h) / 2); }
  else if (curves === 4 && lines <= 4 && ratio > 0.4 && ratio <= 0.62) { out.kind = 'ellipse'; out.radius = Math.min(w, h) / 2; }
  return out;
}

/**
 * Extract a scene bundle from a PDF-compatible .ai (or any PDF).
 * @returns {Promise<{scene:object, stats:object, needsVision:boolean}>}
 */
export async function extract(src, out, { scale = null, previewMax = 1400, name = null } = {}) {
  await mkdir(path.join(out, 'assets'), { recursive: true });
  const buf = await readFile(src);
  let doc;
  try { doc = mupdf.Document.openDocument(buf, 'application/pdf'); }
  catch (e) { throw new ExtractError('Not a PDF-compatible .ai (saved without "Create PDF Compatible File"?): ' + e.message); }
  if (doc.needsPassword()) throw new ExtractError('File is password protected');

  const warnings = [];
  // Font programs embedded in the file: kept as partial fonts so existing copy renders in the real face.
  try { const got = await keepEmbeddedFonts(doc); if (got.length) warnings.push(`kept ${got.length} font${got.length > 1 ? 's' : ''} from the file (partial): ${got.join(', ')}`); } catch (e) { warnings.push('embedded fonts not read: ' + e.message); }
  const layers = []; try { const n = doc.countLayers?.() ?? 0; for (let i = 0; i < n; i++) layers.push(doc.getLayerName(i)); } catch {}
  const fonts = new Map(), elements = [], artboards = [];
  let id = 0; const nid = (p) => `el_${p}_${String(++id).padStart(3, '0')}`;
  const stats = { pages: 0, textRuns: 0, images: 0, imagesPromoted: 0, paths: 0, glyphPaths: 0, shapesPromoted: 0, garbledRuns: 0, trackedRuns: 0 };
  const unreadable = (u) => u === 0xFFFD || u <= 0 || (u >= 0xE000 && u <= 0xF8FF);
  // The glyphs of a text object that carry no readable character (custom-encoded wordmarks) as a new Text, or null.
  const garbledPart = (text) => { let out = null; try { text.walk({ showGlyph(font, trm, gid, ucs, wmode) { if (unreadable(ucs)) { out = out || new mupdf.Text(); out.showGlyph(font, trm, gid, ucs, wmode || 0); } } }); } catch { return null; } return out; };
  const pages = Math.min(doc.countPages(), 8);
  if (doc.countPages() > pages) warnings.push(`file has ${doc.countPages()} artboards; only the first ${pages} were read`);
  let previewScale = 1;

  for (let p = 0; p < pages; p++) {
    const page = doc.loadPage(p);
    const pb = page.getBounds(); const [bx0, by0, bx1, by1] = pb;
    const W = r1(bx1 - bx0), H = r1(by1 - by0), A = W * H;
    // Artwork rasters: small (print-size) artboards get a higher scale so a 4× A4 page prints at ~288 dpi; big social
    // artboards stay at 2×. Long side is capped near 4000 px to keep memory sane.
    if (scale == null) scale = [4, 3, 2, 1.5, 1].find((s) => W * s * H * s <= 24e6) || 1; // ≤ 24 MP per layer (~96 MB)
    artboards.push({ id: p, name: `Artboard ${p + 1}`, x: 0, y: 0, width: W, height: H, reference: `reference-${p}.png`, artwork: `artwork-${p}.png`, preview: `preview-${p}.png` });
    stats.pages++;
    const m = mupdf.Matrix.scale(scale, scale);
    const toPt = ([x0, y0, x1, y1]) => [x0 / scale, y0 / scale, x1 / scale, y1 / scale];

    // 1. reference render (visual ground truth) + preview for the vision pass
    await writeFile(path.join(out, `reference-${p}.png`), page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false).asPNG());
    previewScale = Math.max(W, H) > previewMax ? previewMax / Math.max(W, H) : Math.max(W, H) < 500 ? 2 : 1;
    await writeFile(path.join(out, `preview-${p}.png`), page.toPixmap(mupdf.Matrix.scale(previewScale, previewScale), mupdf.ColorSpace.DeviceRGB, false).asPNG());

    // 2. artwork layer: run the page through a filtering device. Text is dropped (it becomes text elements); rectangle-like
    //    fills and unclipped images are promoted to their own elements and skipped here, everything else is rasterised.
    const pageEls = []; // shapes + images in draw order
    let artworkOk = false;
    try {
      const pageDev = mupdf.Rect.transform(pb, m);
      // Device state that must be replayed onto a fresh raster layer: clips and transparency groups, in nesting order.
      // Masks and tiles cannot be replayed, so no layer split happens while one is open.
      const stack = []; // {kind:'clip'|'group', bounds?, mask?, replay?:(draw)=>void}
      let tileDepth = 0;
      const clipOk = (bb) => stack.every((c) => c.kind !== 'clip' || (!c.mask && (!c.bounds || inside(bb, c.bounds, 1.5))));
      // Artwork rasters. Everything that is not promoted is drawn into transparent layers. A layer is anchored above
      // whatever had been promoted when its first drawing op arrives, and a new layer starts after each promotion, so
      // content the file draws later (a logo over a full-bleed photo) stays above that element instead of under it.
      const layers = []; let cur = null;
      const L = () => { if (cur) return cur; const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, pageDev, true); pix.clear(); const draw = new mupdf.DrawDevice(mupdf.Matrix.identity, pix); for (const c of stack) c.replay?.(draw); cur = { pix, draw, used: false, at: 0 }; layers.push(cur); return cur; };
      const D = () => { const l = L(); if (!l.used) { l.used = true; l.at = pageEls.length; } return l.draw; };
      // Leaving a layer: close its open clips/groups (they are replayed onto the next layer) so the device closes clean.
      const split = () => { if (!(cur && cur.used && layers.length < 8 && tileDepth === 0 && stack.every((c) => c.replay))) return; for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].kind === 'clip') cur.draw.popClip(); else cur.draw.endGroup(); } cur = null; };
      const popKind = (kind) => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === kind) return stack.splice(i, 1)[0]; return null; };
      const safe = (fn) => { try { return fn(); } catch { return null; } };
      const dev = new mupdf.Device({
        fillPath(pth, eo, ctm, cs, color, alpha) {
          stats.paths++;
          const info = safe(() => inspectPath(pth, ctm));
          if (info && info.w < 40 && info.h < 40) stats.glyphPaths++;
          if (info && info.kind && clipOk(info.bounds) && alpha >= 0.5 && inside(info.bounds, pageDev, 2)) {
            const area = info.w * info.h / (scale * scale);
            if (area > A * 0.002 && area < A * 0.6 && Math.min(info.w, info.h) / scale >= 12) {
              const n = safe(() => cs.getNumberOfComponents()) ?? color.length;
              const b = rect(toPt(info.bounds), bx0, by0);
              const shape = el({ id: nid('shp'), type: 'vector', name: info.kind === 'ellipse' ? 'Ellipse' : 'Shape', artboardId: p, bounds: b, fill: hex(toRGB(n, color)), opacity: r1(alpha), renderMode: 'css', meta: { kind: info.kind, cornerRadius: r1(info.radius / scale), promoted: true } });
              Object.defineProperty(shape, '_draw', { value: { pth, eo, ctm, cs, color, alpha, box: info.bounds }, enumerable: false });
              pageEls.push(shape);
              stats.shapesPromoted++;
              split(); return; // not baked into the artwork
            }
          }
          D().fillPath(pth, eo, ctm, cs, color, alpha);
        },
        fillImage(image, ctm, alpha) {
          stats.images++;
          const bb = unitRect(ctm);
          if (clipOk(bb) && alpha >= 0.5 && inside(bb, pageDev, 2) && (bb[2] - bb[0]) / scale >= 8 && (bb[3] - bb[1]) / scale >= 8) {
            const eid = nid('img'), asset = `assets/image-${eid}.png`;
            const png = safe(() => image.toPixmap().asPNG());
            if (png) {
              writeFile(path.join(out, asset), png).catch((e) => warnings.push(`image ${eid}: ${e.message}`));
              const [a, b, c, d] = ctm; const rot = r1(-Math.atan2(b, a) * 180 / Math.PI) || 0;
              pageEls.push(el({ id: eid, type: 'image', name: `Image ${stats.imagesPromoted + 1}`, artboardId: p, bounds: rect(toPt(bb), bx0, by0), transform: { rotation: Math.abs(rot) < 0.5 ? 0 : rot, scaleX: 1, scaleY: d < 0 ? -1 : 1 }, opacity: r1(alpha), asset, meta: { source: 'embedded', pixelWidth: image.getWidth(), pixelHeight: image.getHeight(), promoted: true } }));
              stats.imagesPromoted++;
              split(); return;
            }
          }
          D().fillImage(image, ctm, alpha);
        },
        strokePath(pth, ss, ctm, cs, color, alpha) { stats.paths++; D().strokePath(pth, ss, ctm, cs, color, alpha); },
        clipPath(pth, eo, ctm) { const info = safe(() => inspectPath(pth, ctm)); stack.push({ kind: 'clip', bounds: info?.kind === 'rect' ? info.bounds : (info ? info.bounds : null), mask: false, replay: (d) => d.clipPath(pth, eo, ctm) }); if (cur) cur.draw.clipPath(pth, eo, ctm); },
        clipStrokePath(pth, ss, ctm) { stack.push({ kind: 'clip', bounds: null, mask: false, replay: (d) => d.clipStrokePath(pth, ss, ctm) }); if (cur) cur.draw.clipStrokePath(pth, ss, ctm); },
        clipImageMask(img, ctm) { stack.push({ kind: 'clip', bounds: null, mask: true }); L().draw.clipImageMask(img, ctm); },
        clipText(t, ctm) { stack.push({ kind: 'clip', bounds: null, mask: true, replay: (d) => d.clipPath(new mupdf.Path(), false, ctm) }); if (cur) cur.draw.clipPath(new mupdf.Path(), false, ctm); },
        clipStrokeText(t, ss, ctm) { stack.push({ kind: 'clip', bounds: null, mask: true, replay: (d) => d.clipPath(new mupdf.Path(), false, ctm) }); if (cur) cur.draw.clipPath(new mupdf.Path(), false, ctm); },
        popClip() { popKind('clip'); if (cur) cur.draw.popClip(); },
        beginMask(a, l, cs, c) { stack.push({ kind: 'clip', bounds: null, mask: true }); L().draw.beginMask(a, l, cs, c); },
        endMask() { if (cur) cur.draw.endMask(); },
        // Text is dropped from the artwork (it becomes live text elements) unless its glyphs carry no readable
        // characters (custom-encoded wordmarks); those stay as pixels so the creative still looks right.
        fillText(text, ctm, cs, color, alpha) { const g = garbledPart(text); if (g) { stats.garbledRuns++; D().fillText(g, ctm, cs, color, alpha); } },
        strokeText(text, ss, ctm, cs, color, alpha) { const g = garbledPart(text); if (g) D().strokeText(g, ss, ctm, cs, color, alpha); },
        ignoreText() {},
        fillShade(sh, ctm, alpha) { D().fillShade(sh, ctm, alpha); },
        fillImageMask(img, ctm, cs, color, alpha) { D().fillImageMask(img, ctm, cs, color, alpha); },
        beginGroup(a, cs, iso, kn, bm, al) { stack.push({ kind: 'group', replay: (d) => d.beginGroup(a, cs, iso, kn, bm, al) }); if (cur) cur.draw.beginGroup(a, cs, iso, kn, bm, al); },
        endGroup() { popKind('group'); if (cur) cur.draw.endGroup(); },
        beginTile(a, v, xs, ys, ctm, idn, did) { tileDepth++; return L().draw.beginTile(a, v, xs, ys, ctm, idn, did); }, endTile() { tileDepth--; if (cur) cur.draw.endTile(); },
        beginLayer(n) { if (cur) cur.draw.beginLayer(n); }, endLayer() { if (cur) cur.draw.endLayer(); },
        close() { for (const l of layers) l.draw.close(); },
      });
      page.run(dev, m); dev.close();
      // A promoted shape that later drawing paints over (the white disc behind a logo mark, say) is part of a composite,
      // not something a marketer should move on its own: draw it back into the raster below and drop the element.
      const coverage = (l, box) => {
        const [x0, y0] = pageDev; const n = l.pix.getNumberOfComponents(), pw = l.pix.getWidth(), ph = l.pix.getHeight(), px = l.pix.getPixels();
        const bx0 = Math.max(0, Math.floor(box[0] - x0)), by0 = Math.max(0, Math.floor(box[1] - y0)), bx1 = Math.min(pw, Math.ceil(box[2] - x0)), by1 = Math.min(ph, Math.ceil(box[3] - y0));
        let hit = 0, all = 0; for (let y = by0; y < by1; y += 2) for (let x = bx0; x < bx1; x += 2) { all++; if (px[(y * pw + x) * n + n - 1] > 40) hit++; }
        return all ? hit / all : 0;
      };
      const demoted = new Set();
      pageEls.forEach((e, i) => {
        if (!e._draw) return;
        const above = layers.filter((l) => l.used && l.at > i); if (!above.length) return;
        const cov = Math.max(...above.map((l) => coverage(l, e._draw.box)));
        // small discs painted over are logo backgrounds; rectangles (buttons, panels) only go back when mostly covered
        const small = e.bounds.width * e.bounds.height < A * 0.01 && e.meta?.kind === 'ellipse';
        if (cov < (small ? 0.03 : 0.15)) return;
        const below = layers.filter((l) => l.at <= i).sort((a, b) => b.at - a.at)[0] || L();
        const dd = new mupdf.DrawDevice(mupdf.Matrix.identity, below.pix); dd.fillPath(e._draw.pth, e._draw.eo, e._draw.ctm, e._draw.cs, e._draw.color, e._draw.alpha); dd.close();
        below.used = true; demoted.add(i); stats.shapesPromoted--;
      });
      if (demoted.size) { for (const l of layers) l.at -= [...demoted].filter((i) => i < l.at).length; pageEls.splice(0, pageEls.length, ...pageEls.filter((e, i) => !demoted.has(i))); }
      // The bottom raster is always written (it may be empty); layers anchored after a promotion slot in above it.
      const used = layers.filter((l) => l.used).sort((a, b) => a.at - b.at);
      const bottom = used.find((l) => l.at === 0);
      if (bottom) await writeFile(path.join(out, `artwork-${p}.png`), bottom.pix.asPNG());
      else { const blank = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, pageDev, true); blank.clear(); await writeFile(path.join(out, `artwork-${p}.png`), blank.asPNG()); }
      let inserted = 0;
      for (const [k, l] of used.filter((l) => l !== bottom).entries()) {
        const asset = `artwork-${p}-${k + 1}.png`; await writeFile(path.join(out, asset), l.pix.asPNG());
        pageEls.splice(l.at + inserted++, 0, el({ id: `el_art_${p}_${k + 1}`, type: 'vector', name: 'Artwork', artboardId: p, bounds: { x: 0, y: 0, width: W, height: H }, asset, editable: false, locked: true, role: 'background', meta: { collapsedGroup: true, layer: k + 1 } }));
      }
      stats.artworkLayers = (bottom ? 1 : 0) + inserted;
      artworkOk = true;
    } catch (e) {
      warnings.push(`artwork layer fell back to the full reference render (${e.message})`);
      artboards[p].artwork = `reference-${p}.png`; pageEls.length = 0; stats.shapesPromoted = 0; stats.imagesPromoted = 0;
    }
    elements.push(el({ id: `el_art_${p}`, type: 'vector', name: 'Artwork', artboardId: p, bounds: { x: 0, y: 0, width: W, height: H }, asset: artboards[p].artwork, editable: false, locked: true, role: 'background', meta: { collapsedGroup: true, pathCount: stats.paths, layer: layers[0] || null } }));
    elements.push(...pageEls);

    // 3. live text runs via structured text (outlined text is invisible here → needsVision)
    const st = page.toStructuredText('preserve-whitespace,preserve-spans' + (artworkOk ? '' : ',preserve-images'));
    let line = null; let lines = [];
    st.walk({
      beginLine(bbox) { line = { bbox, chars: [] }; lines.push(line); },
      onChar(c, origin, font, size, quad, color) { if (line) line.chars.push({ c, size, font, color, x0: Math.min(quad[0], quad[4]), x1: Math.max(quad[2], quad[6]), q: quad }); },
      onImageBlock(bbox, transform, image) { // only used when the device path failed
        if (artworkOk) return; const eid = nid('img'); stats.images++; const asset = `assets/image-${eid}.png`;
        try { writeFile(path.join(out, asset), image.toPixmap().asPNG()); } catch (e) { warnings.push(`image ${eid}: ${e.message}`); }
        elements.push(el({ id: eid, type: 'image', name: `Image ${stats.images}`, artboardId: p, bounds: rect(bbox, bx0, by0), asset, meta: { source: 'embedded', pixelWidth: image.getWidth(), pixelHeight: image.getHeight() } }));
      },
    });
    // Letters set on a curve arrive as one line whose glyphs each point a different way; split such a line per glyph so
    // every letter keeps its own angle (one rotation for the whole run would straighten the arc).
    const angleOf = (q) => (q ? Math.atan2(q[3] - q[1], q[2] - q[0]) * 180 / Math.PI : 0);
    const curved = (ln) => { if (ln.chars.length < 2 || !ln.chars[0].q) return false; const a0 = angleOf(ln.chars[0].q); return ln.chars.some((k) => k.q && Math.abs(angleOf(k.q) - a0) > 3); };
    const quadBox = (q) => { const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]]; return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
    lines = lines.flatMap((ln) => (curved(ln) ? ln.chars.filter((k) => k.c.trim()).map((k) => ({ bbox: quadBox(k.q), chars: [k] })) : [ln]));
    for (const ln of lines) {
      let text = ln.chars.map((k) => k.c).join('').replace(/\s+$/, '');
      if (!text.trim()) continue;
      const glyphs = ln.chars.filter((k) => k.c.trim());
      // Measure glyph extents along the direction the line runs, not along the page's x axis: the upright sides of an
      // arch ("PLE…", "…OME" set at 90°) are tracked too, and left-to-right gaps would read as zero for them.
      { const qd = ln.chars[0]?.q; const ang = qd ? Math.atan2(qd[3] - qd[1], qd[2] - qd[0]) : 0;
        if (Math.abs(ang) > 0.009) { const dx = Math.cos(ang), dy = Math.sin(ang); for (const k of ln.chars) { if (!k.q) continue; const al = [0, 2, 4, 6].map((i) => k.q[i] * dx + k.q[i + 1] * dy); k.x0 = Math.min(...al); k.x1 = Math.max(...al); } } }
      if (glyphs.length && glyphs.filter((k) => unreadable(k.c.codePointAt(0))).length / glyphs.length >= 0.5) continue; // kept in the artwork raster
      const f = ln.chars[0].font, size = ln.chars[0].size;
      const name = f.getName?.() || 'Unknown';
      const ps = name.replace(/^[A-Z]{6}\+/, '');
      let { family, style } = parseFontName(ps, { bold: !!f.isBold?.(), italic: !!f.isItalic?.() });
      const onFile = fonts.get(ps)?.library ?? (await library.find({ postScriptName: ps }).catch(() => null));
      if (onFile) { family = onFile.family; style = onFile.style; }
      const legacy = onFile?.legacy ? { encoding: 'legacy', legacyScript: onFile.legacyScript } : null;
      fonts.set(ps, { family, style, postScriptName: ps, embedded: /^[A-Z]{6}\+/.test(name), library: onFile || null, onFile: !!onFile });
      // Letter-spaced text ("S E A S O N 2"): MuPDF inserts spaces between tracked glyphs. Rebuild the words from
      // the glyph positions and carry the tracking as letterSpacing so the creative renders the way it was set.
      let letterSpacing = 0;
      if (glyphs.length >= 3 && !text.includes('\n')) {
        const sorted = [...glyphs].sort((a, b) => a.x0 - b.x0);
        const gaps = sorted.slice(1).map((k, i) => k.x0 - sorted[i].x1).filter((g) => Number.isFinite(g));
        const med = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
        if (med > size * 0.12) {
          const wordGap = med + size * 0.15; let out = sorted[0].c;
          for (let i = 1; i < sorted.length; i++) out += (gaps[i - 1] > wordGap ? ' ' : '') + sorted[i].c;
          text = out; letterSpacing = r1(Math.max(0, med - size * 0.06)); stats.trackedRuns++;
        }
      }
      const col = ln.chars[0].color;
      const fill = Array.isArray(col) ? hex(toRGB(col.length, col)) : typeof col === 'number' ? '#' + (col & 0xffffff).toString(16).padStart(6, '0').toUpperCase() : '#000000';
      const mixed = ln.chars.some((k) => Math.abs(k.size - size) > 0.01 || k.font.getName?.() !== name);
      const eid = nid('txt'); stats.textRuns++;
      let b = rect(ln.bbox, bx0, by0);
      // Rotated text (a tilted tagline, letters on an arc): the quads carry the angle; keep an unrotated box + rotation.
      let rotation = 0; const q0 = ln.chars[0].q;
      if (q0) { const ang = Math.atan2(q0[3] - q0[1], q0[2] - q0[0]); const deg = ang * 180 / Math.PI;
        if (Math.abs(deg) > 0.5 && Math.abs(Math.abs(deg) - 180) > 0.5) {
          const dx = Math.cos(ang), dy = Math.sin(ang); let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
          for (const k of ln.chars) { const q = k.q; if (!q) continue; for (let i = 0; i < 8; i += 2) { const along = q[i] * dx + q[i + 1] * dy, across = -q[i] * dy + q[i + 1] * dx; a0 = Math.min(a0, along); a1 = Math.max(a1, along); c0 = Math.min(c0, across); c1 = Math.max(c1, across); } }
          const cx = b.x + b.width / 2, cy = b.y + b.height / 2; const len = r1(a1 - a0), hgt = r1(c1 - c0);
          b = { x: r1(cx - len / 2), y: r1(cy - hgt / 2), width: len, height: hgt }; rotation = r1(-deg); stats.rotatedRuns = (stats.rotatedRuns || 0) + 1;
        } }
      const cx = b.x + b.width / 2, align = Math.abs(cx - W / 2) < W * 0.03 ? 'center' : cx > W / 2 && b.x + b.width > W * 0.85 ? 'right' : 'left';
      elements.push(el({ id: eid, type: 'text', name: text.slice(0, 40), artboardId: p, bounds: b, fill, ...(rotation ? { transform: { rotation, scaleX: 1, scaleY: 1 } } : {}),
        text: { content: text, fontFamily: family, fontStyle: style, postScriptName: ps, fontSize: r1(size), lineHeight: null, letterSpacing, align, kind: 'point', mixed, ...(legacy ? { encoding: 'legacy' } : {}) }, ...(legacy ? { meta: { legacyFont: family, legacyScript: legacy.legacyScript } } : {}) }));
    }
  }
  mergeLetterRuns(elements, stats);
  elements.forEach((e, i) => (e.zIndex = i));

  // Outlined-text heuristic: no live text but lots of small filled paths → glyph outlines → vision pass reconstructs copy.
  const outlined = stats.textRuns === 0 && stats.glyphPaths > 20;
  if (outlined) warnings.push(`no live text found; ${stats.glyphPaths} glyph-sized paths suggest outlined text → needsVision`);
  if (stats.textRuns === 0 && !outlined) warnings.push('no text found in file');
  for (const f of fonts.values()) if (!f.embedded && !f.onFile) warnings.push(`font ${f.postScriptName} is not embedded; install it on the client for an exact match`);
  if (stats.garbledRuns) warnings.push(`${stats.garbledRuns} text run${stats.garbledRuns > 1 ? 's' : ''} had no readable characters (custom-encoded wordmark); kept as part of the artwork, not editable`);

  const ab = artboards[0];
  const scene = {
    version: '1.0', generator: 'mupdf ingest 1.1',
    source: { file: path.resolve(src), colorSpace: 'RGB', units: 'pt', exportedAt: new Date().toISOString(), layers, parser: 'mupdf' },
    document: { name: name || path.basename(src, path.extname(src)), width: ab.width, height: ab.height, activeArtboard: 0, artboards },
    fonts: [...fonts.values()].map(({ library: _l, ...f }) => f), elements, warnings,
    ingest: { referenceScale: scale, previewScale, preview: 'preview-0.png', needsVision: outlined, stats },
  };
  await writeFile(path.join(out, 'scene.json'), JSON.stringify(scene, null, 2));
  await writeFile(path.join(out, 'extract.json'), JSON.stringify({ stats, layers, fonts: [...fonts.values()].map(({ library: _l, ...f }) => f), needsVision: outlined, warnings }, null, 2));
  return { scene, stats, needsVision: outlined };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , SRC, OUT] = process.argv;
  if (!SRC || !OUT) { console.error('usage: pdf-extract <file.ai> <outdir> [--scale 2]'); process.exit(2); }
  const i = process.argv.indexOf('--scale');
  try {
    const { scene, stats, needsVision } = await extract(SRC, OUT, { scale: i > 0 ? +process.argv[i + 1] : null });
    console.log(`EXTRACT_OK ${scene.elements.length} elements (${stats.textRuns} text, ${stats.imagesPromoted}/${stats.images} images, ${stats.shapesPromoted} shapes, ${stats.paths} paths) needsVision=${needsVision}`);
  } catch (e) { console.error((e.code || 'EXTRACT_FAIL') + ' ' + e.message); process.exit(3); }
}
