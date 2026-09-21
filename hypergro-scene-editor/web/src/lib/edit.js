// Pure editing helpers behind the Canva-style commands. Each returns ops ([{id,set}]) or a new scene; App applies them
// through the normal undo history. Nothing here touches the DOM.
import { unionBounds } from './snap.js';

const leaf = (sc, ids) => ids.map((i) => sc.elements.find((e) => e.id === i)).filter((e) => e && e.type !== 'group');
export const unlocked = (sc, ids) => leaf(sc, ids).filter((e) => !e.locked);

// ---- align / distribute. One item aligns to the page, several align to their own bounding box (as Canva does).
export function alignOps(sc, ids, how) {
  const els = unlocked(sc, ids); if (!els.length) return [];
  const box = els.length > 1 ? unionBounds(els.map((e) => e.bounds)) : { x: 0, y: 0, width: sc.document.width, height: sc.document.height };
  return els.map((e) => { const b = e.bounds; const set = {
    left: { x: box.x }, center: { x: box.x + (box.width - b.width) / 2 }, right: { x: box.x + box.width - b.width },
    top: { y: box.y }, middle: { y: box.y + (box.height - b.height) / 2 }, bottom: { y: box.y + box.height - b.height } }[how];
    return { id: e.id, set: { bounds: Object.fromEntries(Object.entries(set).map(([k, v]) => [k, Math.round(v)])) } }; });
}
export function distributeOps(sc, ids, axis) {
  const els = unlocked(sc, ids); if (els.length < 3) return [];
  const p = axis === 'x' ? 'x' : 'y', s = axis === 'x' ? 'width' : 'height'; const sorted = [...els].sort((a, b) => a.bounds[p] - b.bounds[p]);
  const first = sorted[0].bounds, last = sorted[sorted.length - 1].bounds; const total = sorted.reduce((n, e) => n + e.bounds[s], 0);
  const gap = (last[p] + last[s] - first[p] - total) / (sorted.length - 1); let at = first[p];
  return sorted.map((e) => { const o = { id: e.id, set: { bounds: { [p]: Math.round(at) } } }; at += e.bounds[s] + gap; return o; });
}

// ---- clipboard (kept in memory and mirrored to localStorage so it survives moving between creatives)
const KEY = 'hg:clipboard';
export function copyElements(sc, ids, assets = {}) {
  const els = leaf(sc, ids); if (!els.length) return 0;
  // Pictures travel with the copy when they have a lasting address (not a browser-only blob), so paste works in another creative.
  const assetUrls = {}; for (const e of els) for (const pth of [e.asset, e.assetSvg]) if (pth && assets[pth] && !/^blob:/.test(assets[pth])) assetUrls[pth] = assets[pth];
  const clip = { at: Date.now(), from: sc.document?.name || '', elements: structuredClone(els), assetUrls };
  try { localStorage.setItem(KEY, JSON.stringify(clip)); } catch { /* private window: memory only */ } copyElements.last = clip; return els.length;
}
export const readClipboard = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || copyElements.last || null; } catch { return copyElements.last || null; } };
export function pasteElements(sc, clip, nth = 1) {
  if (!clip?.elements?.length) return { scene: sc, ids: [] };
  const taken = new Set(sc.elements.map((e) => e.id)); const fresh = (id) => { let n = 2, c = `${id}_p`; while (taken.has(c)) c = `${id}_p${n++}`; taken.add(c); return c; };
  const z0 = Math.max(0, ...sc.elements.map((e) => e.zIndex)) + 1; const off = 24 * nth; const W = sc.document.width, H = sc.document.height; const groups = {};
  const copies = [...clip.elements].sort((a, b) => a.zIndex - b.zIndex).map((e, i) => { let sg = e.semanticGroup; if (sg) { groups[sg] = groups[sg] || `${sg}_p${z0}`; sg = groups[sg]; }
    const b = { ...e.bounds, x: Math.min(Math.max(0, e.bounds.x + off), Math.max(0, W - 20)), y: Math.min(Math.max(0, e.bounds.y + off), Math.max(0, H - 20)) };
    return { ...e, id: fresh(e.id), bounds: b, zIndex: z0 + i, semanticGroup: sg, locked: false }; });
  return { scene: { ...sc, elements: [...sc.elements, ...copies] }, ids: copies.map((c) => c.id) };
}

// ---- group / ungroup: a group is a shared semanticGroup, which move, duplicate and delete already honour
export const groupOps = (sc, ids) => { const els = unlocked(sc, ids); if (els.length < 2) return []; const g = 'user_' + Date.now().toString(36); return els.map((e) => ({ id: e.id, set: { semanticGroup: g } })); };
export const ungroupOps = (sc, ids) => { const gs = new Set(leaf(sc, ids).map((e) => e.semanticGroup).filter((g) => g && g.startsWith('user_'))); return sc.elements.filter((e) => gs.has(e.semanticGroup)).map((e) => ({ id: e.id, set: { semanticGroup: null } })); };
export const groupMembers = (sc, id) => { const e = sc.elements.find((x) => x.id === id); return e?.semanticGroup?.startsWith('user_') ? sc.elements.filter((x) => x.semanticGroup === e.semanticGroup).map((x) => x.id) : [id]; };

