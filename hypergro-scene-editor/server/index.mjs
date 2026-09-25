#!/usr/bin/env node
// HTTP server for the Hypergro Scene Editor.
//   POST /api/ingest        multipart {file} or JSON {sample}  → {jobId}
//   GET  /api/jobs/:id      → {status, step, result|error}
//   POST /api/chat          {scene, message, selected, history} → {scene, reply, log}
//   GET  /api/health        → {ok, claude, model}
//   GET  /api/samples       → sample .ai files shipped with the repo
//   GET  /bundles/<id>/…    static scene bundles produced by ingest
// In production (NODE_ENV=production) it also serves the built web app from dist/.
import express from 'express';
import multer from 'multer';
import { mkdir, rename, rm, copyFile, readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingest } from './ingest.mjs';
import { chat, translateScene, hasClaude, MODEL, PROVIDER, describeProvider } from './chat.mjs';
import { library } from './fontlib.mjs';
import { transcribeElement } from './classify.mjs';
import { cdnEnabled, storeAsset, restoreFromCdn, initCdn, syncBundle, syncFonts, syncMissing, scheduleSync, storeOriginal, restoreAll, rootInfo } from './cdn.mjs';
import { initErrors, reportError, recentErrors, publicMessage } from './errors.mjs';
import { listBundles, readMeta, writeMeta, duplicateBundle, appendEvents, readEvents, readiness } from './bundles.mjs';

try { process.loadEnvFile?.(); } catch {}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOADS = path.join(DATA, 'uploads'), BUNDLES = path.join(DATA, 'bundles'), SAMPLES = path.join(ROOT, 'samples');
await mkdir(UPLOADS, { recursive: true }); await mkdir(BUNDLES, { recursive: true });
const PORT = +process.env.PORT || 8787;
const slug = (s) => (s.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'creative');

const app = express();
app.use(express.json({ limit: '30mb' }));
await initErrors(DATA);
await initCdn(DATA);
const FONTS_DIR = path.join(DATA, 'fonts');
const licensedFont = async (file) => !!(await library.scan()).find((f) => f.file === file && f.legacy);
// A fresh server (empty disk) rebuilds itself from the CDN: set CDN_ROOT_URL to the last root index address.
if (cdnEnabled() && process.env.CDN_ROOT_URL) { try { const r = await restoreAll(process.env.CDN_ROOT_URL, BUNDLES, FONTS_DIR); console.log(`[cdn] restored ${r.files} missing files across ${r.bundles} creatives`); } catch (e) { reportError({ where: 'restoring data from the CDN on start', message: e.message, stack: e.stack }); } }
// Every change to a creative (autosave, saved copy, rename, audit entry, swapped photo, duplicate) is mirrored a few seconds later.
app.use('/api/bundles/:id', (req, res, next) => { if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) { scheduleSync(BUNDLES, req.params.id); if (/duplicate/.test(req.path)) setTimeout(() => syncMissing(BUNDLES).catch(() => {}), 1500); } }); next(); });
app.get('/api/storage', async (req, res) => res.json({ cdn: cdnEnabled(), ...(await rootInfo()) }));
process.on('unhandledRejection', (e) => reportError({ where: 'unhandled promise on the server', message: e?.message || String(e), stack: e?.stack }));
process.on('uncaughtException', (e) => { reportError({ where: 'server crash', message: e?.message || String(e), stack: e?.stack }); });
// The browser reports what went wrong for a user; sendBeacon posts JSON as a blob, so accept text too.
app.post('/api/errors', express.text({ type: '*/*', limit: '64kb' }), async (req, res) => {
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = { message: b }; } }
  await reportError({ ...(b && typeof b === 'object' ? b : {}), source: 'browser' }); res.status(204).end();
});
if (process.env.NODE_ENV !== 'production') app.get('/api/errors', async (req, res) => res.json(await recentErrors(+req.query.limit || 50)));
const upload = multer({ dest: UPLOADS, limits: { fileSize: 300 * 1024 * 1024 } });
const jobs = new Map();

