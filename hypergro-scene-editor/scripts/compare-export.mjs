#!/usr/bin/env node
// Fidelity audit: compare an original .ai (PDF-compatible) with the editor's exported PDF/.ai of the same creative.
//   node scripts/compare-export.mjs <original.ai> <export.pdf> [outdir]
// Reports page size, text runs (content, font, size, fill), images (count, pixel size, effective dpi at print size),
// and a pixel difference between both pages rendered at 150 dpi. Writes side-by-side crops at 300 dpi to outdir.
import * as mupdf from 'mupdf';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [,, ORIG, EXP, OUT = 'data/dev/compare'] = process.argv;
if (!ORIG || !EXP) { console.error('usage: compare-export <original.ai> <export.pdf> [outdir]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const open = (f) => mupdf.Document.openDocument(readFileSync(f), 'application/pdf');
const A = open(ORIG), B = open(EXP); const pa = A.loadPage(0), pb = B.loadPage(0);
const size = (p) => { const [x0, y0, x1, y1] = p.getBounds(); return [Math.round((x1 - x0) * 100) / 100, Math.round((y1 - y0) * 100) / 100]; };
console.log('page size  original', size(pa), ' export', size(pb));

// ---- text runs
function textRuns(page) {
  const st = page.toStructuredText('preserve-whitespace'); const lines = [];
  let cur = null;
  st.walk({ beginLine() { cur = { chars: [], fonts: new Set(), sizes: new Set(), colors: new Set() }; lines.push(cur); }, onChar(c, o, font, size, quad, color) { if (!cur) return; cur.chars.push(c); cur.fonts.add((font.getName?.() || '?').replace(/^[A-Z]{6}\+/, '')); cur.sizes.add(Math.round(size * 10) / 10); if (Array.isArray(color)) cur.colors.add(color.map((v) => Math.round(v * 255)).join(',')); } });
  return lines.map((l) => ({ text: l.chars.join('').trim(), fonts: [...l.fonts], sizes: [...l.sizes], colors: [...l.colors] })).filter((l) => l.text);
}
const ta = textRuns(pa), tb = textRuns(pb);
console.log(`\ntext lines  original ${ta.length}  export ${tb.length}`);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const missing = ta.filter((l) => !tb.some((m) => norm(m.text) === norm(l.text)));
const extra = tb.filter((l) => !ta.some((m) => norm(m.text) === norm(l.text)));
for (const l of ta.slice(0, 30)) { const m = tb.find((x) => norm(x.text) === norm(l.text)); console.log(`  ${m ? 'ok ' : 'MISSING'} "${l.text.slice(0, 44)}"  font ${l.fonts.join('/')} ${l.sizes.join('/')}pt` + (m ? `  →  ${m.fonts.join('/')} ${m.sizes.join('/')}pt${m.fonts.join() !== l.fonts.join() ? '  (font differs)' : ''}${m.sizes.join() !== l.sizes.join() ? '  (size differs)' : ''}${m.colors.join() !== l.colors.join() ? `  (colour ${l.colors.join('|')} → ${m.colors.join('|')})` : ''}` : '')); }
if (extra.length) console.log('  extra in export:', extra.slice(0, 8).map((l) => `"${l.text.slice(0, 40)}"`).join(', '));

// ---- fonts embedded
const fontsOf = (doc) => { const names = new Set(); const n = doc.countPages(); for (let i = 0; i < n; i++) { const st = doc.loadPage(i).toStructuredText(); st.walk({ onChar(c, o, font) { names.add((font.getName?.() || '?').replace(/^[A-Z]{6}\+/, '')); } }); } return [...names]; };
console.log('\nfonts used  original', fontsOf(A).join(', '), '\n            export  ', fontsOf(B).join(', '));

// ---- images: count and pixel size, effective dpi at the size they are placed
function images(page, W) {
  const out = []; const pw = W;
  const dev = new mupdf.Device({ fillImage(image, ctm, alpha) { const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]); out.push({ px: [image.getWidth(), image.getHeight()], placed: [Math.round(w), Math.round(h)], dpi: Math.round(image.getWidth() / (w / 72)) }); },
    fillPath() {}, strokePath() {}, clipPath() {}, clipStrokePath() {}, clipImageMask() {}, clipText() {}, clipStrokeText() {}, popClip() {}, beginMask() {}, endMask() {}, fillText() {}, strokeText() {}, ignoreText() {}, fillShade() {}, fillImageMask() {}, beginGroup() {}, endGroup() {}, beginTile() { return 0; }, endTile() {}, beginLayer() {}, endLayer() {}, close() {} });
  page.run(dev, mupdf.Matrix.identity); dev.close(); return out;
}
const ia = images(pa), ib = images(pb);
console.log(`\nimages  original ${ia.length}: ` + ia.map((i) => `${i.px.join('×')}px @ ${i.dpi}dpi`).join(', '));
console.log(`images  export   ${ib.length}: ` + ib.map((i) => `${i.px.join('×')}px @ ${i.dpi}dpi`).join(', '));

// ---- pixel difference at 150 dpi + crops at 300 dpi
const render = (page, dpi) => page.toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false);
const ra = render(pa, 150), rb = render(pb, 150);
if (ra.getWidth() === rb.getWidth() && ra.getHeight() === rb.getHeight()) {
  const A1 = ra.getPixels(), B1 = rb.getPixels(); const n = ra.getNumberOfComponents(); let sum = 0, cnt = 0, big = 0;
  for (let i = 0; i < A1.length; i += n) { const d = (Math.abs(A1[i] - B1[i]) + Math.abs(A1[i + 1] - B1[i + 1]) + Math.abs(A1[i + 2] - B1[i + 2])) / 3; sum += d; cnt++; if (d > 40) big++; }
  console.log(`\npixel diff @150dpi  mean ${(sum / cnt).toFixed(2)}/255   pixels off by >40: ${(100 * big / cnt).toFixed(2)}%`);
} else console.log('\npixel diff skipped: render sizes differ', [ra.getWidth(), ra.getHeight()], [rb.getWidth(), rb.getHeight()]);
const crop = (page, dpi, box, name) => { const s = dpi / 72; const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false); const W = pix.getWidth(), H = pix.getHeight(); const [fx, fy, fw, fh] = box; const x0 = Math.round(fx * W), y0 = Math.round(fy * H), w = Math.round(fw * W), h = Math.round(fh * H); const sub = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false); const src = pix.getPixels(), dst = sub.getPixels(), n = pix.getNumberOfComponents(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y0 + y) * W + x0 + x) * n, o = (y * w + x) * 3; dst[o] = src[i]; dst[o + 1] = src[i + 1]; dst[o + 2] = src[i + 2]; } writeFileSync(path.join(OUT, name), sub.asPNG()); };
const base = path.basename(EXP).replace(/\.[^.]+$/, '');
crop(pa, 300, [0, 0, 0.32, 0.22], `${base}-orig-topleft.png`); crop(pb, 300, [0, 0, 0.32, 0.22], `${base}-export-topleft.png`);
crop(pa, 300, [0.02, 0.35, 0.45, 0.25], `${base}-orig-text.png`); crop(pb, 300, [0.02, 0.35, 0.45, 0.25], `${base}-export-text.png`);
console.log(`\ncrops @300dpi written to ${OUT}/${base}-*.png`);
