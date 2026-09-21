#!/usr/bin/env node
// Queue worker: watches an inbox for .ai files, runs the full ingest (MuPDF extract → Claude classify), zips the
// bundle into the outbox next to a <id>.json status file. Your upload service copies files in and polls the outbox.
// Usage: node server/ingest-worker.mjs [--inbox queue/inbox] [--outbox queue/outbox] [--work queue/work] [--concurrency 2] [--no-claude]
import { watch, readdir, mkdir, rename, writeFile, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { ingest } from './ingest.mjs';

try { process.loadEnvFile?.(); } catch {}
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const INBOX = path.resolve(arg('inbox', 'queue/inbox')), OUTBOX = path.resolve(arg('outbox', 'queue/outbox')), WORK = path.resolve(arg('work', 'queue/work'));
const CONC = +arg('concurrency', 2), NO_CLAUDE = process.argv.includes('--no-claude');
for (const d of [INBOX, OUTBOX, WORK]) await mkdir(d, { recursive: true });
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function zipDir(dir, zip = new JSZip(), prefix = '') {
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name), s = await stat(p);
    if (s.isDirectory()) await zipDir(p, zip, prefix + name + '/'); else zip.file(prefix + name, await readFile(p));
  }
  return zip;
}

let active = 0; const seen = new Set();
async function job(file) {
  const base = path.basename(file, path.extname(file)).replace(/[^\w-]+/g, '-'), id = `${base}-${Date.now().toString(36)}`;
  const jobDir = path.join(WORK, id), src = path.join(jobDir, path.basename(file)), outDir = path.join(jobDir, `${base}-scene`);
  await mkdir(jobDir, { recursive: true }); await rename(file, src);
  log('ingest start', id);
  try {
    const { scene, steps } = await ingest(src, outDir, { classify: !NO_CLAUDE, name: base, onStep: (s) => log(id, s) });
    const zip = await zipDir(path.dirname(outDir) === jobDir ? outDir : outDir, new JSZip(), `${base}-scene/`);
    const zipPath = path.join(OUTBOX, `${id}.zip`);
    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    await writeFile(path.join(OUTBOX, `${id}.json`), JSON.stringify({ id, source: path.basename(file), bundle: path.basename(zipPath), status: 'ok', parser: scene.source?.parser || 'mupdf', classifier: steps.classifier, elements: scene.elements.length, warnings: scene.warnings, finishedAt: new Date().toISOString() }, null, 2));
    log('ingest ok', id);
  } catch (e) {
    await writeFile(path.join(OUTBOX, `${id}.json`), JSON.stringify({ id, source: path.basename(file), status: 'failed', error: String(e.message).slice(0, 2000), finishedAt: new Date().toISOString() }, null, 2));
    log('ingest FAILED', id, e.message);
  } finally { await rm(src, { force: true }); }
}
async function pump() {
  if (active >= CONC) return;
  const files = (await readdir(INBOX)).filter((f) => /\.(ai|pdf)$/i.test(f) && !seen.has(f)); const f = files[0]; if (!f) return;
  seen.add(f); active++;
  try { await new Promise((r) => setTimeout(r, 500)); await job(path.join(INBOX, f)); } finally { active--; seen.delete(f); pump(); }
}
log('watching', INBOX, NO_CLAUDE ? '(heuristic roles, no Claude)' : ''); pump();
for await (const ev of watch(INBOX)) if (ev.filename && /\.(ai|pdf)$/i.test(ev.filename)) pump();
