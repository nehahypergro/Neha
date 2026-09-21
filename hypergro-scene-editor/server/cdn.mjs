// Media storage on the CDN. Every raster of a bundle (artwork layers, reference, cutouts, photos a marketer swaps in) is
// uploaded once and recorded in the bundle's cdn.json as { "<path in bundle>": "<cdn url>" }. The local copy is then only
// a cache: if it is missing (fresh server, wiped disk) the file is pulled back from the CDN on first request.
// The CDN sends no CORS headers, so browsers never read it directly; the server streams it under /bundles/… instead,
// which keeps canvas exports and PDF embedding same-origin.
// Off unless CDN_UPLOAD_URL is set. NOTE: CDN urls are public to anyone who has them.
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ENDPOINT = () => process.env.CDN_UPLOAD_URL || '';
export const cdnEnabled = () => !!ENDPOINT();
const MEDIA = /\.(png|jpe?g|webp|gif|svg)$/i;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

export async function uploadBuffer(buffer, filename) {
  const form = new FormData(); form.append('userFile', new Blob([buffer], { type: TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream' }), filename);
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(ENDPOINT(), { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
      const j = await r.json().catch(() => null); const url = j?.data?.fileUrl;
      if (r.ok && url) return { url, key: j.data.storageKeyName };
      last = new Error(`upload failed (${r.status}) ${j?.msg || ''}`.trim());
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  throw last;
}

const mapFile = (dir) => path.join(dir, 'cdn.json');
export const readMap = async (dir) => { try { return JSON.parse(await readFile(mapFile(dir), 'utf8')); } catch { return {}; } };
const writeMap = (dir, map) => writeFile(mapFile(dir), JSON.stringify(map, null, 1));

async function mediaFiles(dir, rel = '') {
  const out = []; for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) { const p = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) { if (e.name !== 'versions') out.push(...await mediaFiles(dir, p)); } else if (MEDIA.test(e.name)) out.push(p); }
  return out;
}

/** Upload every raster of a bundle that is not on the CDN yet. Returns { uploaded, failed }. */
export async function pushBundle(dir) {
  if (!cdnEnabled()) return { uploaded: 0, failed: 0, skipped: true };
  const map = await readMap(dir); let uploaded = 0, failed = 0;
  for (const rel of await mediaFiles(dir)) {
    if (map[rel]) continue;
    try { const { url } = await uploadBuffer(await readFile(path.join(dir, rel)), path.basename(rel)); map[rel] = url; uploaded++; await writeMap(dir, map); }
    catch (e) { failed++; console.error('[cdn]', rel, e.message); }
  }
  return { uploaded, failed };
}

/** Store one new file in a bundle (a swapped-in photo) and on the CDN. */
export async function storeAsset(dir, rel, buffer) {
  const file = path.join(dir, rel); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, buffer);
  if (!cdnEnabled()) return { path: rel, url: null };
  try { const { url } = await uploadBuffer(buffer, path.basename(rel)); const map = await readMap(dir); map[rel] = url; await writeMap(dir, map); return { path: rel, url }; }
  catch (e) { console.error('[cdn]', rel, e.message); return { path: rel, url: null }; }
}

/** Express middleware for /bundles: when the local copy is gone, restore it from the CDN, then let static serve it. */
export const restoreFromCdn = (root) => async (req, res, next) => {
  try {
    const parts = decodeURIComponent(req.path).split('/').filter(Boolean); if (parts.length < 2 || parts.some((p) => p === '..')) return next();
    const [id, ...rest] = parts; const rel = rest.join('/'); if (!MEDIA.test(rel)) return next();
    const dir = path.join(root, id), file = path.join(dir, rel); if (existsSync(file)) return next();
    const url = (await readMap(dir))[rel]; if (!url) return next();
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) }); if (!r.ok) return next();
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, Buffer.from(await r.arrayBuffer()));
  } catch (e) { console.error('[cdn] restore', e.message); }
  next();
};

