// What sits behind a logo, and which approved version of the logo belongs on it. The brand book allows three
// surfaces: light backgrounds (blue + orange wordmark), Federal Blue / dark images (white + orange), and Golden Glow
// (blue + white). We render the creative without the logo, average the pixels under its box, and map the colour.
import { renderToCanvas } from './render.js';

const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export function classifySurface(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 510;
  const s = d === 0 ? 0 : d / (255 - Math.abs(max + min - 255));
  let h = 0; if (d) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  if (s > 0.55 && h >= 15 && h <= 55 && l > 0.3) return 'orange'; // Golden Glow and its neighbours
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum < 0.3 ? 'dark' : 'light';
}
export const SURFACE_LABEL = { light: 'a light background', dark: 'a dark background', orange: 'Golden Glow' };

/** Average colour under `bounds`, with the given elements hidden (the logo itself and its group). */
export async function surfaceUnder(scene, assets, bounds, hideIds = []) {
  const W = scene.document.width, H = scene.document.height; const scale = Math.min(1, 360 / Math.max(W, H));
  const hide = new Set(hideIds);
  const sc = { ...scene, elements: scene.elements.map((e) => (hide.has(e.id) ? { ...e, visible: false } : e)) };
  const c = await renderToCanvas(sc, assets, scale);
  const x0 = Math.max(0, Math.floor(bounds.x * scale)), y0 = Math.max(0, Math.floor(bounds.y * scale));
  const w = Math.max(1, Math.min(c.width - x0, Math.round(bounds.width * scale))), h = Math.max(1, Math.min(c.height - y0, Math.round(bounds.height * scale)));
  const d = c.getContext('2d').getImageData(x0, y0, w, h).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  return { surface: classifySurface(r, g, b), hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() };
}

export const kitLogoOf = (kit, el) => (kit && el?.meta?.logo ? kit.logos.find((l) => l.id === el.meta.logo) || null : null);
/** The approved version for a surface, keeping the same kind (wordmark / insignia / lockup) when one exists. */
export const logoFor = (kit, surface, kind) => (kit ? kit.logos.find((l) => l.on === surface && l.kind === kind) || kit.logos.find((l) => l.on === surface) || null : null);