app.get('/api/health', (req, res) => res.json({ ok: true, claude: hasClaude(), model: MODEL, provider: PROVIDER, providerDetail: describeProvider() }));
app.get('/api/samples', async (req, res) => {
  try { res.json((await readdir(SAMPLES)).filter((f) => /\.(ai|pdf)$/i.test(f))); } catch { res.json([]); }
});

/** Run ingest in its own process (see ingest-child.mjs); the finished scene is read back from the bundle folder. */
function ingestInChild(src, outDir, { classify = true, name = null, onStep = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(ROOT, 'server', 'ingest-child.mjs'), [src, outDir, name || '', String(classify)], { execArgv: ['--max-old-space-size=4096'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let result = null, failure = null;
    child.on('message', (m) => { if (m.step) onStep(m.step); else if (m.done) result = m; else if (m.error) failure = m; });
    child.on('error', reject);
    child.on('exit', async (code, signal) => {
      if (failure) return reject(Object.assign(new Error(failure.error), { stack: failure.stack }));
      if (!result) return reject(new Error(signal ? `processing was stopped (${signal})` : `processing crashed (exit ${code}); the file may be too large for this server`));
      try { resolve({ scene: JSON.parse(await readFile(path.join(outDir, 'scene.json'), 'utf8')), steps: result.steps, needsVision: result.needsVision }); } catch (e) { reject(e); }
    });
  });
}
app.post('/api/ingest', upload.single('file'), async (req, res) => {
  const sample = req.body?.sample ? path.basename(String(req.body.sample)) : null;
  const name = req.file?.originalname || sample;
  if (!name) return res.status(400).json({ error: 'Send a multipart "file" or JSON {"sample": "<name>.ai"}' });
  if (!/\.(ai|pdf)$/i.test(name)) { if (req.file) await rm(req.file.path, { force: true }); return res.status(400).json({ error: 'Upload an Illustrator .ai (saved PDF-compatible) or a .pdf' }); }
  const id = `${slug(name)}-${Date.now().toString(36)}`;
  const job = { id, name, status: 'queued', step: 'queued', createdAt: Date.now(), claude: hasClaude() && req.body?.classify !== 'false' };
  jobs.set(id, job);
  res.json({ jobId: id });
  const src = path.join(UPLOADS, id + path.extname(name).toLowerCase());
  try {
    if (req.file) await rename(req.file.path, src); else await copyFile(path.join(SAMPLES, sample), src);
    job.status = 'running';
    const { scene, steps } = await ingestInChild(src, path.join(BUNDLES, id), { classify: req.body?.classify !== 'false', name: path.basename(name, path.extname(name)), onStep: (s) => { job.step = s; } });
    // Bookkeeping: grade the upload, and retire earlier uploads of the same file (they stay on disk, hidden from the list).
    const grade = readiness(scene, scene.ingest?.stats || {});
    // The same file again replaces the earlier upload. "Statement Template.ai", "Statement-Template.ai" and "statement template (1).ai"
    // are the same file to a person, so compare a normalised name, not the exact string.
    const sameFile = (a, b) => String(a || '').toLowerCase().replace(/\.(ai|pdf)$/, '').replace(/\s*\(\d+\)$/, '').replace(/[^a-z0-9]+/g, '') === String(b || '').toLowerCase().replace(/\.(ai|pdf)$/, '').replace(/\s*\(\d+\)$/, '').replace(/[^a-z0-9]+/g, '');
    const all = await listBundles(BUNDLES);
    const earlier = all.filter((b) => b.id !== id && sameFile(b.sourceFile, name) && !b.variantOf);
    const inherited = earlier.find((b) => b.name && b.name !== b.documentName)?.name || null;
    // A different file with the same title gets a number, so two cards never carry the same name.
    let title = inherited || scene.document.name; const taken = new Set(all.filter((b) => b.id !== id && !earlier.includes(b) && !b.supersededBy && !b.archived).map((b) => b.name));
    if (taken.has(title)) { let k = 2; while (taken.has(`${title} (${k})`)) k++; title = `${title} (${k})`; }
    for (const b of earlier) await writeMeta(path.join(BUNDLES, b.id), { supersededBy: id });
    await writeMeta(path.join(BUNDLES, id), { sourceFile: name, name: title, readiness: grade, replaces: earlier.map((b) => b.id), createdAt: Date.now() });
    await appendEvents(path.join(BUNDLES, id), [{ at: Date.now(), by: String(req.body?.by || 'Someone'), label: earlier.length ? `Uploaded a new version of ${name}` : `Uploaded ${name}` }]);
    if (cdnEnabled()) { job.step = 'store'; await storeOriginal(id, src, name); await syncBundle(BUNDLES, id); syncFonts(FONTS_DIR, licensedFont).catch(() => {}); const m = JSON.parse(await readFile(path.join(BUNDLES, id, 'cdn.json'), 'utf8').catch(() => '{}')); const r = { failed: (await readdir(path.join(BUNDLES, id))).filter((f) => /\.(png|jpe?g)$/i.test(f) && !m[f]).length }; if (r.failed) scene.warnings = [...(scene.warnings || []), `${r.failed} image${r.failed > 1 ? 's' : ''} could not be copied to the CDN; they are kept on this server only`]; }
    job.status = 'done'; job.step = 'done';
    job.result = { bundle: `/bundles/${id}/`, name: title, elements: scene.elements.length, warnings: scene.warnings, classifier: steps.classifier, needsVision: !!scene.ingest?.needsVision, readiness: grade, replaced: earlier.map((b) => b.id) };
  } catch (e) { job.status = 'failed'; job.step = 'failed'; job.error = e.message; reportError({ where: 'processing an uploaded file', message: e.message, stack: e.stack, file: name, job: id, user: String(req.body?.by || '') }); }
  finally { await rm(src, { force: true }); }
});
app.get('/api/jobs/:id', (req, res) => { const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: 'unknown job' }); res.json(j); });