// ---------------------------------------------------------------------------------------------------------------------
// Everything else: scene data, autosaves, saved copies, the audit record, fonts and the designer's original file.
// The upload service only ever creates new addresses (no overwrite, no listing), so "the latest version of X" has to be
// written down somewhere. That is the root index: { bundles: {id: <url of that bundle's cdn.json>}, fonts, originals }.
// The index is uploaded after every change; its newest address is kept in data/cdn-root.url and printed in the log.
// Give a fresh server CDN_ROOT_URL=<that address> and it rebuilds its whole data folder from the CDN on start.
const TEXT_TYPES = { '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection', '.ai': 'application/postscript', '.pdf': 'application/pdf' };
Object.assign(TYPES, TEXT_TYPES);
let DATA = null; const root = { bundles: {}, fonts: { library: {}, embedded: {} }, originals: {}, updatedAt: 0 };
const rootFile = () => path.join(DATA, 'cdn-root.json'), rootUrlFile = () => path.join(DATA, 'cdn-root.url');
export async function initCdn(dataDir) { DATA = dataDir; try { Object.assign(root, JSON.parse(await readFile(rootFile(), 'utf8'))); } catch { /* first run */ } root.fonts ||= { library: {}, embedded: {} }; root.fonts.library ||= {}; root.fonts.embedded ||= {}; root.originals ||= {}; root.bundles ||= {}; }

async function allFiles(dir, rel = '') { const out = []; let ents = []; try { ents = await readdir(path.join(dir, rel), { withFileTypes: true }); } catch { return out; } for (const e of ents) { const p = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) out.push(...await allFiles(dir, p)); else if (e.name !== 'cdn.json' && e.name !== '.DS_Store') out.push(p); } return out; }

/** Upload whatever changed in one bundle (any file type), then the bundle's own map. Returns the map's url. */
export async function syncBundle(bundlesDir, id) {
  if (!cdnEnabled()) return null; const dir = path.join(bundlesDir, id); const map = await readMap(dir); const seen = (map['#m'] ||= {}); let changed = 0, failed = 0;
  for (const rel of await allFiles(dir)) {
    let m = 0; try { m = Math.round((await stat(path.join(dir, rel))).mtimeMs); } catch { continue; }
    if (map[rel] && seen[rel] === m) continue; if (map[rel] && seen[rel] == null && MEDIA.test(rel)) { seen[rel] = m; continue; } // media pushed before mtimes were tracked
    try { const { url } = await uploadBuffer(await readFile(path.join(dir, rel)), path.basename(rel)); map[rel] = url; seen[rel] = m; changed++; } catch (e) { failed++; console.error('[cdn]', id, rel, e.message); }
  }
  if (!changed && root.bundles[id]) return root.bundles[id];
  await writeMap(dir, map);
  try { const { url } = await uploadBuffer(Buffer.from(JSON.stringify(map)), `${id}.cdn.json`); root.bundles[id] = url; await saveRoot(); return url; } catch (e) { console.error('[cdn] map', id, e.message); return null; }
}

/** Fonts on file. Licensed legacy fonts (Shree Lipi and similar) are NOT published unless CDN_INCLUDE_LICENSED_FONTS=1: a
 *  public address for a commercial font file is redistribution, which those licences do not allow. */
export async function syncFonts(fontsDir, isLicensed = () => false) {
  if (!cdnEnabled()) return { uploaded: 0, held: 0 }; let uploaded = 0, held = 0;
  for (const kind of ['library', 'embedded']) { let files = []; try { files = (await readdir(path.join(fontsDir, kind))).filter((f) => /\.(ttf|otf|ttc)$/i.test(f)); } catch { continue; }
    for (const f of files) { if (root.fonts[kind][f]) continue; if (kind === 'library' && process.env.CDN_INCLUDE_LICENSED_FONTS !== '1' && await isLicensed(f)) { held++; continue; }
      try { const { url } = await uploadBuffer(await readFile(path.join(fontsDir, kind, f)), f); root.fonts[kind][f] = url; uploaded++; } catch (e) { console.error('[cdn] font', f, e.message); } } }
  if (uploaded) await saveRoot(); return { uploaded, held };
}
/** The designer's original file, kept before the working copy is deleted. */
export async function storeOriginal(id, file, name) { if (!cdnEnabled()) return null; try { const { url } = await uploadBuffer(await readFile(file), name); root.originals[id] = { url, name, at: Date.now() }; await saveRoot(); return url; } catch (e) { console.error('[cdn] original', id, e.message); return null; } }

