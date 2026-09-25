// Rendering helpers shared by the stage (DOM), the canvas exporter (PNG/PDF) and the SVG exporter.
import { paragraphs, markers, listIndent, segText } from './rich.js';
export const hex = (c) => {
  if (!c) return '#000000';
  if (c[0] === '#') return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c.slice(0, 7);
  const m = c.match(/\d+/g); return m ? '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('') : '#000000';
};
export const weightOf = (s) => { s = (s || '').toLowerCase(); if (/thin|hairline/.test(s)) return 100; if (/extralight|ultralight/.test(s)) return 200; if (/light/.test(s)) return 300; if (/medium/.test(s)) return 500; if (/semibold|demibold/.test(s)) return 600; if (/extrabold|ultrabold/.test(s)) return 800; if (/black|heavy/.test(s)) return 900; if (/bold/.test(s)) return 700; return 400; };
export const isItalic = (s) => /italic|oblique/i.test(s || '');
// Script fonts (Noto Sans Malayalam…) are appended once loaded, so glyphs the brand font lacks still come out right.
export const extraFallbacks = [];
const fallbackStack = () => [...extraFallbacks.map((f) => `"${f}"`), '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'].join(', ');
export const fontFamilyCss = (fam) => (fam ? `"${fam}", ${fallbackStack()}` : fallbackStack());
/** Multi-page files: an element belongs to one artboard; painters and the stage only show the active one. */
export const pageOf = (scene) => scene.document?.activeArtboard ?? 0;
export const onPage = (scene, e) => (e.artboardId ?? 0) === pageOf(scene);
export const lineHeightOf = (t) => t.lineHeight || t.fontSize * 1.2;
// Rebuilt (vision) text hides the outlined original behind a flat cover; pad it so glyph edges never peek out.
export const coverPad = (t) => Math.max(4, Math.round((t?.fontSize || 16) * 0.12));
export const fontString = (t) => `${isItalic(t.fontStyle) ? 'italic ' : ''}${weightOf(t.fontStyle)} ${t.fontSize}px ${fontFamilyCss(t.fontFamily)}`;
export const assetUrl = (e, assets) => (e.assetSvg && assets[e.assetSvg]) || (e.asset && assets[e.asset]) || null;
export const isCssShape = (e) => e.type !== 'text' && (e.renderMode === 'css' || (!e.asset && !e.assetSvg));

export function wrapLines(ctx, text, maxWidth) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((p) => {
    if (!isFinite(maxWidth)) { out.push(p); return; }
    let line = '';
    p.split(' ').forEach((word) => { const t = line ? line + ' ' + word : word; if (ctx.measureText(t).width > maxWidth && line) { out.push(line); line = word; } else line = t; });
    out.push(line);
  });
  return out;
}

const imgCache = new Map();
export function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((res, rej) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => res(img); img.onerror = () => rej(new Error('image failed: ' + url)); img.src = url; });
  imgCache.set(url, p); p.catch(() => imgCache.delete(url));
  return p;
}
export const toDataUrl = async (url) => { if (!url || url.startsWith('data:')) return url; const b = await (await fetch(url)).blob(); return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); };

