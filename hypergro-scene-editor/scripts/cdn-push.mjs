#!/usr/bin/env node
// Copy the images of existing bundles to the CDN:  node scripts/cdn-push.mjs [bundleId ...]   (no ids = every bundle)
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
import { readdir } from 'node:fs/promises'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { pushBundle, cdnEnabled } from '../server/cdn.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const BUNDLES = path.join(path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')), 'bundles');
if (!cdnEnabled()) { console.error('Set CDN_UPLOAD_URL in .env first'); process.exit(2); }
const ids = process.argv.slice(2).length ? process.argv.slice(2) : (await readdir(BUNDLES, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
for (const id of ids) { const t = Date.now(); const r = await pushBundle(path.join(BUNDLES, id)); console.log(id, r, `${Math.round((Date.now() - t) / 1000)} s`); }