let rootTimer = null;
// More than one process can write the index (the server, the backfill script, a second server). Never overwrite: read what is
// on disk, merge this process's entries over it, then write. An entry only ever gets newer, so merging cannot lose data.
async function mergeRootFromDisk() { try { const disk = JSON.parse(await readFile(rootFile(), 'utf8')); root.bundles = { ...(disk.bundles || {}), ...root.bundles }; root.originals = { ...(disk.originals || {}), ...root.originals }; for (const k of ['library', 'embedded']) root.fonts[k] = { ...(disk.fonts?.[k] || {}), ...root.fonts[k] }; } catch { /* no index yet */ } }
async function saveRoot() { await mergeRootFromDisk(); root.updatedAt = Date.now(); await writeFile(rootFile(), JSON.stringify(root, null, 1)); clearTimeout(rootTimer); rootTimer = setTimeout(async () => { try { const { url } = await uploadBuffer(Buffer.from(JSON.stringify(root)), 'hypergro-editor-root.json'); await writeFile(rootUrlFile(), url + '\n'); console.log('[cdn] root index →', url); } catch (e) { console.error('[cdn] root', e.message); } }, 1500); }
export const rootInfo = async () => ({ bundles: Object.keys(root.bundles).length, fonts: Object.keys(root.fonts.library).length + Object.keys(root.fonts.embedded).length, originals: Object.keys(root.originals).length, updatedAt: root.updatedAt, url: (await readFile(rootUrlFile(), 'utf8').catch(() => '')).trim() || null });

const timers = new Map();
/** Debounced: many autosaves in a row become one upload pass. */
export function scheduleSync(bundlesDir, id, delay = 4000) { if (!cdnEnabled() || !id) return; clearTimeout(timers.get(id)); timers.set(id, setTimeout(() => { timers.delete(id); syncBundle(bundlesDir, id).catch((e) => console.error('[cdn] sync', id, e.message)); }, delay)); }

/** Rebuild local data from the CDN. Only fetches what is missing, so it is safe to run on every start. */
export async function restoreAll(rootUrl, bundlesDir, fontsDir) {
  const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(180000) }); if (!r.ok) throw new Error(`${r.status} ${u}`); return Buffer.from(await r.arrayBuffer()); };
  const remote = JSON.parse((await get(rootUrl)).toString()); let files = 0;
  for (const [id, mapUrl] of Object.entries(remote.bundles || {})) { const dir = path.join(bundlesDir, id); const map = JSON.parse((await get(mapUrl)).toString());
    for (const [rel, url] of Object.entries(map)) { if (rel === '#m' || MEDIA.test(rel)) continue; const file = path.join(dir, rel); if (existsSync(file)) continue; await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, await get(url)); files++; } // pictures come back on first view
    if (!existsSync(mapFile(dir))) { delete map['#m']; await mkdir(dir, { recursive: true }); await writeMap(dir, map); } }
  for (const kind of ['library', 'embedded']) for (const [f, url] of Object.entries(remote.fonts?.[kind] || {})) { const file = path.join(fontsDir, kind, f); if (existsSync(file)) continue; await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, await get(url)); files++; }
  Object.assign(root, remote); await writeFile(rootFile(), JSON.stringify(root, null, 1)); await writeFile(rootUrlFile(), rootUrl + '\n');
  return { bundles: Object.keys(remote.bundles || {}).length, files };
}

/** Bundles that exist locally but are not in the root index yet (a duplicate, a language version, anything older than this feature). */
export async function syncMissing(bundlesDir, { all = false } = {}) { if (!cdnEnabled()) return []; const done = []; let ids = []; try { ids = (await readdir(bundlesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return done; } for (const id of ids) { if (!all && root.bundles[id]) continue; if (await syncBundle(bundlesDir, id)) done.push(id); } return done; }
