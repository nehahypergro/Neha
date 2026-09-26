// Size adapts, the way a designer reworks a master for another format ("MR adapts"):
//   1. the background is taken apart: a colour field, decorative shapes, and the photo, each handled on its own terms
//   2. a composition is chosen for the target from a small repertoire (photo band, split screen, product-right, text-led)
//   3. type is set from a scale for the format, keeping the source hierarchy (headline : subhead : body : legal)
//   4. a colour panel that held the copy is reshaped to the new copy block; decorations are re-anchored to their corners
//   5. platform safe zones are respected (a story's top and bottom bands sit under the app's own UI)
// Everything is measured with the editor's own text layout, so what is planned here is what the stage draws.
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
const hexOf = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 0; const n = parseInt(m[1], 16); return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; };
const dominant = (canvas) => { try { const g = canvas.getContext('2d'); const d = g.getImageData(0, 0, canvas.width, canvas.height).data; const acc = [0, 0, 0]; let n = 0; for (let i = 0; i < d.length; i += 4 * 7) { if (d[i + 3] < 128) continue; acc[0] += d[i]; acc[1] += d[i + 1]; acc[2] += d[i + 2]; n++; } return n ? acc.map((v) => v / n) : null; } catch { return null; } };
const inside = (pt, b) => pt[0] >= b.x && pt[0] <= b.x + b.width && pt[1] >= b.y && pt[1] <= b.y + b.height;
const centre = (e) => [e.bounds.x + e.bounds.width / 2, e.bounds.y + e.bounds.height / 2];
const scaleText = (t, s) => ({ ...t, fontSize: r2(t.fontSize * s), lineHeight: t.lineHeight ? r2(t.lineHeight * s) : null, letterSpacing: r2((t.letterSpacing || 0) * s) });
const scaleBox = (b, s, ox = 0, oy = 0) => ({ x: r2(b.x * s + ox), y: r2(b.y * s + oy), width: r2(b.width * s), height: r2(b.height * s) });