app.get('/api/bundles', async (req, res) => res.json(await listBundles(BUNDLES, { all: req.query.all === '1' })));
const bundleOk = (id) => /^[\w-]{1,80}$/.test(id) && existsSync(path.join(BUNDLES, id, 'scene.json'));
app.post('/api/bundles/:id/meta', async (req, res) => {
  const { id } = req.params; if (!bundleOk(id)) return res.status(404).json({ error: 'unknown bundle' });
  const patch = {}; const b = req.body || {};
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 120);
  if (typeof b.archived === 'boolean') patch.archived = b.archived;
  const meta = await writeMeta(path.join(BUNDLES, id), patch);
  if (patch.name) await appendEvents(path.join(BUNDLES, id), [{ at: Date.now(), by: b.by, label: `Renamed the creative to “${patch.name}”` }]);
  res.json(meta);
});
app.post('/api/bundles/:id/duplicate', async (req, res) => {
  const { id } = req.params; if (!bundleOk(id)) return res.status(404).json({ error: 'unknown bundle' });
  try { const b = req.body || {}; const out = await duplicateBundle(BUNDLES, id, { name: b.name, language: b.language || null, variantOf: b.variantOf || null, scene: b.scene || null, slug });
    await appendEvents(path.join(BUNDLES, out.id), [{ at: Date.now(), by: b.by, label: b.language ? `Created the ${b.language} version from “${b.fromName || id}”` : `Started from a copy of “${b.fromName || id}”` }]);
    res.json({ id: out.id, bundle: `/bundles/${out.id}/`, name: out.scene.document.name }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/bundles/:id/events', async (req, res) => { const { id } = req.params; if (!bundleOk(id)) return res.status(404).json({ error: 'unknown bundle' }); res.json(await readEvents(path.join(BUNDLES, id))); });
app.post('/api/bundles/:id/events', async (req, res) => { const { id } = req.params; if (!bundleOk(id)) return res.status(404).json({ error: 'unknown bundle' }); res.json({ added: await appendEvents(path.join(BUNDLES, id), req.body?.entries || []) }); });
app.put('/api/bundles/:id/autosave', async (req, res) => {
  const { id } = req.params; const { scene, png, activity } = req.body || {};
  if (!/^[\w-]{1,80}$/.test(id) || !scene) return res.status(400).json({ error: 'bundle id and scene required' });
  const dir = path.join(BUNDLES, id); if (!existsSync(path.join(dir, 'scene.json'))) return res.status(404).json({ error: 'unknown bundle' });
  await writeFile(path.join(dir, 'autosave.json'), JSON.stringify({ savedAt: Date.now(), scene, activity: Array.isArray(activity) ? activity.slice(-80) : [] }));
  if (Array.isArray(activity)) await appendEvents(dir, activity);
  if (typeof png === 'string' && png.startsWith('data:image/')) await writeFile(path.join(dir, 'autosave.png'), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  res.json({ ok: true, savedAt: Date.now() });
});
app.get('/api/bundles/:id/autosave', async (req, res) => {
  if (!/^[\w-]{1,80}$/.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  try { res.json(JSON.parse(await readFile(path.join(BUNDLES, req.params.id, 'autosave.json'), 'utf8'))); } catch { res.status(404).json({ error: 'no autosave' }); }
});
// ---- font proxy: TTFs from Google Fonts (a non-browser user agent makes the CSS API hand out TrueType files) so PDF/.ai
//      exports can embed the brand fonts and keep text editable in Illustrator. Cached under data/fonts.
const FONTS = path.join(DATA, 'fonts'); await mkdir(FONTS, { recursive: true });
app.get('/api/fonts/:family/:weight', async (req, res) => {
  const family = req.params.family, weight = /^\d+$/.test(req.params.weight) ? +req.params.weight : 400, italic = req.query.italic === '1';
  // 1. the team's own font library (matched by PostScript name, then family + weight)
  // A partial font (pulled out of a designer's file) only has that file's letters, so it is the last resort, after Google.
  let partial = null; const sendHit = (hit) => { if (hit.subset) res.set('X-Font-Partial', '1'); res.type(hit.file.endsWith('.otf') ? 'font/otf' : 'font/ttf'); return res.sendFile(library.pathOf(hit)); };
  try { const hit = await library.find({ postScriptName: req.query.ps, family, weight, italic }); if (hit && !hit.subset) return sendHit(hit); partial = hit || null; } catch {}
  // 2. Google Fonts (TTF only comes back for a non-browser user agent), cached on disk
  const key = `${family.replace(/[^\w-]+/g, '_')}-${weight}${italic ? 'i' : ''}.ttf`, cached = path.join(FONTS, key);
  if (existsSync(cached)) return res.type('font/ttf').sendFile(cached);
  try {
    // Without a subset the v1 CSS endpoint hands back a Latin-only cut, even for "Noto Sans Malayalam".
    const script = family.match(/^Noto (?:Sans|Serif) (\w+)$/)?.[1]?.toLowerCase();
    const subset = script && script !== 'mono' && script !== 'display' ? `${script},latin` : 'latin,latin-ext';
    const css = await (await fetch(`https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:${weight}${italic ? 'i' : ''}&subset=${subset}`, { headers: { 'User-Agent': 'curl/8' } })).text();
    const url = css.match(/url\((https:[^)]+\.ttf)\)/)?.[1]; if (!url) { if (partial) return sendHit(partial); return res.status(404).json({ error: 'no TTF for that family' }); }
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer()); await writeFile(cached, buf); res.type('font/ttf').send(buf);
  } catch (e) { if (partial) return sendHit(partial); res.status(502).json({ error: e.message }); }
});
// ---- team font library: fonts the brand uses, uploaded once, served to the editor and embedded in exports
app.get('/api/fontlib', async (req, res) => res.json(await library.scan()));
app.post('/api/fontlib', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  try { const meta = await library.add(req.file.originalname, await readFile(req.file.path)); res.json(meta); syncFonts(FONTS_DIR, licensedFont).catch(() => {}); }
  catch (e) { res.status(400).json({ error: e.message }); }
  finally { unlink(req.file.path).catch(() => {}); }
});
app.get('/api/fontlib/file/:file', async (req, res) => { const f = req.params.file; if (!/^[\w.-]+\.(ttf|otf|ttc)$/i.test(f)) return res.status(400).end(); const entry = (await library.scan()).find((x) => x.file === f); if (!entry) return res.status(404).end(); res.type(f.endsWith('.otf') ? 'font/otf' : 'font/ttf').set('Cache-Control', 'public, max-age=86400').sendFile(library.pathOf(entry), (e) => { if (e) res.status(404).end(); }); });
// ---- language versions: translate every editable line of a creative in one call
app.post('/api/translate', async (req, res) => {
  const { scene, language } = req.body || {}; if (!scene || !language) return res.status(400).json({ error: 'scene and language required' });
  if (!hasClaude()) return res.status(503).json({ error: 'The assistant is offline, so translations are not available right now.' });
  try { res.json(await translateScene(scene, String(language))); } catch (e) { res.status(502).json({ error: e.message }); }
});
// ---- read a legacy-font line from the original render → Unicode (the marketer confirms before it is applied)
app.post('/api/bundles/:id/transcribe', async (req, res) => {
  const { id } = req.params; if (!bundleOk(id)) return res.status(404).json({ error: 'unknown bundle' });
  if (!hasClaude()) return res.status(503).json({ error: 'The assistant is offline, so reading the words is not available right now.' });
  const { scene, elementId, script, language } = req.body || {}; const el = scene?.elements?.find((e) => e.id === elementId); if (!el?.bounds) return res.status(400).json({ error: 'element not found' });
  try { res.json(await transcribeElement(scene, path.join(BUNDLES, id), el, { script, language })); } catch (e) { res.status(502).json({ error: e.message }); }
});
// ---- dev only: park a file produced in the browser (exports) so scripts can inspect it
if (process.env.NODE_ENV !== 'production') app.post('/api/dev/blob/:name', express.raw({ type: '*/*', limit: '200mb' }), async (req, res) => {
  const name = req.params.name.replace(/[^\w.-]+/g, '_'); const dir = path.join(DATA, 'dev'); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), req.body); res.json({ ok: true, bytes: req.body.length, path: `data/dev/${name}` });
});
app.post('/api/chat', async (req, res) => {
  const { scene, message, selected = null, history = [], brand = null } = req.body || {};
  if (!scene || !message) return res.status(400).json({ error: 'scene and message are required' });
  if (!hasClaude()) return res.status(503).json({ error: 'offline', detail: 'No Anthropic credentials on the server (set ANTHROPIC_API_KEY in .env)' });
  try { res.json(await chat({ scene, message, selected, history, brand })); }
  catch (e) { console.error('[chat]', e.status || '', e.message); res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.name || 'error', detail: e.message }); }
});