// ---- new items
const base = (sc, id, type, name, bounds) => ({ id, type, name, parentId: null, artboardId: sc.document.activeArtboard ?? 0, zIndex: Math.max(0, ...sc.elements.map((e) => e.zIndex)) + 1, bounds, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: null, gradient: null, stroke: null, opacity: 1, blendMode: 'normal', asset: null, assetSvg: null, editable: true, locked: false, visible: true, role: type === 'text' ? 'body' : 'image', meta: { addedBy: 'user' } });
export function newTextElement(sc, { family = 'Lato', color = '#1A1A1A' } = {}) {
  const W = sc.document.width, H = sc.document.height; const fs = Math.max(14, Math.round(Math.min(W, H) * 0.045)); const w = Math.round(W * 0.5), h = Math.round(fs * 1.3);
  return { ...base(sc, 'el_txt_u' + Date.now().toString(36), 'text', 'New text', { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), width: w, height: h }), fill: color,
    text: { content: 'Your text here', fontFamily: family, fontStyle: 'Regular', postScriptName: null, fontSize: fs, lineHeight: Math.round(fs * 1.25), letterSpacing: 0, align: 'center', kind: 'area', mixed: false } };
}
export function newImageElement(sc, path, name, iw, ih) {
  const W = sc.document.width, H = sc.document.height; const k = Math.min(1, (W * 0.5) / iw, (H * 0.5) / ih); const w = Math.round(iw * k), h = Math.round(ih * k);
  return { ...base(sc, 'el_img_u' + Date.now().toString(36), 'image', name || 'Image', { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), width: w, height: h }), asset: path, meta: { addedBy: 'user', pixelWidth: iw, pixelHeight: ih } };
}

// ---- text helpers
export const toggleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[.!?]\s+|\n)([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()) : s.toUpperCase());
const BULLET = /^\s*(?:[•\-–*]|\d+[.)])\s+/;
export function toggleList(content, kind) { // kind: 'bullet' | 'number'
  const lines = String(content).split('\n'); const has = (re) => lines.filter((l) => l.trim()).every((l) => re.test(l));
  const isBullet = has(/^\s*[•\-–*]\s+/), isNumber = has(/^\s*\d+[.)]\s+/); const bare = lines.map((l) => l.replace(BULLET, ''));
  if ((kind === 'bullet' && isBullet) || (kind === 'number' && isNumber)) return bare.join('\n');
  let n = 0; return bare.map((l) => (l.trim() ? (kind === 'bullet' ? '• ' : `${++n}. `) + l : l)).join('\n');
}
export const listKind = (content) => { const ls = String(content).split('\n').filter((l) => l.trim()); if (!ls.length) return null; return ls.every((l) => /^\s*[•\-–*]\s+/.test(l)) ? 'bullet' : ls.every((l) => /^\s*\d+[.)]\s+/.test(l)) ? 'number' : null; };
// Style words: "Bold Italic" <-> flags
export const isBoldStyle = (s) => /bold|black|heavy|semibold|demibold/i.test(s || '');
export const isItalicStyle = (s) => /italic|oblique/i.test(s || '');
export const styleFrom = (bold, italic) => (bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular');

// ---- resize the whole creative, keeping its shape: every position, size and type size scales by k
export function resizeScene(sc, newWidth) {
  const k = newWidth / sc.document.width; if (!isFinite(k) || k <= 0 || Math.abs(k - 1) < 1e-6) return sc; const r = (v) => Math.round(v * k * 100) / 100;
  return { ...sc, document: { ...sc.document, width: r(sc.document.width), height: r(sc.document.height), artboards: (sc.document.artboards || []).map((a) => ({ ...a, width: r(a.width), height: r(a.height) })) },
    elements: sc.elements.map((e) => ({ ...e, bounds: { x: r(e.bounds.x), y: r(e.bounds.y), width: r(e.bounds.width), height: r(e.bounds.height) },
      ...(e.text ? { text: { ...e.text, fontSize: r(e.text.fontSize), lineHeight: e.text.lineHeight ? r(e.text.lineHeight) : e.text.lineHeight, letterSpacing: e.text.letterSpacing ? r(e.text.letterSpacing) : e.text.letterSpacing } } : {}),
      ...(e.meta?.cornerRadius ? { meta: { ...e.meta, cornerRadius: r(e.meta.cornerRadius) } } : {}) })) };
}

// ---- crop. meta.crop = {x,y,w,h} as fractions of the source picture. The box shrinks with the crop so the picture
// keeps its scale on the creative. `prev` is the crop the box currently shows (null = whole picture).
export function cropSet(el, next) {
  const prev = el.meta?.crop || { x: 0, y: 0, w: 1, h: 1 }; const b = el.bounds; const fullW = b.width / prev.w, fullH = b.height / prev.h; const ox = b.x - prev.x * fullW, oy = b.y - prev.y * fullH;
  const whole = next.w > 0.999 && next.h > 0.999;
  return { bounds: { x: Math.round(ox + next.x * fullW), y: Math.round(oy + next.y * fullH), width: Math.round(next.w * fullW), height: Math.round(next.h * fullH) }, meta: { crop: whole ? null : { x: next.x, y: next.y, w: next.w, h: next.h } } };
}
/** CSS for a cropped background image. */
export const cropCss = (crop) => (crop ? { backgroundSize: `${100 / crop.w}% ${100 / crop.h}%`, backgroundPosition: `${crop.w < 1 ? (crop.x / (1 - crop.w)) * 100 : 0}% ${crop.h < 1 ? (crop.y / (1 - crop.h)) * 100 : 0}%` } : null);
