// Outlined text is rebuilt from a vision read, whose sizes and positions vary from run to run. This step makes it exact and
// repeatable: it measures where the ink really is in the original render, then sizes each line with the real font file so
// its width matches that ink, places the baseline on it, and samples the true colour behind the words for the cover patch.
import * as mupdf from 'mupdf';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { library } from './fontlib.mjs';

const WEIGHT = (s) => { s = (s || '').toLowerCase(); return /thin/.test(s) ? 100 : /extralight/.test(s) ? 200 : /light/.test(s) ? 300 : /medium/.test(s) ? 500 : /semibold|demibold/.test(s) ? 600 : /extrabold/.test(s) ? 800 : /black|heavy/.test(s) ? 900 : /bold/.test(s) ? 700 : 400; };
async function fontFile(fontsDir, family, weight, italic) {
  try { const hit = await library.find({ family, weight, italic }); if (hit && !hit.subset) return await readFile(library.pathOf(hit)); } catch { /* fall through to Google */ }
  const cached = path.join(fontsDir, `${family.replace(/[^\w-]+/g, '_')}-${weight}${italic ? 'i' : ''}.ttf`); if (existsSync(cached)) return readFile(cached);
  try { const css = await (await fetch(`https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:${weight}${italic ? 'i' : ''}&subset=latin,latin-ext`, { headers: { 'User-Agent': 'curl/8' }, signal: AbortSignal.timeout(15000) })).text();
    const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1]; if (!url) return null; const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(30000) })).arrayBuffer()); await writeFile(cached, buf); return buf; } catch { return null; }
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