// ---- versions + share-for-approval
const okId = (s) => /^[\w-]{1,80}$/.test(s || '');
const VDIR = (id) => path.join(BUNDLES, id, 'versions');
const readVersion = async (id, vid) => JSON.parse(await readFile(path.join(VDIR(id), vid + '.json'), 'utf8'));
const publicVersion = (v) => ({ vid: v.vid, name: v.name, createdAt: v.createdAt, by: v.by || null, png: v.png, width: v.width, height: v.height });
app.get('/api/bundles/:id/versions', async (req, res) => {
  if (!okId(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const out = [];
  try { for (const f of await readdir(VDIR(req.params.id))) if (f.endsWith('.json')) out.push(publicVersion(JSON.parse(await readFile(path.join(VDIR(req.params.id), f), 'utf8')))); } catch {}
  res.json(out.sort((a, b) => b.createdAt - a.createdAt));
});
app.post('/api/bundles/:id/versions', async (req, res) => {
  const { id } = req.params; const { name, scene, png } = req.body || {};
  if (!okId(id) || !scene) return res.status(400).json({ error: 'bundle id and scene required' });
  const vid = Date.now().toString(36); await mkdir(VDIR(id), { recursive: true });
  let pngPath = null;
  if (typeof png === 'string' && png.startsWith('data:image/png;base64,')) { pngPath = `/bundles/${id}/versions/${vid}.png`; await writeFile(path.join(VDIR(id), vid + '.png'), Buffer.from(png.slice(22), 'base64')); }
  const v = { vid, name: String(name || 'Version').slice(0, 80), createdAt: Date.now(), by: String(req.body?.by || '').slice(0, 80) || null, png: pngPath, width: scene.document?.width, height: scene.document?.height, scene };
  await writeFile(path.join(VDIR(id), vid + '.json'), JSON.stringify(v));
  res.json(publicVersion(v));
});
app.get('/api/bundles/:id/versions/:vid', async (req, res) => {
  if (!okId(req.params.id) || !okId(req.params.vid)) return res.status(400).json({ error: 'bad id' });
  try { res.json(await readVersion(req.params.id, req.params.vid)); } catch { res.status(404).json({ error: 'no such version' }); }
});
// A photo a marketer swaps in: kept with the creative (and on the CDN) so it is still there after a reload.
app.post('/api/bundles/:id/assets', upload.single('file'), async (req, res) => {
  const { id } = req.params; if (!bundleOk(id) || !req.file) { if (req.file) await rm(req.file.path, { force: true }); return res.status(400).json({ error: 'unknown bundle or no file' }); }
  try {
    if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(req.file.originalname)) return res.status(400).json({ error: 'Images only (png, jpg, webp, gif, svg)' });
    const rel = 'user/' + String(req.body?.name || `${Date.now()}-${req.file.originalname}`).replace(/[^\w.-]+/g, '-');
    res.json(await storeAsset(path.join(BUNDLES, id), rel, await readFile(req.file.path)));
  } catch (e) { res.status(500).json({ error: e.message }); } finally { await rm(req.file.path, { force: true }); }
});
app.use('/bundles', restoreFromCdn(BUNDLES));
app.use('/bundles', express.static(BUNDLES));
app.use('/illustrator', express.static(path.join(ROOT, 'illustrator')));
app.use('/docs', express.static(path.join(ROOT, 'docs')));
if (process.env.NODE_ENV === 'production') {
  const DIST = path.join(ROOT, 'dist');
  app.use(express.static(DIST));
  app.use((req, res) => res.sendFile(path.join(DIST, 'index.html')));
}
// Anything a route throws ends here: logged, alerted, and answered without a stack trace.
app.use((err, req, res, next) => {
  const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : err?.status || err?.statusCode || 500;
  if (status >= 500 || status === 413) reportError({ where: `${req.method} ${req.path}`, message: err?.message || String(err), stack: err?.stack });
  if (res.headersSent) return next(err);
  res.status(status).json({ error: publicMessage(status) });
});
app.listen(PORT, () => console.log(`Hypergro Scene Editor API on http://localhost:${PORT} · Claude: ${hasClaude() ? `${MODEL} via ${describeProvider()}` : `offline (${PROVIDER === 'vertex' ? 'Vertex credentials not found' : 'set ANTHROPIC_API_KEY in .env'})`}`));
