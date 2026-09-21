// Load the scene's font families from Google Fonts when available; families that are not hosted there (Helvetica,
// brand fonts) fall back to whatever is installed locally. Stylesheet links are used instead of fetch so that a
// missing family fails silently rather than tripping CORS errors in the console.
const tried = new Set();
import { extraFallbacks } from './render.js';
import { libraryHas } from './fontlib.js';
// Unicode blocks → Google Fonts family that covers them. Loaded on demand when copy in that script appears.
export const SCRIPT_FONTS = [[/[\u0D00-\u0D7F]/, 'Noto Sans Malayalam'], [/[\u0900-\u097F]/, 'Noto Sans Devanagari'], [/[\u0B80-\u0BFF]/, 'Noto Sans Tamil'], [/[\u0C00-\u0C7F]/, 'Noto Sans Telugu'], [/[\u0C80-\u0CFF]/, 'Noto Sans Kannada'], [/[\u0A80-\u0AFF]/, 'Noto Sans Gujarati'], [/[\u0980-\u09FF]/, 'Noto Sans Bengali'], [/[\u0A00-\u0A7F]/, 'Noto Sans Gurmukhi'], [/[\u0600-\u06FF]/, 'Noto Sans Arabic']];
export const scriptFontsFor = (text) => SCRIPT_FONTS.filter(([re]) => re.test(text || '')).map(([, f]) => f);
const loadLink = (href) => new Promise((res, rej) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = () => res(l); l.onerror = () => { l.remove(); rej(new Error('no font: ' + href)); }; document.head.appendChild(l); });

export async function ensureFonts(scene) {
  const copy = scene.elements.map((e) => e.text?.content || '').join('\n');
  const scripts = scriptFontsFor(copy); scripts.forEach((f) => { if (!extraFallbacks.includes(f)) extraFallbacks.push(f); });
  const fams = [...new Set([...scene.elements.filter((e) => e.text?.fontFamily).map((e) => e.text.fontFamily), ...scripts])];
  await Promise.all(fams.map(async (f) => {
    if (tried.has(f) || libraryHas(f) || /^(helvetica|arial|times|courier|georgia|verdana)/i.test(f)) return; tried.add(f);
    const fam = encodeURIComponent(f).replace(/%20/g, '+');
    for (const q of [`${fam}:ital,wght@0,100..900;1,100..900`, `${fam}:ital,wght@0,300;0,400;0,700;0,900;1,400;1,700`, `${fam}:wght@300;400;500;600;700`, `${fam}:wght@400;700`, fam]) {
      try { await loadLink(`https://fonts.googleapis.com/css2?family=${q}&display=swap`); await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 16px "${f}"`).catch(() => {}))); return; } catch {}
    }
  }));
  try { await document.fonts.ready; } catch {}
}
