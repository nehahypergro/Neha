// The team's font library (fonts uploaded to the server). Each face becomes an @font-face rule under its family name,
// and also under its PostScript and full names so that creatives ingested before the font arrived still match.
let fonts = []; const families = new Set(); let styleEl = null;

export const libraryFonts = () => fonts;
export const libraryHas = (family) => !!family && families.has(family.toLowerCase());
export const legacyFont = (family) => (family ? fonts.find((f) => !f.error && f.legacy && [f.family, f.fullName, f.postScriptName].some((n) => n && n.toLowerCase() === family.toLowerCase())) || null : null);

export async function loadFontLibrary() {
  try { fonts = await (await fetch('/api/fontlib')).json(); } catch { fonts = []; }
  families.clear();
  const rules = [];
  for (const f of fonts) {
    if (f.error) continue;
    const names = [...new Set([f.family, f.fullName, f.postScriptName].filter(Boolean))];
    for (const name of names) {
      families.add(name.toLowerCase());
      rules.push(`@font-face{font-family:"${name.replace(/"/g, '')}";src:url("/api/fontlib/file/${encodeURIComponent(f.file)}");font-weight:${f.weight || 400};font-style:${f.italic ? 'italic' : 'normal'};font-display:block}`);
    }
  }
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'hg-fontlib'; document.head.appendChild(styleEl); }
  styleEl.textContent = rules.join('\n');
  await Promise.all(fonts.filter((f) => !f.error).map((f) => document.fonts.load(`${f.weight || 400} 16px "${f.family}"`).catch(() => {})));
  return fonts;
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
