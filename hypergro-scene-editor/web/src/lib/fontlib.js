// The team's font library (fonts uploaded to the server). Each face becomes an @font-face rule under its family name,
// and also under its PostScript and full names so that creatives ingested before the font arrived still match.
let fonts = []; const families = new Set(), fullFamilies = new Set(); let styleEl = null;

export const libraryFonts = () => fonts;
export const libraryHas = (family) => !!family && families.has(family.toLowerCase());
/** True only when a complete font file is on file. A partial font (pulled out of a designer's file) has just that file's letters. */
export const libraryHasFull = (family) => !!family && fullFamilies.has(family.toLowerCase());
export const legacyFont = (family) => (family ? fonts.find((f) => !f.error && f.legacy && [f.family, f.fullName, f.postScriptName].some((n) => n && n.toLowerCase() === family.toLowerCase())) || null : null);

let readyResolve; export const libraryReady = new Promise((r) => { readyResolve = r; }); // settles after the first scan, so nobody asks Google for a font the team already has
export async function loadFontLibrary() {
  try { fonts = await (await fetch('/api/fontlib')).json(); } catch { fonts = []; }
  families.clear(); fullFamilies.clear();
  const rules = [];
  for (const f of [...fonts].sort((a, b) => (a.subset ? 1 : 0) - (b.subset ? 1 : 0))) { // full fonts first, subsets last: the later rule wins for the letters it covers
    if (f.error) continue;
    const names = [...new Set([f.family, f.fullName, f.postScriptName].filter(Boolean))];
    for (const name of names) {
      families.add(name.toLowerCase()); if (!f.subset) fullFamilies.add(name.toLowerCase());
      // a subset whose letter coverage could not be read would shadow the full font for every letter: leave it out
      if (f.subset && !f.unicodeRange && fonts.some((g) => !g.subset && !g.error && g.family === f.family)) continue;
      // A partial font only answers for the letters it really has; the browser takes every other letter from the full family (or the fallback).
      rules.push(`@font-face{font-family:"${name.replace(/"/g, '')}";src:url("/api/fontlib/file/${encodeURIComponent(f.file)}${f.subset ? '?subset=1' : ''}");font-weight:${f.weight || 400};font-style:${f.italic ? 'italic' : 'normal'};font-display:block${f.subset && f.unicodeRange ? `;unicode-range:${f.unicodeRange}` : ''}}`);
    }
  }
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'hg-fontlib'; document.head.appendChild(styleEl); }
  styleEl.textContent = rules.join('\n');
  await Promise.all(fonts.filter((f) => !f.error).map((f) => document.fonts.load(`${f.weight || 400} 16px "${f.family}"`).catch(() => {})));
  readyResolve?.(); return fonts;
}

/** Point extracted text at a library face when its PostScript name is on file (creatives ingested before the upload). */
export function mapSceneFonts(scene) {
  if (!scene || !fonts.length) return scene;
  const byPs = new Map(fonts.filter((f) => !f.error).flatMap((f) => [[norm(f.postScriptName), f], [norm(f.fullName), f]]).filter(([k]) => k));
  for (const e of scene.elements) {
    if (!e.text) continue;
    const ps = e.text.postScriptName; const hit = ps && !e.meta?.fontMapped ? byPs.get(norm(ps)) : null;
    if (hit) { e.text = { ...e.text, fontFamily: hit.family, fontStyle: hit.style || e.text.fontStyle }; e.meta = { ...(e.meta || {}), fontMapped: hit.file }; }
    const lf = legacyFont(e.text.fontFamily);
    if (lf && e.text.encoding !== 'legacy') { e.text = { ...e.text, encoding: 'legacy' }; e.meta = { ...(e.meta || {}), legacyFont: lf.family, legacyScript: lf.legacyScript }; }
    else if (!lf && e.text.encoding === 'legacy' && !fonts.some((f) => f.legacy && f.family === e.text.fontFamily)) { const { encoding, ...rest } = e.text; e.text = rest; }
  }
  return scene;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');

export async function uploadFont(file) {
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch('/api/fontlib', { method: 'POST', body: fd }); const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  await loadFontLibrary();
  return j;
}
