// Size adapts: re-compose a creative for another aspect ratio. Rules, not scaling: the page is read as slots (brand,
// picture, message, action, legal, background) and each slot is placed into a composition chosen for the target shape.
// Text is re-measured with the same layout the editor draws, so it wraps and shrinks like it will on screen.
import { layoutText, lineHeightOf } from './render.js';

export const PRESETS = [
  { id: 'story', label: 'Story 9:16', w: 1080, h: 1920, hint: 'Instagram / WhatsApp status' },
  { id: 'post', label: 'Post 1:1', w: 1080, h: 1080, hint: 'Instagram, Facebook, LinkedIn' },
  { id: 'banner', label: 'Banner 16:9', w: 1920, h: 1080, hint: 'YouTube, screens, email header' },
  { id: 'classic', label: 'Classic 4:3', w: 1440, h: 1080, hint: 'Presentations, older displays' },
];
export const isSizeLabel = (s) => PRESETS.some((p) => p.label === s);

const r2 = (v) => Math.round(v * 100) / 100;
const area = (e) => e.bounds.width * e.bounds.height;
const union = (list) => { const x0 = Math.min(...list.map((e) => e.bounds.x)), y0 = Math.min(...list.map((e) => e.bounds.y)); return { x: x0, y: y0, width: Math.max(...list.map((e) => e.bounds.x + e.bounds.width)) - x0, height: Math.max(...list.map((e) => e.bounds.y + e.bounds.height)) - y0 }; };

/** Height of a text element's content at a given font size and width (same layout as the stage). */
function measure(ctx, e, fontSize, width) {
  const t = { ...e.text, fontSize, lineHeight: e.text.lineHeight ? e.text.lineHeight * fontSize / e.text.fontSize : null, kind: 'area', align: e.text.align === 'justify' ? 'left' : e.text.align };
  const lines = layoutText(ctx, { ...e, text: t, bounds: { ...e.bounds, width } });
  return { height: Math.ceil(lines.length * lineHeightOf(t)), lines: lines.length, text: t, width: Math.max(0, ...lines.map((l) => l.parts.reduce((n, p) => n + p.width, 0))) };
}