function shapePath(ctx, e) {
  const { x, y, width: w, height: h } = e.bounds; ctx.beginPath();
  if (e.meta?.kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else { const r = Math.min(e.meta?.cornerRadius || 0, w / 2, h / 2); if (r > 0) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
}
export function baselineY(t, i) { const lh = lineHeightOf(t); return i * lh + lh / 2 + t.fontSize * 0.355; }
/** Wrapped lines for the painters. Each line: { i, x, width, parts: [{ text, x, width, seg }], marker: { text, x } | null }.
 *  A part is a stretch of one style; bold / italic words inside a sentence are their own parts, measured in their own font.
 *  List markers sit in a gutter (listIndent) so wrapped lines hang under the text, and numbers come from the paragraph count. */
export function layoutText(ctx, e) {
  const t = e.text, { x, width: w } = e.bounds; const point = t.kind === 'point'; const indent = listIndent(t); const room = Math.max(1, w - indent); const avail = point ? Infinity : room;
  const paras = paragraphs(t), marks = markers(t, paras); const lines = [];
  const setFont = (seg) => { ctx.font = fontString(segText(t, seg)); if ('letterSpacing' in ctx) ctx.letterSpacing = (t.letterSpacing || 0) + 'px'; };
  const measure = (text, seg) => { setFont(seg); return ctx.measureText(text).width; };
  paras.forEach((p, pi) => {
    // words: [{ pieces: [{ text, seg }], width, space }]   (a word can change style half-way: "un<b>believ</b>able")
    const words = []; let cur = null;
    for (const seg of p.segs) for (const tok of seg.text.split(/( +)/)) { if (!tok) continue; if (/^ +$/.test(tok)) { if (cur) { cur.gap = tok; cur.gapSeg = seg; } else words.push(cur = { pieces: [{ text: tok, seg }], lead: true }); cur = null; } else { if (!cur) words.push(cur = { pieces: [] }); cur.pieces.push({ text: tok, seg }); } }
    for (const wd of words) { wd.width = wd.pieces.reduce((n, pc) => n + measure(pc.text, pc.seg), 0); wd.gapWidth = wd.gap ? measure(wd.gap, wd.gapSeg) : 0; }
    const rows = [[]]; let used = 0;
    for (const wd of words) { const row = rows[rows.length - 1]; if (row.length && used + wd.width > avail) { rows.push([wd]); used = wd.width + wd.gapWidth; } else { row.push(wd); used += wd.width + wd.gapWidth; } }
    rows.forEach((row, ri) => {
      const lastRow = ri === rows.length - 1; const justify = t.align === 'justify' && !lastRow && !point && row.length > 1;
      const parts = []; row.forEach((wd, wi) => { const tail = wi < row.length - 1; wd.pieces.forEach((pc, k) => { const gap = tail && k === wd.pieces.length - 1 && !justify ? wd.gap || '' : ''; const prev = parts[parts.length - 1]; if (prev && prev.seg === pc.seg && !justify && !prev.closed) prev.text += pc.text + gap; else parts.push({ text: pc.text + gap, seg: pc.seg, word: wi }); if (gap && wd.gapSeg !== pc.seg) parts[parts.length - 1].closed = false; }); });
      parts.forEach((pt) => { pt.width = measure(pt.text, pt.seg); });
      const textW = parts.reduce((n, pt) => n + pt.width, 0); const lw = justify ? room : textW; const left = x + indent + (t.align === 'center' ? (room - lw) / 2 : t.align === 'right' ? room - lw : 0);
      const extra = justify ? (room - textW) / (row.length - 1) : 0; let at = left; let lastWord = 0;
      for (const pt of parts) { if (justify && pt.word !== lastWord) { at += extra; lastWord = pt.word; } pt.x = at; at += pt.width; }
      lines.push({ i: lines.length, x: left, width: lw, parts, text: parts.map((pt) => pt.text).join(''), marker: ri === 0 && marks[pi] ? { text: marks[pi], x } : null, simple: parts.length === 1 && !justify && !indent });
    });
  });
  setFont(null); return lines;
}
/** Underline / strikethrough bars for a line, in scene px: [{x, y, w, h}]. */
export function decorationBars(t, line, top) {
  const bars = []; const fs = t.fontSize, by = top + baselineY(t, line.i), th = Math.max(1, fs * 0.06);
  for (const pt of line.parts) { const wd = pt.width - (/ +$/.test(pt.text) && pt === line.parts[line.parts.length - 1] ? 0 : 0); if (pt.seg?.underline) bars.push({ x: pt.x, y: by + fs * 0.1, w: wd, h: th }); if (pt.seg?.strike) bars.push({ x: pt.x, y: by - fs * 0.3, w: wd, h: th }); }
  return bars;
}
export function drawText(ctx, e) {
  const t = e.text, { x, y, width: w, height: h } = e.bounds;
  if (e.meta?.coverFill) { const p = coverPad(t); ctx.fillStyle = e.meta.coverFill; ctx.fillRect(x - p, y - p, w + 2 * p, h + 2 * p); }
  const lines = layoutText(ctx, e); ctx.fillStyle = e.fill || '#000'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  for (const line of lines) {
    const by = y + baselineY(t, line.i);
    if (line.marker) { ctx.font = fontString(t); ctx.fillText(line.marker.text, line.marker.x, by); }
    for (const pt of line.parts) { ctx.font = fontString(segText(t, pt.seg)); if ('letterSpacing' in ctx) ctx.letterSpacing = (t.letterSpacing || 0) + 'px'; ctx.fillText(pt.text, pt.x, by); }
    decorationBars(t, line, y).forEach((b) => ctx.fillRect(b.x, b.y, b.w, b.h));
  }
}

/** Rasterise a scene (not the DOM) to a canvas. Fonts must already be loaded in the document. */
export async function renderToCanvas(scene, assets, scale = 2) {
  const W = scene.document.width, H = scene.document.height;
  const c = document.createElement('canvas'); c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const els = scene.elements.filter((e) => e.type !== 'group' && e.visible && onPage(scene, e)).sort((a, b) => a.zIndex - b.zIndex);
  for (const e of els) {
    const { x, y, width: w, height: h } = e.bounds; ctx.save(); ctx.globalAlpha = e.opacity ?? 1;
    if (e.transform?.rotation) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-e.transform.rotation * Math.PI / 180); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    if (e.type === 'text') drawText(ctx, e);
    else if (isCssShape(e)) { if (e.fill) { ctx.fillStyle = e.fill; shapePath(ctx, e); ctx.fill(); } }
    else { const url = assetUrl(e, assets); try { const img = await loadImage(url); if (e.transform?.scaleY === -1) { ctx.translate(0, y * 2 + h); ctx.scale(1, -1); } const cr = e.meta?.crop; if (cr) ctx.drawImage(img, cr.x * img.naturalWidth, cr.y * img.naturalHeight, cr.w * img.naturalWidth, cr.h * img.naturalHeight, x, y, w, h); else ctx.drawImage(img, x, y, w, h); } catch { ctx.fillStyle = '#e6e4de'; ctx.fillRect(x, y, w, h); } }
    ctx.restore();
  }
  return c;
}

/** Serialise a scene to SVG. `imgData` maps asset urls to data: URIs (see toDataUrl) so the file is self-contained. */
export function toSvg(scene, assets, imgData = {}) {
  const W = scene.document.width, H = scene.document.height;
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const measure = document.createElement('canvas').getContext('2d');
  const parts = scene.elements.filter((e) => e.type !== 'group' && e.visible && onPage(scene, e)).sort((a, b) => a.zIndex - b.zIndex).map((e) => {
    const { x, y, width: w, height: h } = e.bounds;
    const rot = e.transform?.rotation ? ` transform="rotate(${-e.transform.rotation} ${x + w / 2} ${y + h / 2})"` : '', op = e.opacity !== 1 ? ` opacity="${e.opacity}"` : '';
    if (e.type !== 'text') {
      if (isCssShape(e)) { if (!e.fill) return ''; return e.meta?.kind === 'ellipse' ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${e.fill}"${rot}${op}/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(e.meta?.cornerRadius || 0, w / 2, h / 2)}" fill="${e.fill}"${rot}${op}/>`; }
      const u = assetUrl(e, assets); const cr = e.meta?.crop;
      if (cr) { const fw = w / cr.w, fh = h / cr.h, cid = 'crop_' + e.id.replace(/[^\w-]/g, ''); return `<g${rot}${op}><clipPath id="${cid}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><image href="${esc(imgData[u] || u)}" x="${x - cr.x * fw}" y="${y - cr.y * fh}" width="${fw}" height="${fh}" preserveAspectRatio="none" clip-path="url(#${cid})"/></g>`; }
      return `<image href="${esc(imgData[u] || u)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"${rot}${op}/>`;
    }
    const t = e.text;
    const cp = coverPad(t); const cover = e.meta?.coverFill ? `<rect x="${x - cp}" y="${y - cp}" width="${w + 2 * cp}" height="${h + 2 * cp}" fill="${e.meta.coverFill}"${rot}/>` : '';
    const attrs = (tt) => `font-family="${esc(tt.fontFamily || 'Helvetica')}, sans-serif" font-size="${tt.fontSize}" font-weight="${weightOf(tt.fontStyle)}" font-style="${isItalic(tt.fontStyle) ? 'italic' : 'normal'}" letter-spacing="${tt.letterSpacing || 0}" fill="${e.fill || '#000'}"${rot}${op} xml:space="preserve"`;
    return cover + layoutText(measure, e).map((line) => { const by = y + baselineY(t, line.i);
      const mark = line.marker ? `<text x="${line.marker.x}" y="${by}" ${attrs(t)}>${esc(line.marker.text)}</text>` : '';
      const glyphs = line.parts.map((pt) => `<text x="${pt.x}" y="${by}" ${attrs(segText(t, pt.seg))}>${esc(pt.text)}</text>`).join('');
      return mark + glyphs + decorationBars(t, line, y).map((bar) => `<rect x="${bar.x}" y="${bar.y}" width="${bar.w}" height="${bar.h}" fill="${e.fill || '#000'}"${rot}${op}/>`).join(''); }).join('');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`;
}

export function download(name, href) { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
