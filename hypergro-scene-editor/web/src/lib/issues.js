// Live guardrail checks: text overflow, tiny logos, safe-zone violations, unavailable fonts, missing assets, plus
// notes from ingestion. Every issue carries an action the panel can run.
import { fontString, wrapLines, lineHeightOf, assetUrl, isCssShape } from './render.js';
import { isBrandColor, nearestBrandColor, isBrandFont, brandFontFor } from './brand.js';
import { libraryHas } from './fontlib.js';
let ctx = null; const measure = () => (ctx ||= document.createElement('canvas').getContext('2d'));
const fontCache = new Map();
export const SAFE = 0.04; // safe-zone margin as a fraction of the shorter side
export const safeMargin = (W, H) => Math.round(Math.min(W, H) * SAFE);

// Width-comparison trick: a family that falls back to the generic font measures identically to the generic font alone.
export function fontAvailable(family) {
  if (!family) return true; if (libraryHas(family)) return true; // on file (a partial font would fail the probe: it only has the creative's letters)
  if (fontCache.has(family)) return fontCache.get(family);
  const c = measure(), probe = 'mmmmmmmmmmlliWWW@0123'; const w = (f) => { c.font = `72px ${f}`; return c.measureText(probe).width; };
  const ok = ['monospace', 'serif', 'sans-serif'].some((fb) => w(`"${family}", ${fb}`) !== w(fb));
  fontCache.set(family, ok); return ok;
}
export const forgetFonts = () => fontCache.clear();

export function textFit(e) {
  const t = e.text, c = measure(); c.font = fontString(t); if ('letterSpacing' in c) c.letterSpacing = (t.letterSpacing || 0) + 'px';
  const lines = wrapLines(c, t.content, t.kind === 'point' ? Infinity : e.bounds.width);
  const maxW = Math.max(0, ...lines.map((l) => c.measureText(l).width)), h = lines.length * lineHeightOf(t);
  const wOk = maxW <= e.bounds.width * 1.02 + 2, hOk = t.kind === 'point' || h <= e.bounds.height * 1.05 + 2;
  return { ok: wOk && hOk, maxW, h, lines: lines.length, wOk, hOk };
}
/** Largest font size (≥ 8) at which the text fits its box. */
export function fitFontSize(e) { let fs = e.text.fontSize; while (fs > 8) { const probe = { ...e, text: { ...e.text, fontSize: fs, lineHeight: e.text.lineHeight ? e.text.lineHeight * fs / e.text.fontSize : null } }; if (textFit(probe).ok) break; fs = Math.round((fs - 1) * 10) / 10; } return fs; }

export function computeIssues(scene, assets, W, H, kit = null) {
  if (!scene) return [];
  const out = [];
  const leaves = scene.elements.filter((e) => e.type !== 'group' && e.visible);
  for (const f of [...new Set(scene.elements.filter((e) => e.type !== 'group' && e.visible && e.text?.fontFamily).map((e) => e.text.fontFamily))]) {
    if (!fontAvailable(f)) out.push({ id: 'font:' + f, severity: 'warn', title: `Font “${f}” isn’t available on this computer`, detail: 'The canvas and exports use a fallback font, so text may look different from the original. Install the font, or replace it in the creative.', action: { type: 'replaceFont', family: f, label: 'Replace font…' } });
  }
  for (const e of leaves) {
    const b = e.bounds;
    if (e.type === 'text' && e.text.content.trim()) {
      const fit = textFit(e);
      if (!fit.ok) out.push({ id: 'overflow:' + e.id, severity: 'warn', elementId: e.id, title: `“${e.name}” overflows its box`, detail: !fit.wOk ? `The text is ${Math.round(fit.maxW - b.width)} px wider than its box and may be cut off or overlap other elements.` : 'It needs more lines than the box can hold.', action: { type: 'fitText', elementId: e.id, label: 'Shrink to fit' } });
    }
    if (e.role === 'logo' && e.type !== 'text' && b.height < Math.max(20, H * 0.03))
      out.push({ id: 'logo:' + e.id, severity: 'warn', elementId: e.id, title: 'The logo is very small', detail: `It is ${Math.round(b.height)} px tall; keep it at least ${Math.round(Math.max(20, H * 0.03))} px so it stays legible.`, action: { type: 'select', elementId: e.id, label: 'Select' } });
    if (e.type !== 'text' && !isCssShape(e) && !assetUrl(e, assets))
      out.push({ id: 'asset:' + e.id, severity: 'error', elementId: e.id, title: `Image missing for “${e.name}”`, detail: 'The bundle has no file for this element, so a placeholder is shown. Replace the image or re-export from Illustrator.', action: { type: 'select', elementId: e.id, label: 'Select' } });
  }
  if (kit) for (const e of leaves) {
    const fill = e.type === 'text' || (isCssShape(e) && e.role !== 'background') ? e.fill : null;
    if (fill && !isBrandColor(kit, fill)) { const n = nearestBrandColor(kit, fill); out.push({ id: 'brandcolor:' + e.id, severity: 'info', elementId: e.id, title: `“${e.name}” uses an off-brand colour`, detail: `${fill.toUpperCase()} isn’t in the ${kit.name} palette. The closest brand colour is ${n.name} (${n.hex}).`, action: { type: 'brandColor', elementId: e.id, hex: n.hex, name: n.name, label: `Use ${n.name}` } }); }
    if (e.type === 'text' && e.text.fontFamily && !isBrandFont(kit, e.text.fontFamily)) { const f = brandFontFor(kit, e.role); out.push({ id: 'brandfont:' + e.id, severity: 'info', elementId: e.id, title: `“${e.name}” uses ${e.text.fontFamily}, not a brand font`, detail: `${kit.name} uses ${kit.fonts.headline.family} for headlines and ${kit.fonts.body.family} for everything else.`, action: { type: 'brandFont', elementId: e.id, family: f, label: `Use ${f}` } }); }
  }
  for (const w of scene.warnings || []) { if (/not embedded|No Anthropic credentials|classification failed/i.test(w)) continue; out.push({ id: 'warn:' + w, severity: 'info', title: w.replace(/^classify: /, 'AI note: '), detail: '' }); }
  const rank = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
