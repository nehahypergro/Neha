// Rendering helpers shared by the stage (DOM), the canvas exporter (PNG/PDF) and the SVG exporter.
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
export function drawText(ctx, e) {
  const t = e.text, { x, y, width: w, height: h } = e.bounds;
  ctx.font = fontString(t); if ('letterSpacing' in ctx) ctx.letterSpacing = (t.letterSpacing || 0) + 'px';
  if (e.meta?.coverFill) { const p = coverPad(t); ctx.fillStyle = e.meta.coverFill; ctx.fillRect(x - p, y - p, w + 2 * p, h + 2 * p); }
  ctx.fillStyle = e.fill || '#000'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
  const tx = t.align === 'center' ? x + w / 2 : t.align === 'right' ? x + w : x;
  wrapLines(ctx, t.content, t.kind === 'point' ? Infinity : w).forEach((l, i) => ctx.fillText(l, tx, y + baselineY(t, i)));
}

/** Rasterise a scene (not the DOM) to a canvas. Fonts must already be loaded in the document. */
export async function renderToCanvas(scene, assets, scale = 2) {
  const W = scene.document.width, H = scene.document.height;
  const c = document.createElement('canvas'); c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const els = scene.elements.filter((e) => e.type !== 'group' && e.visible).sort((a, b) => a.zIndex - b.zIndex);
  for (const e of els) {
    const { x, y, width: w, height: h } = e.bounds; ctx.save(); ctx.globalAlpha = e.opacity ?? 1;
    if (e.transform?.rotation) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-e.transform.rotation * Math.PI / 180); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    if (e.type === 'text') drawText(ctx, e);
    else if (isCssShape(e)) { if (e.fill) { ctx.fillStyle = e.fill; shapePath(ctx, e); ctx.fill(); } }
    else { const url = assetUrl(e, assets); try { const img = await loadImage(url); if (e.transform?.scaleY === -1) { ctx.translate(0, y * 2 + h); ctx.scale(1, -1); } ctx.drawImage(img, x, y, w, h); } catch { ctx.fillStyle = '#e6e4de'; ctx.fillRect(x, y, w, h); } }
    ctx.restore();
  }
  return c;
}

/** Serialise a scene to SVG. `imgData` maps asset urls to data: URIs (see toDataUrl) so the file is self-contained. */
export function toSvg(scene, assets, imgData = {}) {
  const W = scene.document.width, H = scene.document.height;
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const measure = document.createElement('canvas').getContext('2d');
  const parts = scene.elements.filter((e) => e.type !== 'group' && e.visible).sort((a, b) => a.zIndex - b.zIndex).map((e) => {
    const { x, y, width: w, height: h } = e.bounds;
    const rot = e.transform?.rotation ? ` transform="rotate(${-e.transform.rotation} ${x + w / 2} ${y + h / 2})"` : '', op = e.opacity !== 1 ? ` opacity="${e.opacity}"` : '';
    if (e.type !== 'text') {
      if (isCssShape(e)) { if (!e.fill) return ''; return e.meta?.kind === 'ellipse' ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${e.fill}"${rot}${op}/>` : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(e.meta?.cornerRadius || 0, w / 2, h / 2)}" fill="${e.fill}"${rot}${op}/>`; }
      const u = assetUrl(e, assets); return `<image href="${esc(imgData[u] || u)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"${rot}${op}/>`;
    }
    const t = e.text; measure.font = fontString(t);
    const lines = wrapLines(measure, t.content, t.kind === 'point' ? Infinity : w);
    const tx = t.align === 'center' ? x + w / 2 : t.align === 'right' ? x + w : x, anchor = t.align === 'center' ? 'middle' : t.align === 'right' ? 'end' : 'start';
    const cp = coverPad(t); const cover = e.meta?.coverFill ? `<rect x="${x - cp}" y="${y - cp}" width="${w + 2 * cp}" height="${h + 2 * cp}" fill="${e.meta.coverFill}"${rot}/>` : '';
    return cover + lines.map((l, i) => `<text x="${tx}" y="${y + baselineY(t, i)}" font-family="${esc(t.fontFamily || 'Helvetica')}, sans-serif" font-size="${t.fontSize}" font-weight="${weightOf(t.fontStyle)}" font-style="${isItalic(t.fontStyle) ? 'italic' : 'normal'}" letter-spacing="${t.letterSpacing || 0}" fill="${e.fill || '#000'}" text-anchor="${anchor}"${rot}${op} xml:space="preserve">${esc(l)}</text>`).join('');
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`;
}

export function download(name, href) { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
