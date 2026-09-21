// File exports rendered from the scene: JPG/PNG (canvas), SVG (vector), and vector PDF / .ai. The .ai file is a
// PDF-compatible document (which is what Illustrator itself writes): Illustrator opens it as editable vectors and
// live text. Brand fonts are embedded when the server's font proxy can supply TTFs; otherwise text falls back to
// Helvetica but stays editable.
import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { renderToCanvas, assetUrl, isCssShape, fontString, wrapLines, baselineY, weightOf, isItalic, coverPad, drawText } from './render.js';
import { textFit } from './issues.js';
import { scriptFontsFor, SCRIPT_FONTS } from './fonts.js';
import { libraryFonts } from './fontlib.js';
// Copy in an Indic (or Arabic) script is set in its Noto Sans face in the PDF, since the brand font has no such glyphs.
const pdfFamily = (t) => scriptFontsFor(t.content)[0] || t.fontFamily;
// jsPDF knows four styles per family (normal/bold/italic/bolditalic) and svg2pdf only treats weight 700 as bold, so every
// other weight is registered under its own alias ("Source Serif 4 600") and emitted as a normal-weight family.
const BUILTIN = { helvetica: 'helvetica', arial: 'helvetica', 'helvetica neue': 'helvetica', times: 'times', 'times new roman': 'times', courier: 'courier', 'courier new': 'courier' };
const weightOfText = (t) => weightOf(t.fontStyle);
const pdfAlias = (fam, weight) => (weight === 400 || weight === 700 ? fam : `${fam} ${weight}`);
export const pdfTextFont = (t, registered) => {
  const fam = pdfFamily(t) || 'Helvetica', weight = weightOfText(t), italic = isItalic(t.fontStyle) && !scriptFontsFor(t.content).length;
  const alias = pdfAlias(fam, weight);
  if (registered && registered.has(alias)) return { family: alias, weight: weight === 700 ? 'bold' : 'normal', italic };
  const builtin = BUILTIN[String(fam).toLowerCase()] || 'helvetica';
  return { family: builtin, weight: weight >= 600 ? 'bold' : 'normal', italic };
};

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const MAX_PDF_RASTER = 6000; // px on the long side; page-sized artwork layers are 2× the artboard and can be huge
/** Fetch every asset once: SVG assets as text (kept vector), rasters as data URIs. For the PDF path rasters are handed
 *  over as blob: URLs (svg2pdf's data-URI regex overflows the stack on multi-megabyte images) and downscaled. */
export async function collectAssets(scene, assets, { forPdf = false } = {}) {
  const out = {};
  for (const e of scene.elements) {
    const u = assetUrl(e, assets); if (!u || out[u] || isCssShape(e)) continue;
    try {
      const r = await fetch(u); const type = r.headers.get('content-type') || '';
      if (type.includes('svg') || /\.svg($|\?)/i.test(u)) out[u] = { kind: 'svg', text: await r.text() };
      else if (forPdf) { const b = await pdfRaster(await r.blob()); out[u] = { kind: 'raster', href: URL.createObjectURL(b) + '#image.png' }; }
      else { const b = await r.blob(); out[u] = { kind: 'raster', dataUrl: await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }) }; }
    } catch { /* missing asset → placeholder rect */ }
  }
  if (forPdf) out.__text = await rasteriseScriptText(scene);
  return out;
}
async function pdfRaster(blob) {
  const bmp = await createImageBitmap(blob); const k = Math.min(1, MAX_PDF_RASTER / Math.max(bmp.width, bmp.height));
  if (k === 1 && blob.type === 'image/png') { bmp.close(); return blob; }
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
export const releaseAssets = (collected) => { for (const a of Object.values(collected)) if (a && a.href) URL.revokeObjectURL(a.href.split('#')[0]); for (const a of Object.values(collected.__text || {})) if (a.href) URL.revokeObjectURL(a.href.split('#')[0]); };
const TEXT_RASTER_SCALE = 4; // 288 dpi at 1 px = 1 pt
/** Lines in Indic or Arabic scripts need shaping the PDF library cannot do, so the browser draws them and the PDF gets the picture. */
async function rasteriseScriptText(scene) {
  const out = {};
  for (const e of scene.elements) {
    if (e.type !== 'text' || !e.visible || !scriptFontsFor(e.text.content).length) continue;
    const fit = textFit(e); const pad = 6; const w = Math.max(e.bounds.width, fit.maxW) + pad * 2, h = Math.max(e.bounds.height, fit.h) + pad * 2;
    const c = document.createElement('canvas'); c.width = Math.ceil(w * TEXT_RASTER_SCALE); c.height = Math.ceil(h * TEXT_RASTER_SCALE);
    const ctx = c.getContext('2d'); ctx.scale(TEXT_RASTER_SCALE, TEXT_RASTER_SCALE); ctx.translate(pad - e.bounds.x, pad - e.bounds.y);
    drawText(ctx, { ...e, meta: { ...(e.meta || {}), coverFill: null } });
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    out[e.id] = { href: URL.createObjectURL(blob) + '#text.png', x: e.bounds.x - pad, y: e.bounds.y - pad, w, h };
  }
  return out;
}

let uid = 0;
// Inline an SVG asset as a nested <svg>, prefixing ids so gradients/clips from different assets cannot collide.
function inlineSvg(text, x, y, w, h) {
  const root = text.match(/<svg\b[^>]*>/i); if (!root) return '';
  const inner = text.slice(root.index + root[0].length, text.lastIndexOf('</svg>'));
  const vb = root[0].match(/viewBox="([^"]+)"/)?.[1] || `0 0 ${root[0].match(/width="([\d.]+)/)?.[1] || w} ${root[0].match(/height="([\d.]+)/)?.[1] || h}`;
  const p = `a${++uid}_`;
  const body = inner.replace(/id="([^"]+)"/g, `id="${p}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`).replace(/href="#([^"]+)"/g, `href="#${p}$1"`);
  return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${vb}" preserveAspectRatio="none">${body}</svg>`;
}