export async function fitOverlaysToInk(scene, outDir, fontsDir) {
  const els = scene.elements.filter((e) => e.type === 'text' && e.meta?.overlay); if (!els.length) return { scene, fitted: 0 };
  const ab = scene.document.activeArtboard ?? 0; const ref = scene.document.artboards?.[ab]?.reference || 'reference-0.png'; let pix;
  try { pix = new mupdf.Image(await readFile(path.join(outDir, ref))).toPixmap(); } catch { return { scene, fitted: 0 }; }
  const PW = pix.getWidth(), PH = pix.getHeight(), n = pix.getNumberOfComponents(), px = pix.getPixels(); const s = PW / scene.document.width; let fitted = 0; const notes = [];
  const out = scene.elements.map((e) => {
    if (!els.includes(e)) return e; const t = e.text; const lines = String(t.content).split('\n'); const N = lines.length; const fs0 = t.fontSize; const pad = fs0 * 0.45;
    const X0 = Math.max(0, Math.floor((e.bounds.x - pad) * s)), Y0 = Math.max(0, Math.floor((e.bounds.y - pad) * s)), X1 = Math.min(PW, Math.ceil((e.bounds.x + e.bounds.width + pad * 2) * s)), Y1 = Math.min(PH, Math.ceil((e.bounds.y + e.bounds.height + pad) * s)); if (X1 - X0 < 8 || Y1 - Y0 < 8) return e;
    // colour behind the words: the most common colour on the border of the region
    const buckets = new Map(); const tally = (x, y) => { const i = (y * PW + x) * n; const k = (px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | (px[i + 2] >> 3); const b = buckets.get(k) || [0, 0, 0, 0]; b[0]++; b[1] += px[i]; b[2] += px[i + 1]; b[3] += px[i + 2]; buckets.set(k, b); };
    for (let x = X0; x < X1; x += 2) { tally(x, Y0); tally(x, Y1 - 1); } for (let y = Y0; y < Y1; y += 2) { tally(X0, y); tally(X1 - 1, y); }
    const top = [...buckets.values()].sort((a, b) => b[0] - a[0])[0]; const total = [...buckets.values()].reduce((m, b) => m + b[0], 0); const flat = top[0] / total > 0.6; const bg = [top[1] / top[0], top[2] / top[0], top[3] / top[0]];
    if (!flat) return e; // words on a photo: nothing reliable to measure against
    const isInk = (x, y) => { const i = (y * PW + x) * n; return Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) > 60; };
    // rows of ink -> bands (text lines)
    const rows = []; for (let y = Y0; y < Y1; y++) { let c = 0, a = -1, z = -1; for (let x = X0; x < X1; x++) if (isInk(x, y)) { c++; if (a < 0) a = x; z = x; } rows.push({ y, c, a, z }); }
    const bands = []; let cur = null; const gapMax = Math.max(1, Math.round(fs0 * 0.06 * s));
    for (const r of rows) { if (r.c > 0) { if (cur && r.y - cur.y1 <= gapMax) { cur.y1 = r.y; cur.x0 = Math.min(cur.x0, r.a); cur.x1 = Math.max(cur.x1, r.z); } else { cur = { y0: r.y, y1: r.y, x0: r.a, x1: r.z }; bands.push(cur); } } }
    const real = bands.filter((b) => b.y1 - b.y0 >= fs0 * 0.25 * s); // dots and rules are not lines of text
    const cy = (b) => (b.y0 + b.y1) / 2 / s; const inside = real.filter((b) => cy(b) >= e.bounds.y - fs0 * 0.3 && cy(b) <= e.bounds.y + e.bounds.height + fs0 * 0.3);
    // Tight leading: descenders of one line touch the ascenders of the next, so the ink reads as one tall band. Cut it at the
    // thinnest row near each expected line boundary.
    if (inside.length < N && inside.length >= 1) {
      const a = inside[0].y0, z = inside[inside.length - 1].y1, span = z - a + 1, each = span / N; const count = (y) => rows[y - Y0]?.c ?? 0; const cuts = [];
      for (let k = 1; k < N; k++) { const mid = a + each * k; let best = Math.round(mid), bc = Infinity; for (let y = Math.round(mid - each * 0.3); y <= Math.round(mid + each * 0.3); y++) { const c = count(y) + count(y + 1) + count(y - 1); if (c < bc) { bc = c; best = y; } } cuts.push(best); }
      const edges = [a, ...cuts, z + 1]; const split = [];
      for (let k = 0; k < N; k++) { let x0 = Infinity, x1 = -1, y0 = null, y1 = null; for (let y = edges[k]; y < edges[k + 1]; y++) { const r = rows[y - Y0]; if (!r || !r.c) continue; if (y0 == null) y0 = y; y1 = y; x0 = Math.min(x0, r.a); x1 = Math.max(x1, r.z); } if (y0 != null) split.push({ y0, y1, x0, x1, cut: true }); }
      if (split.length === N) { inside.length = 0; inside.push(...split); inside.pitch = cuts.length > 1 ? (cuts[cuts.length - 1] - cuts[0]) / (cuts.length - 1) / s : null; }
    }
    if (inside.length !== N) { notes.push(`${e.name}: found ${inside.length} lines of ink for ${N} lines of words, kept the vision estimate`); return { ...e, meta: { ...e.meta, coverFill: hex(...bg) } }; }
    return { e, lines, bands: inside, bg };
  });
  // second pass needs fonts (async)
  const done = [];
  for (const item of out) {
    if (!item.bands) { done.push(item); continue; } const { e, lines, bands, bg } = item; const t = e.text; let fs = t.fontSize;
    const buf = t.fontFamily ? await fontFile(fontsDir, t.fontFamily, WEIGHT(t.fontStyle), /italic/i.test(t.fontStyle || '')) : null;
    if (buf) { try { const font = new mupdf.Font(t.fontFamily, buf); const em = (str) => [...str].reduce((m, ch) => m + font.advanceGlyph(font.encodeCharacter(ch.codePointAt(0)), 0), 0);
      const sizes = lines.map((ln, i) => { const w = em(ln.trim()); return w > 0.5 ? { size: ((bands[i].x1 - bands[i].x0 + 1) / s) / (w * 0.985), w } : null; }).filter(Boolean); if (sizes.length) fs = sizes.sort((a, b) => b.w - a.w)[0].size; /* the longest line is the most reliable ruler, and nothing can stick out past it */ } catch { /* keep the estimate */ } }
    const N = lines.length; const pitch = N > 1 ? bands.pitch || (bands[N - 1].y0 - bands[0].y0) / (N - 1) / s : null; const lh = pitch || fs * 1.2;
    const desc = /[gjpqy,;()]/.test(lines[0]); const asc = /[A-Zbdfhklt0-9]/.test(lines[0]); const firstTop = bands[0].y0 / s, firstBottom = (bands[0].y1 + 1) / s;
    const baseline = desc ? (asc ? firstTop + fs * 0.74 : firstBottom - fs * 0.23) : firstBottom; // cap/ascender height ≈ 0.74 em, descender ≈ 0.23 em
    const inkX0 = Math.min(...bands.map((b) => b.x0)) / s, inkX1 = (Math.max(...bands.map((b) => b.x1)) + 1) / s; const inkW = inkX1 - inkX0; const width = Math.round(inkW * 1.06 + 6);
    const x = t.align === 'center' ? (inkX0 + inkX1) / 2 - width / 2 : t.align === 'right' ? inkX1 - width : inkX0; const y = baseline - (lh / 2 + fs * 0.355);
    const r2 = (v) => Math.round(v * 100) / 100; fitted++;
    done.push({ ...e, bounds: { x: r2(x), y: r2(y), width, height: Math.round(N * lh) }, text: { ...t, fontSize: r2(fs), lineHeight: pitch ? r2(pitch) : null, kind: N > 1 ? 'area' : 'point' }, meta: { ...e.meta, coverFill: hex(...bg), coverStrategy: 'flat', fitted: true, inkFit: { x: r2(inkX0), y: r2(firstTop), width: r2(inkW), lines: N } } });
  }
  return { scene: { ...scene, elements: done, warnings: [...(scene.warnings || []).filter((w) => !/positions ±4px/.test(w)), ...(fitted ? [`rebuilt text: ${fitted} block${fitted > 1 ? 's' : ''} sized and placed from the original pixels`] : []), ...notes.map((m) => 'ink fit: ' + m)] }, fitted };
}
