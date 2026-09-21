// Bundle bookkeeping beyond the scene itself: a small meta.json per creative (name, archived, what it replaced, what it
// was copied from, which language variant it is), an append-only events log (the audit trail), duplication for
// "start a new one like this" and language variants, and the upload readiness grade shown after ingest.
import { readFile, writeFile, readdir, stat, cp, rm, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const readMeta = async (dir) => { try { return JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')); } catch { return {}; } };
export async function writeMeta(dir, patch) { const m = { ...(await readMeta(dir)), ...patch, updatedAt: Date.now() }; await writeFile(path.join(dir, 'meta.json'), JSON.stringify(m, null, 2)); return m; }

/** Every creative on disk with its meta, thumbnail and state. Archived and replaced ones are hidden unless `all`. */
export async function listBundles(BUNDLES, { all = false } = {}) {
  const out = [];
  for (const id of await readdir(BUNDLES).catch(() => [])) {
    try {
      const dir = path.join(BUNDLES, id); if (!existsSync(path.join(dir, 'scene.json'))) continue;
      const s = JSON.parse(await readFile(path.join(dir, 'scene.json'), 'utf8')); const meta = await readMeta(dir);
      const auto = existsSync(path.join(dir, 'autosave.json')); const versions = (await readdir(path.join(dir, 'versions')).catch(() => [])).filter((f) => f.endsWith('.json')).length;
      const thumb = existsSync(path.join(dir, 'autosave.png')) ? `/bundles/${id}/autosave.png` : existsSync(path.join(dir, 'reference-0.png')) ? `/bundles/${id}/reference-0.png` : null;
      const updatedAt = auto ? (await stat(path.join(dir, 'autosave.json'))).mtimeMs : meta.updatedAt || Date.parse(s.source?.exportedAt || 0) || (await stat(path.join(dir, 'scene.json'))).mtimeMs;
      out.push({ id, bundle: `/bundles/${id}/`, name: meta.name || s.document.name, documentName: s.document.name, sourceFile: meta.sourceFile || path.basename(s.source?.file || '').replace(/-[a-z0-9]{7,10}(\.[^.]+)$/i, '$1'), width: s.document.width, height: s.document.height, elements: s.elements.length,
        createdAt: meta.createdAt || Date.parse(s.source?.exportedAt || 0) || updatedAt, updatedAt, thumb, versions, autosave: auto,
        archived: !!meta.archived, supersededBy: meta.supersededBy || null, replaces: meta.replaces || [], createdFrom: meta.createdFrom || null, variantOf: meta.variantOf || null, language: meta.language || null, readiness: meta.readiness || null });
    } catch {}
  }
  const visible = all ? out : out.filter((b) => !b.archived && !b.supersededBy);
  // language variants ride along with their parent
  const byParent = new Map(); for (const b of visible) if (b.variantOf) { if (!byParent.has(b.variantOf)) byParent.set(b.variantOf, []); byParent.get(b.variantOf).push({ id: b.id, language: b.language, name: b.name, thumb: b.thumb, updatedAt: b.updatedAt }); }
  for (const b of visible) b.variants = (byParent.get(b.id) || []).sort((a, c) => a.language.localeCompare(c.language));
  return visible.filter((b) => all || !b.variantOf || !visible.some((p) => p.id === b.variantOf)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200);
}

/** Copy a creative into a new bundle. The copy starts from the current auto-saved state (or `scene` when given). */
export async function duplicateBundle(BUNDLES, id, { name, language = null, variantOf = null, scene = null, slug } = {}) {
  const src = path.join(BUNDLES, id); if (!existsSync(path.join(src, 'scene.json'))) throw new Error('unknown bundle');
  const base = JSON.parse(await readFile(path.join(src, 'scene.json'), 'utf8'));
  const newId = `${slug(name || base.document.name)}-${Date.now().toString(36)}`; const dst = path.join(BUNDLES, newId);
  await cp(src, dst, { recursive: true, filter: (p) => !/\/(versions|events\.jsonl|autosave\.json|meta\.json)(\/|$)/.test(p.replace(src, '')) });
  let sc = scene; if (!sc) { try { sc = JSON.parse(await readFile(path.join(src, 'autosave.json'), 'utf8')).scene; } catch {} }
  sc = sc || base; sc = { ...sc, document: { ...sc.document, name: name || sc.document.name } };
  await writeFile(path.join(dst, 'scene.json'), JSON.stringify(sc, null, 2));
  await rm(path.join(dst, 'autosave.png'), { force: true });
  const srcMeta = await readMeta(src);
  await writeMeta(dst, { name: name || sc.document.name, createdFrom: id, language, variantOf, sourceFile: srcMeta.sourceFile || null, readiness: srcMeta.readiness || null, createdAt: Date.now() });
  return { id: newId, scene: sc };
}

/** Append-only audit log. Entries: {at, by, label}. Duplicates (same at + label) are skipped. */
export async function appendEvents(dir, entries) {
  const file = path.join(dir, 'events.jsonl'); const have = new Set((await readEvents(dir)).map((e) => e.at + '|' + e.label));
  const fresh = (entries || []).filter((e) => e && e.label && !have.has((e.at || 0) + '|' + e.label)).map((e) => ({ at: e.at || Date.now(), by: String(e.by || 'Someone').slice(0, 80), label: String(e.label).slice(0, 200) }));
  if (fresh.length) await appendFile(file, fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return fresh.length;
}
export async function readEvents(dir) { try { return (await readFile(path.join(dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }

/** Plain-language grade of what an upload will let a marketer edit. */
export function readiness(scene, extractStats = {}) {
  const els = scene.elements.filter((e) => e.type !== 'group');
  const texts = els.filter((e) => e.type === 'text' && e.visible);
  const live = texts.filter((e) => !e.meta?.overlay).length, reconstructed = texts.filter((e) => e.meta?.overlay).length, legacy = texts.filter((e) => e.text?.encoding === 'legacy').length;
  const fonts = (scene.fonts || []).map((f) => ({ family: f.family, style: f.style, onFile: !!f.onFile, embedded: !!f.embedded, legacy: f.library?.legacy || false }));
  const notOnFile = [...new Set(fonts.filter((f) => !f.onFile).map((f) => f.family))];
  const logosMovable = els.filter((e) => e.role === 'logo' && e.type === 'image').length;
  const logosBaked = (scene.warnings || []).filter((w) => /sits on a photo or gradient/.test(w)).length + (scene.warnings || []).filter((w) => /baked into the .*Artwork/i.test(w) && /logo|wordmark/i.test(w)).length;
  const photos = els.filter((e) => e.type === 'image' && !e.meta?.collapsedGroup && e.role !== 'logo').length;
  const items = [];
  if (live) items.push({ ok: true, text: `${live} line${live > 1 ? 's' : ''} of text can be edited` }); else if (reconstructed) items.push({ ok: false, text: 'The text is outlined, so the words were read from the picture. They can be edited but sizes and fonts are approximate.' }); else items.push({ ok: false, text: 'No text was found in this file' });
  if (reconstructed && live) items.push({ ok: false, text: `${reconstructed} line${reconstructed > 1 ? 's were' : ' was'} read from the picture (approximate)` });
  if (legacy) items.push({ ok: false, text: `${legacy} line${legacy > 1 ? 's are' : ' is'} typed in a legacy Indic font: can be moved and recoloured, not rewritten` });
  if (notOnFile.length) items.push({ ok: false, text: `Font${notOnFile.length > 1 ? 's' : ''} not on file: ${notOnFile.join(', ')}`, fonts: notOnFile }); else if (fonts.length) items.push({ ok: true, text: 'All fonts are on file' });
  if (logosMovable) items.push({ ok: true, text: `${logosMovable} logo${logosMovable > 1 ? 's' : ''} can be moved or swapped` });
  if (logosBaked) items.push({ ok: false, text: 'A logo sits inside the photo and cannot be moved on its own' });
  if (photos) items.push({ ok: true, text: `${photos} photo${photos > 1 ? 's' : ''} can be replaced` });
  const bad = items.filter((i) => !i.ok).length;
  return { grade: bad === 0 ? 'ready' : bad <= 2 && live ? 'partly' : 'limited', items, liveText: live, reconstructed, legacy, fontsNotOnFile: notOnFile, logosMovable, logosBaked, garbledRuns: extractStats.garbledRuns || 0 };
}