/** Vector SVG of the scene with assets embedded (SVG assets stay vector). */
export function buildSvg(scene, assets, collected, registered = null) {
  const W = scene.document.width, H = scene.document.height;
  const measure = document.createElement('canvas').getContext('2d');
  const parts = scene.elements.filter((e) => e.type !== 'group' && e.visible).sort((a, b) => a.zIndex - b.zIndex).map((e) => {
    const { x, y, width: w, height: h } = e.bounds;
    const rot = e.transform?.rotation ? ` transform="rotate(${-e.transform.rotation} ${x + w / 2} ${y + h / 2})"` : '', op = e.opacity !== 1 ? ` opacity="${e.opacity}"` : '';
    if (e.type !== 'text') {
      if (isCssShape(e)) { if (!e.fill) return ''; return e.meta?.kind === 'ellipse' ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${e.fill}"${rot}${op}/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(e.meta?.cornerRadius || 0, w / 2, h / 2)}" fill="${e.fill}"${rot}${op}/>`; }
      const u = assetUrl(e, assets); const a = u && collected[u];
      if (!a) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e6e4de"${rot}${op}/>`;
      const wrap = (inner) => (rot || op ? `<g${rot}${op}>${inner}</g>` : inner);
      if (a.kind === 'svg') return wrap(inlineSvg(a.text, x, y, w, h));
      return `<image href="${a.href || a.dataUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"${rot}${op}/>`;
    }
    const t = e.text; measure.font = fontString(t);
    const pic = collected.__text?.[e.id];
    if (pic) { const cp = coverPad(t); const cover = e.meta?.coverFill ? `<rect x="${x - cp}" y="${y - cp}" width="${w + 2 * cp}" height="${h + 2 * cp}" fill="${e.meta.coverFill}"${rot}/>` : ''; return cover + `<image href="${pic.href}" x="${pic.x}" y="${pic.y}" width="${pic.w}" height="${pic.h}" preserveAspectRatio="none"${rot}${op}/>`; }
    const lines = wrapLines(measure, t.content, t.kind === 'point' ? Infinity : w);
    const tx = t.align === 'center' ? x + w / 2 : t.align === 'right' ? x + w : x, anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
    const cp = coverPad(t); const cover = e.meta?.coverFill ? `<rect x="${x - cp}" y="${y - cp}" width="${w + 2 * cp}" height="${h + 2 * cp}" fill="${e.meta.coverFill}"${rot}/>` : '';
    const pf = registered ? pdfTextFont(t, registered) : { family: t.fontFamily || 'Helvetica', weight: weightOf(t.fontStyle), italic: isItalic(t.fontStyle) };
    return cover + lines.map((l, i) => `<text x="${tx}" y="${y + baselineY(t, i)}" font-family="${esc(pf.family)}" font-size="${t.fontSize}" font-weight="${pf.weight}" font-style="${pf.italic ? 'italic' : 'normal'}" letter-spacing="${t.letterSpacing || 0}" fill="${e.fill || '#000'}" text-anchor="${anchor}"${rot}${op} xml:space="preserve">${esc(l)}</text>`).join('');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${parts.join('')}</svg>`;
}

const b64 = (buf) => { let s = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
/** Register the TTFs the scene's text needs so svg2pdf can embed them. Missing fonts fall back to Helvetica. */
async function registerFonts(doc, scene) {
  const need = new Map();
  for (const e of scene.elements) if (e.type === 'text' && e.visible && e.text?.fontFamily) {
    const fam = pdfFamily(e.text), weight = weightOfText(e.text), italic = isItalic(e.text.fontStyle) && !scriptFontsFor(e.text.content).length;
    if (scriptFontsFor(e.text.content).length) continue; // Indic/Arabic lines go into the PDF as images (see rasteriseScriptText)
    need.set(`${fam}|${weight}|${italic ? 1 : 0}`, { fam, weight, italic, ps: fam === e.text.fontFamily ? e.text.postScriptName || '' : '', alias: pdfAlias(fam, weight), style: italic ? (weight === 700 ? 'bolditalic' : 'italic') : weight === 700 ? 'bold' : 'normal' });
  }
  const embedded = [], registered = new Set();
  for (const f of need.values()) {
    try {
      const r = await fetch(`/api/fonts/${encodeURIComponent(f.fam)}/${f.weight}?italic=${f.italic ? 1 : 0}&ps=${encodeURIComponent(f.ps)}`); if (!r.ok) continue;
      const name = `${f.alias.replace(/\s+/g, '')}-${f.weight}${f.italic ? 'i' : ''}.ttf`; doc.addFileToVFS(name, b64(await r.arrayBuffer())); doc.addFont(name, f.alias, f.style); registered.add(f.alias); embedded.push(`${f.fam} ${f.weight}${f.italic ? ' italic' : ''}`);
    } catch {}
  }
  return { embedded, registered };
}

/** Vector PDF (used for both the print PDF and the .ai file). */
export async function renderVectorPdf(scene, assets, onPhase = () => {}) {
  const W = scene.document.width, H = scene.document.height;
  onPhase('images'); const collected = await collectAssets(scene, assets, { forPdf: true });
  try {
    // 1 scene px = 1 pt, the same mapping the ingest uses, so a round trip keeps every size unchanged.
    const doc = new jsPDF({ orientation: W > H ? 'l' : 'p', unit: 'pt', format: [W, H], compress: true });
    onPhase('fonts'); const { embedded: fonts, registered } = await registerFonts(doc, scene);
    const svg = new DOMParser().parseFromString(buildSvg(scene, assets, collected, registered), 'image/svg+xml').documentElement;
    onPhase('writing'); await doc.svg(svg, { x: 0, y: 0, width: W, height: H });
    doc.setProperties({ title: scene.document.name, creator: 'Federal Bank creative editor' });
    return { blob: doc.output('blob'), fonts };
  } finally { releaseAssets(collected); }
}

const canvasBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
/** @returns {Promise<{blob:Blob, filename:string, note?:string}>} */
export async function exportFile(scene, assets, format, name, onPhase = () => {}) {
  const W = scene.document.width, H = scene.document.height; const base = `${name}-${Math.round(W)}x${Math.round(H)}`;
  if (format === 'png') { onPhase('rendering'); const c = await renderToCanvas(scene, assets, 2); return { blob: await canvasBlob(c, 'image/png'), filename: `${base}.png` }; }
  if (format === 'jpg') { onPhase('rendering'); const c = await renderToCanvas(scene, assets, 2); return { blob: await canvasBlob(c, 'image/jpeg', 0.92), filename: `${base}.jpg` }; }
  if (format === 'svg') { const collected = await collectAssets(scene, assets); return { blob: new Blob([buildSvg(scene, assets, collected)], { type: 'image/svg+xml' }), filename: `${base}.svg` }; }
  if (format === 'pdf' || format === 'ai') {
    const { blob, fonts } = await renderVectorPdf(scene, assets, onPhase);
    const lib = libraryFonts();
    const covered = (c) => SCRIPT_FONTS.some(([re]) => re.test(c)) // script lines are pictured, so their glyphs are never at risk
      || (c === '₹' && scene.elements.filter((e) => e.type === 'text' && e.visible && e.text.content.includes('₹')).every((e) => lib.some((f) => f.family === e.text.fontFamily && f.rupee)));
    const special = [...new Set(scene.elements.filter((e) => e.type === 'text' && e.visible).flatMap((e) => [...e.text.content].filter((c) => c.charCodeAt(0) > 0x24F && !covered(c))))];
    const pictured = scene.elements.filter((e) => e.type === 'text' && e.visible && scriptFontsFor(e.text.content).length).length;
    const partial = [...new Set(scene.elements.filter((e) => e.type === 'text' && e.visible).map((e) => e.text.fontFamily).filter((fam) => lib.some((f) => f.subset && f.family === fam) && !lib.some((f) => !f.subset && f.family === fam)))];
    const note = (fonts.length ? `embedded ${fonts.join(', ')}` : 'text set in Helvetica (brand fonts unavailable)') + (pictured ? ` · ${pictured} regional-language line${pictured > 1 ? 's are' : ' is'} placed as a sharp image, not live text` : '') + (partial.length ? ` · ${partial.join(', ')} ${partial.length > 1 ? 'are' : 'is'} a partial font from the original file: letters that were not in that file may be missing, ask the designer for the full font` : '') + (special.length ? ` · check ${special.join(' ')} in Illustrator (glyph may be missing from the embedded font)` : '');
    return { blob, filename: `${base}.${format}`, note };
  }
  throw new Error('unknown format ' + format);
}