export function adaptScene(scene, preset, ctx, ref = null) { // ref: canvas with the original render, for sampling colours
  const W = scene.document.width, H = scene.document.height, TW = preset.w, TH = preset.h; const ab = scene.document.activeArtboard ?? 0;
  const els = scene.elements.filter((e) => e.type !== 'group' && e.visible !== false && (e.artboardId ?? 0) === ab).sort((a, b) => a.zIndex - b.zIndex);
  const isLayer = (e) => e.type === 'vector' && e.meta?.collapsedGroup;
  const bg = [], deco = [], brand = [], brandText = [], images = [], texts = [], action = [], legal = [];
  for (const e of els) {
    if (isLayer(e) || e.role === 'background' || (e.type !== 'text' && area(e) > W * H * 0.3)) bg.push(e);
    else if (e.role === 'logo') (e.type === 'text' ? brandText : brand).push(e);
    else if (e.role === 'cta') action.push(e);
    else if (e.type === 'text') { if (e.role === 'disclaimer') legal.push(e); else if (e.role === 'decoration' && e.text.content.trim().length < 3) deco.push(e); else texts.push(e); }
    else if (e.type === 'image' || e.role === 'product') images.push(e);
    else deco.push(e);
  }
  // A document (statement, letter, form: many small text blocks, or several pages) is not an ad. Re-composing it would
  // scatter its tables, so it is fitted whole into the new shape on a background of its own page colour.
  const documentLike = texts.length + legal.length > 22 || (scene.document.artboards?.length || 1) > 1;
  if (documentLike) {
    const s = Math.min(TW / W, TH / H) * 0.94; const ox = (TW - W * s) / 2, oy = (TH - H * s) / 2; const out = [];
    let page = '#FFFFFF'; if (ref) { try { const rc = ref.getContext('2d'); const pts = []; for (let f = 0.1; f < 1; f += 0.2) pts.push([2, Math.round(ref.height * f)], [ref.width - 3, Math.round(ref.height * f)], [Math.round(ref.width * f), ref.height - 3]); const tally = new Map(); for (const [x, y] of pts) { const d = rc.getImageData(x, y, 1, 1).data; const k = [d[0], d[1], d[2]].map((v) => Math.round(v / 12) * 12).join(','); tally.set(k, (tally.get(k) || 0) + 1); } const c = [...tally.entries()].sort((x, y) => y[1] - x[1])[0][0].split(',').map(Number); /* the most common edge colour is the page, not the header band */ page = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); } catch { /* keep white */ } }
    out.push({ id: 'el_page_bg', type: 'vector', name: 'Background', parentId: null, artboardId: 0, zIndex: 0, bounds: { x: 0, y: 0, width: TW, height: TH }, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: page, gradient: null, stroke: null, opacity: 1, blendMode: 'normal', asset: null, assetSvg: null, editable: false, locked: true, visible: true, role: 'background', renderMode: 'css', meta: { kind: 'rect', cornerRadius: 0, addedBy: 'adapt' } });
    els.forEach((e, i) => out.push({ ...e, artboardId: 0, zIndex: i + 1, bounds: { x: r2(e.bounds.x * s + ox), y: r2(e.bounds.y * s + oy), width: r2(e.bounds.width * s), height: r2(e.bounds.height * s) }, ...(e.text ? { text: { ...e.text, fontSize: r2(e.text.fontSize * s), lineHeight: e.text.lineHeight ? r2(e.text.lineHeight * s) : null, letterSpacing: r2((e.text.letterSpacing || 0) * s) } } : {}), ...(e.meta?.cornerRadius ? { meta: { ...e.meta, cornerRadius: r2(e.meta.cornerRadius * s) } } : {}) }));
    const board0 = scene.document.artboards?.[ab] || { id: 0, name: 'Artboard 1' };
    return { ...scene, document: { ...scene.document, width: TW, height: TH, activeArtboard: 0, artboards: [{ ...board0, id: 0, x: 0, y: 0, width: TW, height: TH }] }, elements: out, adapt: { preset: preset.id, mode: 'fit', from: { width: W, height: H } } };
  }
  const hero = images.sort((a, b) => area(b) - area(a))[0] || null; deco.push(...images.slice(1));
  const portrait = TH / TW > 1.15, landscape = TW / TH > 1.15;
  const m = Math.round(Math.min(TW, TH) * 0.06), gap = Math.round(Math.min(TW, TH) * 0.025);
  const out = []; let z = 0; const push = (e, patch) => out.push({ ...e, ...patch, artboardId: 0, zIndex: z++, bounds: Object.fromEntries(Object.entries(patch.bounds || e.bounds).map(([k, v]) => [k, r2(v)])) });

  // 1. background and decoration ride together: scaled to cover the target, centred (the crop is symmetric)
  const cs = Math.max(TW / W, TH / H);
  // Crop away from the copy: the subject of a photo is usually on the side the text is not, so keep that side in frame.
  const tcx = texts.length ? texts.reduce((n, e) => n + e.bounds.x + e.bounds.width / 2, 0) / texts.length : W / 2;
  const overX = W * cs - TW, overY = H * cs - TH; const dx = overX > 1 ? (tcx < W / 2 ? -overX : 0) : (TW - W * cs) / 2; const dy = overY > 1 ? -overY * 0.25 : (TH - H * cs) / 2;
  const cover = (e) => ({ bounds: { x: e.bounds.x * cs + dx, y: e.bounds.y * cs + dy, width: e.bounds.width * cs, height: e.bounds.height * cs }, ...(e.text ? { text: { ...e.text, fontSize: r2(e.text.fontSize * cs), lineHeight: e.text.lineHeight ? r2(e.text.lineHeight * cs) : null, letterSpacing: r2((e.text.letterSpacing || 0) * cs) } } : {}), ...(e.meta?.cornerRadius ? { meta: { ...e.meta, cornerRadius: r2(e.meta.cornerRadius * cs) } } : {}) });
  for (const e of bg) push(e, cover(e));
  for (const e of deco) push(e, cover(e));

  // 2. regions
  const brandH = Math.round(TH * (landscape ? 0.09 : 0.065));
  let colX = m, colW = TW - 2 * m, imgRegion = null, msgTop = m + brandH + gap;
  if (landscape) { if (hero) { colW = Math.round(TW * 0.5 - m); imgRegion = { x: Math.round(TW * 0.55), y: m, width: TW - Math.round(TW * 0.55) - m, height: TH - 2 * m }; } else colW = Math.round(TW * 0.72); }
  else if (hero) { const ih = Math.round(TH * (portrait ? 0.34 : 0.36)); imgRegion = { x: m, y: msgTop, width: colW, height: ih }; msgTop += ih + gap; }

  // 3. brand: logo scaled to the brand row, kept on the side it came from; its tagline text keeps its offset
  const logo = brand.sort((a, b) => area(b) - area(a))[0];
  if (logo) { const s = Math.min(brandH / logo.bounds.height, TW * 0.42 / logo.bounds.width); const w = logo.bounds.width * s, h = logo.bounds.height * s; const right = logo.bounds.x + logo.bounds.width / 2 > W / 2;
    const x = right ? TW - m - w : m, y = m + (brandH - h) / 2; push(logo, { bounds: { x, y, width: w, height: h } });
    for (const t of [...brand.filter((e) => e !== logo), ...brandText]) push(t, { bounds: { x: x + (t.bounds.x - logo.bounds.x) * s, y: y + (t.bounds.y - logo.bounds.y) * s, width: t.bounds.width * s, height: t.bounds.height * s }, ...(t.text ? { text: { ...t.text, fontSize: r2(t.text.fontSize * s), lineHeight: t.text.lineHeight ? r2(t.text.lineHeight * s) : null } } : {}) }); }
  else for (const t of brandText) push(t, cover(t));

  // 4. the picture: contained in its region, keeping its shape and crop
  if (hero && imgRegion) { const s = Math.min(imgRegion.width / hero.bounds.width, imgRegion.height / hero.bounds.height); const w = hero.bounds.width * s, h = hero.bounds.height * s; push(hero, { bounds: { x: imgRegion.x + (imgRegion.width - w) / 2, y: imgRegion.y + (landscape ? (imgRegion.height - h) / 2 : 0), width: w, height: h } }); }

  // 5. type scale: the message column's new width against the widest text it had
  const srcW = Math.max(...texts.map((e) => e.bounds.width), W * 0.5); let k = Math.min(2.2, Math.max(0.5, colW / srcW));
  const minFs = Math.max(11, TH * 0.011);
  const alignOf = (e) => (e.text.align === 'justify' ? 'left' : landscape ? 'left' : e.text.align === 'center' && !landscape ? 'center' : e.text.align || 'left');

  // 6. legal at the bottom, action above it, then the message fills what is left (shrinking together if it must)
  let legalTop = TH - m; const legalOut = [];
  for (const e of [...legal].reverse()) { const fs = Math.max(minFs, e.text.fontSize * k * 0.85); const mm = measure(ctx, e, fs, colW); legalTop -= mm.height; legalOut.unshift([e, { bounds: { x: colX, y: legalTop, width: colW, height: mm.height }, text: { ...mm.text, align: alignOf(e) } }]); legalTop -= gap * 0.5; }
  let actionTop = legalTop - (legal.length ? gap : 0); const actionOut = []; let gh = 0;
  if (action.length) { const gb = union(action); const label = action.find((e) => e.type === 'text'); let s = k; if (gb.width * s > colW) s = colW / gb.width; if (label) s = Math.max(s, minFs * 1.15 / label.text.fontSize);
    const gw = gb.width * s; gh = gb.height * s; const centred = Math.abs(gb.x + gb.width / 2 - W / 2) < W * 0.08 && !landscape; const gx = centred ? (TW - gw) / 2 : colX; actionTop -= gh;
    for (const e of action) actionOut.push([e, { bounds: { x: gx + (e.bounds.x - gb.x) * s, y: actionTop + (e.bounds.y - gb.y) * s, width: e.bounds.width * s, height: e.bounds.height * s }, ...(e.text ? { text: { ...e.text, fontSize: r2(e.text.fontSize * s), lineHeight: e.text.lineHeight ? r2(e.text.lineHeight * s) : null } } : {}), ...(e.meta?.cornerRadius ? { meta: { ...e.meta, cornerRadius: r2(e.meta.cornerRadius * s) } } : {}) }]);
    actionTop -= gap; }
  const avail = actionTop - msgTop; const ordered = [...texts].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const plan = (kk) => { let y = msgTop; const items = []; for (const e of ordered) { const fs = Math.max(minFs, e.text.fontSize * kk); const mm = measure(ctx, e, fs, colW); items.push([e, { bounds: { x: colX, y, width: colW, height: mm.height }, text: { ...mm.text, align: alignOf(e) } }]); y += mm.height + Math.round(fs * 0.45); } return { items, height: y - msgTop }; };
  let p = plan(k); for (let i = 0; i < 6 && p.height > avail && k > 0.55; i++) { k = Math.max(0.55, k * Math.min(0.9, avail / p.height)); p = plan(k); }
  // Message and button stay together; the group sits a third of the way down the free space rather than leaving a hole.
  const groupH = p.height + (action.length ? gh + gap : 0); const free = Math.max(0, (legalTop - (legal.length ? gap : 0)) - msgTop - groupH); const shift = Math.round(free * (hero && !landscape ? 0.15 : 0.35));
  p.items.forEach(([, patch]) => { patch.bounds.y += shift; });
  if (action.length) { const newTop = msgTop + shift + p.height + gap; const d = newTop - actionTop; actionOut.forEach(([, patch]) => { patch.bounds.y += d; }); }
  // A busy photo behind the re-placed copy makes it unreadable: put a panel behind message + button in the colour the copy
  // sat on originally (sampled from the original render), when the new spot is not flat.
  if (ref && p.items.length) {
    const rc = ref.getContext('2d'); const rs = ref.width / W;
    const sample = (x, y, w, h, step) => { const out = []; for (let yy = y; yy < y + h; yy += step) for (let xx = x; xx < x + w; xx += step) { const px = Math.min(ref.width - 1, Math.max(0, Math.round(xx * rs))), py = Math.min(ref.height - 1, Math.max(0, Math.round(yy * rs))); const d = rc.getImageData(px, py, 1, 1).data; out.push([d[0], d[1], d[2]]); } return out; };
    const g0 = p.items[0][1].bounds, g1 = (actionOut.length ? actionOut : p.items)[(actionOut.length ? actionOut : p.items).length - 1][1].bounds; const gy0 = g0.y - gap, gy1 = g1.y + g1.height + gap;
    // where the message will sit, in source coordinates (inverse of the cover transform)
    const sx = (colX - dx) / cs, sy = (gy0 - dy) / cs, sw = colW / cs, sh = (gy1 - gy0) / cs; const under = sample(sx, sy, sw, sh, Math.max(4, Math.min(sw, sh) / 12));
    const mean = under.reduce((a, q) => [a[0] + q[0], a[1] + q[1], a[2] + q[2]], [0, 0, 0]).map((v) => v / under.length); const spread = under.reduce((n, q) => n + Math.abs(q[0] - mean[0]) + Math.abs(q[1] - mean[1]) + Math.abs(q[2] - mean[2]), 0) / under.length / 3;
    if (spread > 18) { const t0 = ordered[0]; const around = sample(t0.bounds.x - 8, t0.bounds.y - 8, t0.bounds.width + 16, 6, 6).concat(sample(t0.bounds.x - 8, t0.bounds.y + t0.bounds.height + 2, t0.bounds.width + 16, 6, 6)); const c = around.reduce((a, q) => [a[0] + q[0], a[1] + q[1], a[2] + q[2]], [0, 0, 0]).map((v) => Math.round(v / around.length));
      const hex = '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); const pad = gap * 1.5;
      push({ id: 'el_panel_' + Date.now().toString(36), type: 'vector', name: 'Text panel', parentId: null, artboardId: 0, zIndex: 0, bounds: { x: colX - pad, y: gy0 - pad * 0.5, width: colW + pad * 2, height: gy1 - gy0 + pad }, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: hex, gradient: null, stroke: null, opacity: 0.94, blendMode: 'normal', asset: null, assetSvg: null, editable: true, locked: false, visible: true, role: 'decoration', renderMode: 'css', meta: { kind: 'rect', cornerRadius: Math.round(gap * 0.6), addedBy: 'adapt' } }, {});
    }
  }
  for (const [e, patch] of p.items) push(e, patch);
  for (const [e, patch] of actionOut) push(e, patch);
  for (const [e, patch] of legalOut) push(e, patch);

  const board = scene.document.artboards?.[ab] || { id: 0, name: 'Artboard 1' };
  return { ...scene, document: { ...scene.document, width: TW, height: TH, activeArtboard: 0, artboards: [{ ...board, id: 0, x: 0, y: 0, width: TW, height: TH }] }, elements: out, adapt: { preset: preset.id, from: { width: W, height: H } } };
}