/** Height of a text element's content at a font size and width (same layout as the stage). */
function measure(ctx, e, fontSize, width) {
  const t = { ...e.text, fontSize, lineHeight: e.text.lineHeight ? e.text.lineHeight * fontSize / e.text.fontSize : null, kind: 'area', align: e.text.align === 'justify' ? 'left' : e.text.align };
  const lines = layoutText(ctx, { ...e, text: t, bounds: { ...e.bounds, width } });
  return { height: Math.ceil(lines.length * lineHeightOf(t)), lines: lines.length, text: t };
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. What is the artwork made of? Read from a composite of the background layers (transparent = nothing there).
export function analyseArt(art, W, H, ignore = []) {
  if (!art) return null;
  const rw = art.width, rh = art.height; const d = art.getContext('2d').getImageData(0, 0, rw, rh).data; const sx = rw / W, sy = rh / H;
  const at = (x, y) => { const i = (Math.min(rh - 1, Math.max(0, y)) * rw + Math.min(rw - 1, Math.max(0, x))) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  // the colour field is the most common colour over the whole artwork (a photo spreads its votes; a flat field does not)
  const tally = new Map(); const q = (v) => Math.round(v / 12) * 12; let votes = 0;
  for (let y = 0; y < rh; y += 4) for (let x = 0; x < rw; x += 4) { const p = at(x, y); if (p[3] < 128) continue; votes++; const k = [q(p[0]), q(p[1]), q(p[2])].join(','); tally.set(k, (tally.get(k) || 0) + 1); }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]; const field = top ? top[0].split(',').map(Number) : [255, 255, 255]; const fieldShare = top && votes ? top[1] / votes : 0;
  const G = 24; const cells = []; let contentCount = 0, spreadSum = 0;
  const skip = (gx, gy) => ignore.some((b) => inside([(gx + 0.5) * W / G, (gy + 0.5) * H / G], b));
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    let n = 0, diff = 0; const acc = [0, 0, 0]; const pts = [];
    for (let yy = Math.floor(gy * rh / G); yy < Math.floor((gy + 1) * rh / G); yy += 3) for (let xx = Math.floor(gx * rw / G); xx < Math.floor((gx + 1) * rw / G); xx += 3) { const p = at(xx, yy); n++; if (p[3] < 40) continue; if (Math.abs(p[0] - field[0]) + Math.abs(p[1] - field[1]) + Math.abs(p[2] - field[2]) > 60) diff++; pts.push(p); acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]; }
    const m = pts.length ? acc.map((v) => v / pts.length) : field; const spread = pts.length ? pts.reduce((s, p) => s + Math.abs(p[0] - m[0]) + Math.abs(p[1] - m[1]) + Math.abs(p[2] - m[2]), 0) / pts.length / 3 : 0;
    const content = n && !skip(gx, gy) ? diff / n : 0; cells.push({ gx, gy, content, spread }); if (content > 0.3) contentCount++; spreadSum += spread;
  }
  const coverage = contentCount / cells.length, meanSpread = spreadSum / cells.length;
  const seen = new Set(), clusters = []; const idx = (gx, gy) => gy * G + gx;
  for (const c of cells) { if (c.content <= 0.3 || seen.has(idx(c.gx, c.gy))) continue; const stack = [c]; seen.add(idx(c.gx, c.gy)); let x0 = c.gx, x1 = c.gx, y0 = c.gy, y1 = c.gy, n = 0;
    while (stack.length) { const cur = stack.pop(); n++; x0 = Math.min(x0, cur.gx); x1 = Math.max(x1, cur.gx); y0 = Math.min(y0, cur.gy); y1 = Math.max(y1, cur.gy); for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cur.gx + ddx, ny = cur.gy + ddy; if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue; const k = idx(nx, ny); if (seen.has(k) || cells[k].content <= 0.3) continue; seen.add(k); stack.push(cells[k]); } }
    const members = cells.filter((cc) => cc.content > 0.3 && cc.gx >= x0 && cc.gx <= x1 && cc.gy >= y0 && cc.gy <= y1); const sp = members.reduce((a, cc) => a + cc.spread, 0) / Math.max(1, members.length);
    clusters.push({ x: x0 * W / G, y: y0 * H / G, width: (x1 - x0 + 1) * W / G, height: (y1 - y0 + 1) * H / G, cells: n, spread: sp, share: n / cells.length }); }
  clusters.sort((a, b) => b.cells - a.cells);
  // a photo is a large cluster with lots of variation inside it; a gradient is wide coverage with little; the rest is graphic
  const main = clusters[0]; const kind = main && main.spread > 14 && main.share > 0.15 ? 'photo' : coverage > 0.55 ? 'gradient' : 'graphic';
  void sx; void sy;
  return { field, fieldHex: hexOf(field), fieldShare, kind, coverage, meanSpread, clusters: clusters.filter((c) => c.cells >= 3).slice(0, 3) };
}

/** A crop window of the source art (fractions of the whole art) that covers a target region, centred on the focal point,
 *  kept inside `box` (the photo's own extent, when the photo only fills part of the artwork). */
function cropFor(W, H, region, focal, box = null) {
  const b = box || { x: 0, y: 0, width: W, height: H }; const aspect = region.width / region.height;
  let w = Math.min(b.width, b.height * aspect), h = w / aspect; if (h > b.height) { h = b.height; w = b.height * aspect; }
  const x = Math.min(b.x + b.width - w, Math.max(b.x, focal[0] - w / 2)), y = Math.min(b.y + b.height - h, Math.max(b.y, focal[1] - h / 2));
  return { x: x / W, y: y / H, w: w / W, h: h / H };
}

