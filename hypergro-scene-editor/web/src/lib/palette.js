// Brand swatches derived from the creative itself: the colours it already uses, most-used first.
import { hex } from './render.js';
export function brandPalette(scene) {
  const count = new Map(); const add = (c) => { if (!c || c === 'transparent') return; const h = hex(c).toUpperCase(); count.set(h, (count.get(h) || 0) + 1); };
  for (const e of scene?.elements || []) { if (e.type === 'group' || !e.visible) continue; add(e.fill); add(e.meta?.coverFill); add(e.stroke?.color); }
  const cols = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  for (const c of ['#FFFFFF', '#1C1B19']) if (!cols.includes(c)) cols.push(c);
  return cols.slice(0, 12);
}
export const FONT_CHOICES = ['Inter', 'Roboto', 'Open Sans', 'Poppins', 'Montserrat', 'Lato', 'Nunito', 'Manrope', 'DM Sans', 'Work Sans', 'Playfair Display', 'Merriweather', 'Oswald', 'Bebas Neue', 'Helvetica', 'Arial', 'Georgia'];
export const STYLE_CHOICES = ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Italic', 'Bold Italic', 'Light'];
