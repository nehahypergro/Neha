#!/usr/bin/env node
// Mirror existing data to the CDN:  node scripts/cdn-push.mjs [bundleId ...]   (no ids = every creative + fonts)
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const { initCdn, syncBundle, syncMissing, syncFonts, cdnEnabled, rootInfo } = await import('../server/cdn.mjs'); const { library } = await import('../server/fontlib.mjs');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')); const BUNDLES = path.join(DATA, 'bundles');
if (!cdnEnabled()) { console.error('Set CDN_UPLOAD_URL in .env first'); process.exit(2); }
await initCdn(DATA); const ids = process.argv.slice(2); const t = Date.now();
if (ids.length) for (const id of ids) console.log(id, (await syncBundle(BUNDLES, id)) ? 'mirrored' : 'FAILED');
else { const done = await syncMissing(BUNDLES, { all: true }); console.log(`${done.length} creatives mirrored`); const licensed = async (f) => !!(await library.scan()).find((x) => x.file === f && x.legacy); console.log('fonts', await syncFonts(path.join(DATA, 'fonts'), licensed)); }
await new Promise((r) => setTimeout(r, 4000)); console.log(await rootInfo(), `${Math.round((Date.now() - t) / 1000)} s`);