// ---------------------------------------------------------------------------------------------------------------------
export function adaptScene(scene, preset, ctx, extra = {}) {
  const { art = null, artAsset = null, ref = null } = extra;
  const W = scene.document.width, H = scene.document.height, TW = preset.w, TH = preset.h; const ab = scene.document.activeArtboard ?? 0;
  const els = scene.elements.filter((e) => e.type !== 'group' && e.visible !== false && (e.artboardId ?? 0) === ab).sort((a, b) => a.zIndex - b.zIndex);
  const isLayer = (e) => e.type === 'vector' && e.meta?.collapsedGroup;
  const layers = [], shapes = [], brand = [], brandText = [], images = [], texts = [], action = [], legal = [];
  for (const e of els) {
    if (isLayer(e)) layers.push(e);
    else if (e.role === 'logo') (e.type === 'text' ? brandText : brand).push(e);
    else if (e.role === 'cta') action.push(e);
    else if (e.type === 'text') { if (e.role === 'disclaimer') legal.push(e); else if (e.role === 'decoration' && e.text.content.trim().length < 3) shapes.push(e); else texts.push(e); }
    else if (e.type === 'image' || e.role === 'product') images.push(e);
    else shapes.push(e);
  }
  const out = []; let z = 0;
  const push = (e, patch = {}) => out.push({ ...e, ...patch, artboardId: 0, zIndex: z++, bounds: Object.fromEntries(Object.entries(patch.bounds || e.bounds).map(([k, v]) => [k, r2(v)])) });
  const board = scene.document.artboards?.[ab] || { id: 0, name: 'Artboard 1' };
  const finish = (mode, note) => ({ ...scene, document: { ...scene.document, width: TW, height: TH, activeArtboard: 0, artboards: [{ ...board, id: 0, x: 0, y: 0, width: TW, height: TH }] }, elements: out, adapt: { preset: preset.id, mode, note, from: { width: W, height: H } } });
  const rect = (id, name, b, fill, more = {}) => ({ id, type: 'vector', name, parentId: null, artboardId: 0, zIndex: 0, bounds: b, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill, gradient: null, stroke: null, opacity: 1, blendMode: 'normal', asset: null, assetSvg: null, editable: true, locked: false, visible: true, role: 'decoration', renderMode: 'css', meta: { kind: 'rect', cornerRadius: 0, addedBy: 'adapt' }, ...more });

  // A document (statement, letter, form) is fitted whole on its page colour: re-composing it would scatter its tables.
  if (texts.length + legal.length > 22 || (scene.document.artboards?.length || 1) > 1) {
    const s = Math.min(TW / W, TH / H) * 0.94, ox = (TW - W * s) / 2, oy = (TH - H * s) / 2;
    let page = '#FFFFFF'; const src = art || ref; if (src) { try { const rc = src.getContext('2d'); const pts = []; for (let f = 0.1; f < 1; f += 0.2) pts.push([2, Math.round(src.height * f)], [src.width - 3, Math.round(src.height * f)], [Math.round(src.width * f), src.height - 3]); const tally = new Map(); for (const [x, y] of pts) { const p = rc.getImageData(x, y, 1, 1).data; if (p[3] < 128) continue; const k = [p[0], p[1], p[2]].map((v) => Math.round(v / 12) * 12).join(','); tally.set(k, (tally.get(k) || 0) + 1); } const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]; if (best) page = hexOf(best[0].split(',').map(Number)); } catch { /* keep white */ } }
    push(rect('el_page_bg', 'Background', { x: 0, y: 0, width: TW, height: TH }, page, { editable: false, locked: true, role: 'background' }));
    for (const e of els) push(e, { bounds: scaleBox(e.bounds, s, ox, oy), ...(e.text ? { text: scaleText(e.text, s) } : {}), ...(e.meta?.cornerRadius ? { meta: { ...e.meta, cornerRadius: r2(e.meta.cornerRadius * s) } } : {}) });
    return finish('fit', 'document fitted whole');
  }

  // ---- read the artwork
  const portrait = TH / TW > 1.15, landscape = TW / TH > 1.15, story = preset.id === 'story';
  const hero = images.sort((a, b) => area(b) - area(a))[0] || null;
  const riders = images.filter((e) => e !== hero && inside(centre(e), hero?.bounds || { x: -1, y: -1, width: 0, height: 0 }));
  // the photo under a copy panel is not usable (the master hides it, and outlined copy may be baked there): ignore it too
  const panelBoxes = shapes.filter((e) => e.type !== 'text' && !e.asset && !e.assetSvg && area(e) > W * H * 0.12 && texts.some((t) => inside(centre(t), e.bounds))).map((e) => e.bounds);
  const lifted = [...brand, ...images, ...texts, ...action, ...legal].map((e) => e.bounds).concat(panelBoxes);
  const info = art ? analyseArt(art, W, H, lifted) : null;
  const heroIsPhoto = !!hero && hero.role === 'image' && !hero.meta?.cutout && area(hero) > W * H * 0.12;
  const fieldShape = shapes.find((e) => e.type !== 'text' && !e.asset && !e.assetSvg && area(e) > W * H * 0.8);
  // the copy's own colour decides the field: light copy wants a deep field, dark copy a pale one
  const copyLight = texts.length ? texts.filter((e) => lum(e.fill) > 0.6).length >= texts.length / 2 : false;
  const panelShape = shapes.filter((e) => e.type !== 'text' && !e.asset && !e.assetSvg && area(e) > W * H * 0.12 && texts.some((t) => inside(centre(t), e.bounds))).sort((a, b) => area(b) - area(a))[0] || null;
  let fieldHex = fieldShape?.fill || panelShape?.fill || info?.fieldHex || '#FFFFFF';
  if ((heroIsPhoto || (info && info.kind !== 'graphic')) && !fieldShape && !panelShape && !(info && info.fieldShare > 0.28)) { const dom = dominant(ref || art) || [40, 60, 90]; fieldHex = hexOf(copyLight ? dom.map((v) => v * 0.42) : dom.map((v) => 235 + (v - 235) * 0.12)); }
  const textCentroid = texts.length ? texts.reduce((n, e) => n + centre(e)[0], 0) / texts.length : W / 2;
  const focal = scene.focal ? [scene.focal.x + scene.focal.width / 2, scene.focal.y + scene.focal.height / 2] : [textCentroid < W / 2 ? W * 0.72 : W * 0.28, H * 0.42];
  const photoLike = (info && info.kind !== 'graphic') || heroIsPhoto;
  const hasPicture = !!hero || photoLike;

  // ---- composition and regions (target px)
  const m = Math.round(Math.min(TW, TH) * 0.06), gap = Math.round(Math.min(TW, TH) * 0.024);
  const safeTop = story ? Math.round(TH * 0.12) : m, safeBottom = story ? Math.round(TH * 0.13) : m;
  const brandH = Math.round(TH * (landscape ? 0.085 : story ? 0.05 : 0.065));
  let composition, colX = m, colW = TW - 2 * m, picture = null, msgTop = safeTop + brandH + gap, msgBottom = TH - safeBottom, textSide = 'left';
  if (landscape) {
    if (hasPicture) { composition = 'split'; const photoRight = focal[0] >= W / 2; textSide = photoRight ? 'left' : 'right'; const split = Math.round(TW * 0.52);
      picture = photoRight ? { x: split, y: 0, width: TW - split, height: TH } : { x: 0, y: 0, width: split, height: TH }; colW = split - m - Math.round(m * 0.6); colX = photoRight ? m : TW - split + Math.round(m * 0.6); }
    else { composition = 'text-led'; colW = Math.round(TW * 0.7); }
  } else if (hasPicture) { composition = 'photo-band'; picture = { x: 0, y: story ? safeTop + brandH + gap : 0, width: TW, height: 0 }; /* height set once the copy is measured */ }
  else composition = 'text-led';

  // ---- 4. type scale: the headline is set to read at format size and wrap to a few lines; the rest keep their ratio to it
  const headline = texts.find((e) => e.role === 'headline') || [...texts].sort((a, b) => b.text.fontSize - a.text.fontSize)[0];
  const maxLines = landscape ? 3 : 3; const hMax = TW * (landscape ? 0.062 : 0.092), hMin = TW * (landscape ? 0.038 : 0.052);
  let k;
  if (headline) { let fs = hMax; for (let i = 0; i < 14; i++) { const mm = measure(ctx, headline, fs, colW); if (mm.lines <= maxLines || fs <= hMin) break; fs = Math.max(hMin, fs * 0.92); } k = fs / headline.text.fontSize; }
  else k = Math.min(2.2, Math.max(0.5, colW / Math.max(...texts.map((e) => e.bounds.width), W * 0.5)));
  const minBody = TW * (landscape ? 0.015 : 0.021), minLegal = Math.max(11, TW * (landscape ? 0.011 : 0.014));
  const sizeFor = (e) => { const fs = e.text.fontSize * k; return e === headline ? fs : Math.min(fs, (headline ? headline.text.fontSize * k : fs) * 0.62) < minBody ? Math.max(minBody, Math.min(fs, (headline ? headline.text.fontSize * k : fs) * 0.62)) : Math.min(fs, (headline ? headline.text.fontSize * k : fs) * 0.62); };
  const alignOf = (e) => (e.text.align === 'justify' ? 'left' : landscape ? 'left' : e.text.align || 'left');

  // ---- 3b. brand row (drawn above the picture, so a card graphic with its own background never covers the logo): the logo keeps its side and its tagline; sized to the row
  const logo = brand.sort((a, b) => area(b) - area(a))[0];
  if (logo) { const s = Math.min(brandH / logo.bounds.height, TW * 0.4 / logo.bounds.width); const w = logo.bounds.width * s, h = logo.bounds.height * s; const onRight = logo.bounds.x + logo.bounds.width / 2 > W / 2;
    const x = landscape ? (textSide === 'left' ? colX : TW - m - w) : onRight ? TW - m - w : m, y = safeTop + (brandH - h) / 2; push(logo, { bounds: { x, y, width: w, height: h } });
    for (const t of [...brand.filter((e) => e !== logo), ...brandText]) push(t, { bounds: scaleBox({ x: t.bounds.x - logo.bounds.x, y: t.bounds.y - logo.bounds.y, width: t.bounds.width, height: t.bounds.height }, s, x, y), ...(t.text ? { text: scaleText(t.text, s) } : {}) }); }

  // ---- 5. legal at the bottom, then message + button as one block in the message region
  let legalTop = msgBottom; const legalOut = [];
  for (const e of [...legal].reverse()) { const fs = Math.max(minLegal, e.text.fontSize * k * 0.8); const mm = measure(ctx, e, fs, colW); legalTop -= mm.height; legalOut.unshift([e, { bounds: { x: colX, y: legalTop, width: colW, height: mm.height }, text: { ...mm.text, align: alignOf(e) } }]); legalTop -= gap * 0.5; }
  // the photo band takes what the copy leaves, within a designer's range: long copy gets a shorter band, short copy a taller one
  if (composition === 'photo-band') {
    const ideal = (() => { let y = 0; for (const e of [...texts].sort((a, b) => a.bounds.y - b.bounds.y)) { const fs = Math.max(e === headline ? hMin : minBody, sizeFor(e)); y += measure(ctx, e, fs, colW).height + Math.round(fs * 0.5); } return y + (action.length ? union(action).height * Math.min(k, colW / union(action).width) + gap : 0); })();
    const legalH = msgBottom - legalTop + (legal.length ? gap : 0); const room = msgBottom - legalH - picture.y - gap * 3 - ideal;
    picture.height = Math.round(Math.min(TH * (story ? 0.5 : 0.5), Math.max(TH * (story ? 0.26 : 0.3), room)));
    msgTop = picture.y + picture.height + gap * 1.5;
  }
  // ---- 1. background: colour field, then the photo where the composition wants it, or decorations re-anchored
  push(rect('el_field', 'Background', { x: 0, y: 0, width: TW, height: TH }, fieldHex, { editable: false, locked: true, role: 'background', meta: { kind: 'rect', cornerRadius: 0, addedBy: 'adapt', field: true } }));
  const artEl = (b, crop, name = 'Artwork') => ({ id: 'el_art_' + z, type: 'vector', name, parentId: null, artboardId: 0, zIndex: 0, bounds: b, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: null, gradient: null, stroke: null, opacity: 1, blendMode: 'normal', asset: artAsset, assetSvg: null, editable: false, locked: true, visible: true, role: 'background', meta: { collapsedGroup: true, adaptArt: true, crop } });
  if (artAsset && info) {
    if (info.kind !== 'graphic') {
      // the photo's own extent: when it fills only part of the artwork (a photo beside a colour panel), crop inside it
      const c0 = info.clusters[0]; const photoBox = info.kind === 'photo' && c0 && c0.width * c0.height < W * H * 0.9 ? c0 : null;
      const fp = photoBox && !inside(focal, photoBox) ? [photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height * 0.42] : focal;
      if (picture) push(artEl(picture, cropFor(W, H, picture, fp, photoBox), 'Photo'));
      else push(artEl({ x: 0, y: 0, width: TW, height: TH }, cropFor(W, H, { width: TW, height: TH }, fp, photoBox), 'Photo')); // text-led over a photo: the copy gets a panel below
    } else {
      // decorations keep their corner and their size relative to the short side, cropped out of the art
      const ds = Math.min(TW, TH) / Math.min(W, H);
      for (const c of info.clusters) { let w = c.width * ds, h = c.height * ds; const cap = Math.min(TW * 0.7 / w, TH * 0.5 / h, 1); w *= cap; h *= cap;
        const left = c.x < W * 0.03, right = c.x + c.width > W * 0.97, top = c.y < H * 0.03, bottom = c.y + c.height > H * 0.97;
        const x = left ? 0 : right ? TW - w : Math.min(TW - w, (c.x / W) * TW), y = top ? 0 : bottom ? TH - h : Math.min(TH - h, (c.y / H) * TH);
        push(artEl({ x, y, width: w, height: h }, { x: c.x / W, y: c.y / H, w: c.width / W, h: c.height / H }, 'Decoration')); }
    }
  } else if (!artAsset) { // no composite available: keep the layers, cover-cropped away from the copy
    const cs = Math.max(TW / W, TH / H); const overX = W * cs - TW, overY = H * cs - TH; const dx = overX > 1 ? (focal[0] > W / 2 ? -overX : 0) : (TW - W * cs) / 2, dy = overY > 1 ? -overY * 0.25 : (TH - H * cs) / 2;
    for (const l of layers) push(l, { bounds: scaleBox(l.bounds, cs, dx, dy) });
  }

  // ---- shapes: a panel that held the copy is reshaped later; the field shape is gone; the rest keep their corner
  const panels = [], decos = [];
  for (const e of images) if (e !== hero && !riders.includes(e)) shapes.push(e);
  for (const e of shapes) { if (e === fieldShape) continue; if (e.type !== 'text' && !e.asset && !e.assetSvg && area(e) > W * H * 0.12 && texts.some((t) => inside(centre(t), e.bounds))) panels.push(e); else decos.push(e); }
  const ds = Math.min(TW, TH) / Math.min(W, H);
  for (const e of decos) { let w = e.bounds.width * ds, h = e.bounds.height * ds; const cap = Math.min(TW * 0.6 / w, TH * 0.45 / h, 1); w *= cap; h *= cap; const s = w / e.bounds.width;
    const left = e.bounds.x < W * 0.03, right = e.bounds.x + e.bounds.width > W * 0.97, top = e.bounds.y < H * 0.03, bottom = e.bounds.y + e.bounds.height > H * 0.97;
    const x = left ? Math.min(0, e.bounds.x * s) : right ? TW - w + Math.max(0, (e.bounds.x + e.bounds.width - W) * s) : Math.min(TW - w, (e.bounds.x / W) * TW), y = top ? Math.min(0, e.bounds.y * s) : bottom ? TH - h + Math.max(0, (e.bounds.y + e.bounds.height - H) * s) : Math.min(TH - h, (e.bounds.y / H) * TH);
    push(e, { bounds: { x, y, width: w, height: h }, ...(e.text ? { text: scaleText(e.text, s) } : {}), ...(e.meta?.cornerRadius ? { meta: { ...e.meta, cornerRadius: r2(e.meta.cornerRadius * s) } } : {}) }); }
  const panelSlot = out.length; // panels are inserted here once the copy block is known

  // ---- 3. the picture element (product shot, card, cut-out) in its region
  if (hero && picture && heroIsPhoto) {
    const cr0 = hero.meta?.crop || { x: 0, y: 0, w: 1, h: 1 }; const fx = (focal[0] - hero.bounds.x) / hero.bounds.width, fy = (focal[1] - hero.bounds.y) / hero.bounds.height; // focal as a fraction of the element
    const win = cropFor(hero.bounds.width, hero.bounds.height, picture, [fx * hero.bounds.width, fy * hero.bounds.height]);
    push(hero, { bounds: picture, meta: { ...(hero.meta || {}), crop: { x: cr0.x + win.x * cr0.w, y: cr0.y + win.y * cr0.h, w: win.w * cr0.w, h: win.h * cr0.h } } });
    // a card or badge that sat on the photo keeps its place on it
    const sx = picture.width / (win.w * hero.bounds.width), sy = picture.height / (win.h * hero.bounds.height);
    for (const e of riders) { const rx = picture.x + (e.bounds.x - hero.bounds.x - win.x * hero.bounds.width) * sx, ry = picture.y + (e.bounds.y - hero.bounds.y - win.y * hero.bounds.height) * sy; const s = Math.min(sx, sy); const w = e.bounds.width * s, h = e.bounds.height * s; push(e, { bounds: { x: Math.min(Math.max(picture.x + gap, rx), picture.x + picture.width - w - gap), y: Math.min(Math.max(picture.y + gap, ry), picture.y + picture.height - h - gap), width: w, height: h } }); }
  } else if (hero && picture) { const pad = photoLike ? gap : 0; const rw = picture.width - 2 * pad - (landscape ? m : 0), rh = picture.height - 2 * pad; const s = Math.min(rw / hero.bounds.width, rh / hero.bounds.height, photoLike ? 0.75 * rh / hero.bounds.height : 10); const w = hero.bounds.width * s, h = hero.bounds.height * s;
    const x = landscape ? picture.x + (picture.width - w) / 2 : photoLike ? picture.x + picture.width - w - m : picture.x + (picture.width - w) / 2, y = picture.y + (picture.height - h) / 2; push(hero, { bounds: { x, y, width: w, height: h } }); }
  else if (hero && !picture) { const s = Math.min(colW * 0.5 / hero.bounds.width, TH * 0.3 / hero.bounds.height); push(hero, { bounds: { x: TW - m - hero.bounds.width * s, y: safeTop, width: hero.bounds.width * s, height: hero.bounds.height * s } }); }

  const regionBottom = legalTop - (legal.length ? gap : 0);
  const ordered = [...texts].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  const plan = (kk) => { let y = 0; const items = []; for (const e of ordered) { const fs = Math.max(e === headline ? hMin : minBody, sizeFor(e) * kk / k); const mm = measure(ctx, e, fs, colW); items.push([e, { bounds: { x: colX, y, width: colW, height: mm.height }, text: { ...mm.text, align: alignOf(e) } }]); y += mm.height + Math.round(fs * (e === headline ? 0.5 : 0.45)); } return { items, height: y }; };
  let kk = k, p = plan(kk); const actionH = () => (action.length ? union(action).height * Math.min(kk, colW / union(action).width) + gap : 0);
  for (let i = 0; i < 8 && p.height + actionH() > regionBottom - msgTop && kk > k * 0.5; i++) { kk *= 0.92; p = plan(kk); }
  const actionOut = []; let gh = 0, gw = 0;
  if (action.length) { const gb = union(action); const label = action.find((e) => e.type === 'text'); let s = Math.min(kk, colW / gb.width); if (label) s = Math.max(s, minBody * 1.05 / label.text.fontSize); gw = gb.width * s; gh = gb.height * s;
    for (const e of action) actionOut.push([e, { bounds: scaleBox({ x: e.bounds.x - gb.x, y: e.bounds.y - gb.y, width: e.bounds.width, height: e.bounds.height }, s), ...(e.text ? { text: scaleText(e.text, s) } : {}), ...(e.meta?.cornerRadius ? { meta: { ...e.meta, cornerRadius: r2(e.meta.cornerRadius * s) } } : {}) }]); }
  const blockH = p.height + (action.length ? gh : 0); const free = Math.max(0, regionBottom - msgTop - blockH);
  const blockTop = msgTop + Math.round(free * (landscape ? 0.45 : composition === 'photo-band' ? 0.3 : 0.3));
  p.items.forEach(([, patch]) => { patch.bounds.y += blockTop; });
  const centred = !landscape && texts.length && texts.every((e) => e.text.align === 'center');
  const actionX = centred ? (TW - gw) / 2 : colX, actionY = blockTop + p.height;
  actionOut.forEach(([, patch]) => { patch.bounds.x += actionX; patch.bounds.y += actionY; });

  // a colour panel that held the copy in the master is reshaped to the new copy block; on a photo the block gets one anyway
  const blockBottom = actionY + (action.length ? gh : 0); const pad = Math.round(gap * 1.6);
  const panelBox = composition === 'photo-band' ? { x: 0, y: blockTop - pad, width: TW, height: blockBottom - blockTop + pad * 2 } : { x: colX - pad, y: blockTop - pad, width: colW + pad * 2, height: blockBottom - blockTop + pad * 2 };
  if (panels.length) { const e = panels.sort((a, b) => area(b) - area(a))[0]; out.splice(panelSlot, 0, { ...e, artboardId: 0, zIndex: 0, bounds: landscape && photoLike ? { x: textSide === 'left' ? 0 : picture.x + picture.width, y: 0, width: picture.x || TW - picture.width, height: TH } : panelBox, meta: { ...e.meta, cornerRadius: landscape && photoLike ? 0 : Math.min(e.meta?.cornerRadius || 0, pad) } }); }
  else if (photoLike && !picture) out.splice(panelSlot, 0, { ...rect('el_panel', 'Text panel', panelBox, fieldHex, { opacity: 0.94, meta: { kind: 'rect', cornerRadius: Math.round(gap * 0.6), addedBy: 'adapt' } }), zIndex: 0 });
  for (const [e, patch] of p.items) push(e, patch);
  for (const [e, patch] of actionOut) push(e, patch);
  for (const [e, patch] of legalOut) push(e, patch);
  out.forEach((e, i) => (e.zIndex = i));
  if (import.meta.env?.DEV) console.info('[adapt]', preset.id, composition, info ? { kind: info.kind, coverage: +info.coverage.toFixed(2), spread: +info.meanSpread.toFixed(1), field: info.fieldHex, clusters: info.clusters.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height), c.cells]) } : 'no art', { heroIsPhoto, photoLike, hasPicture, fieldHex, focal: focal.map(Math.round) });
  return finish(composition, `${composition}${info ? ' · ' + info.kind : ''}`);
}
