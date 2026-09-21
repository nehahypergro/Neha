// Media storage on the CDN. Every raster of a bundle (artwork layers, reference, cutouts, photos a marketer swaps in) is
// uploaded once and recorded in the bundle's cdn.json as { "<path in bundle>": "<cdn url>" }. The local copy is then only
// a cache: if it is missing (fresh server, wiped disk) the file is pulled back from the CDN on first request.
// The CDN sends no CORS headers, so browsers never read it directly; the server streams it under /bundles/… instead,
// which keeps canvas exports and PDF embedding same-origin.
// Off unless CDN_UPLOAD_URL is set. NOTE: CDN urls are public to anyone who has them.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
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
