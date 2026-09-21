// Brand kit: colours, fonts, logos and rules loaded from /brand/<id>/brand.json. Everything here is pure helpers;
// the App decides how to surface them (swatches, font choices, the Brand tab, off-brand issues, assistant context).
import { hex as toHex } from './render.js';

export async function loadBrand(id = 'federal-bank') {
  const r = await fetch(`/brand/${id}/brand.json`); if (!r.ok) throw new Error(`brand kit ${id} not found`);
  const kit = await r.json(); kit.base = `/brand/${id}/`;
  return kit;
}

/** Flat colour list in priority order: [{hex, name, group}]. */
export const brandColors = (kit) => (kit ? ['primary', 'secondary', 'tertiary'].flatMap((g) => (kit.colors[g] || []).map((c) => ({ ...c, hex: c.hex.toUpperCase(), group: g }))) : []);
export const brandHexes = (kit) => new Set(brandColors(kit).map((c) => c.hex));

const rgb = (h) => { const n = parseInt(toHex(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const colorDistance = (a, b) => { const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b); return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2); };
/** True when the colour is (nearly) one of the brand colours. Tolerance absorbs CMYK→RGB rounding in exported files. */
export const isBrandColor = (kit, h, tolerance = 14) => !!h && brandColors(kit).some((c) => colorDistance(c.hex, h) <= tolerance);
export const nearestBrandColor = (kit, h) => brandColors(kit).reduce((best, c) => { const d = colorDistance(c.hex, h); return !best || d < best.d ? { ...c, d } : best; }, null);
export const brandColorName = (kit, h) => brandColors(kit).find((c) => colorDistance(c.hex, h) <= 14)?.name || null;

/** Palette for swatch controls: brand primaries, then the creative's own colours, deduped. Full palette on demand. */
export function swatchPalette(kit, sceneColors, { full = false } = {}) {
  const out = []; const seen = new Set();
  const push = (hex, name, group) => { const h = toHex(hex).toUpperCase(); if (seen.has(h)) return; seen.add(h); out.push({ hex: h, name, group }); };
  for (const c of brandColors(kit)) if (full || c.group === 'primary') push(c.hex, c.name, c.group);
  for (const h of sceneColors || []) push(h, brandColorName(kit, h) || 'From the creative', 'creative');
  return out;
}

export const brandFontFamilies = (kit) => (kit ? [kit.fonts.headline.family, kit.fonts.body.family] : []);
export const brandFontFor = (kit, role) => (!kit ? null : role === 'headline' ? kit.fonts.headline.family : kit.fonts.body.family);
export const isBrandFont = (kit, family) => !kit || !family || [kit.fonts.headline.family, kit.fonts.body.family, kit.fonts.headline.fallback, kit.fonts.body.fallback].includes(family);

/** Compact description for the assistant's context. */
export const brandSummary = (kit) => (!kit ? null : {
  name: kit.name,
  colors: brandColors(kit).filter((c) => c.group !== 'tertiary').map((c) => `${c.name} ${c.hex}`),
  fonts: { headline: kit.fonts.headline.family, body: kit.fonts.body.family },
  rules: kit.rules,
});
