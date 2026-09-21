#!/usr/bin/env node
// Full ingest: .ai → MuPDF extract → Claude classify (optional) → understand() → scene bundle on disk.
//   node server/ingest.mjs <file.ai> <outdir> [--no-claude]
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from './pdf-extract.mjs';
import { classify } from './classify.mjs';
import { hasClaude } from './chat.mjs';
import { normalize, understand } from '../shared/scene.js';

/**
 * @param {string} src  .ai or .pdf path
 * @param {string} outDir  bundle folder to create
 * @param {{classify?:boolean, onStep?:(step:string)=>void, name?:string|null}} opts  name overrides document.name (defaults to the file's basename)
 */
import { fitOverlaysToInk } from './inkfit.mjs';
export async function ingest(src, outDir, { classify: doClassify = true, onStep = () => {}, name = null } = {}) {
  onStep('extract');
  const ex = await extract(src, outDir, { name });
  let scene = ex.scene;
  const steps = { parser: 'mupdf', classifier: 'heuristic' };
  if (doClassify && hasClaude()) {
    onStep('classify');
    try { scene = await classify(scene, outDir); steps.classifier = 'claude'; }
    catch (e) { console.warn('[ingest] classify failed:', e.message); scene.warnings.push('Claude classification failed (' + e.message + '); roles were assigned heuristically'); }
  } else if (doClassify) scene.warnings.push('No Anthropic credentials on the server; roles were assigned heuristically');
  onStep('understand');
  scene = understand(normalize(scene));
  // Rebuilt (outlined) text: replace the vision estimate of size and position with a measurement of the original pixels.
  try { const fontsDir = path.join(path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')), 'fonts'); const fit = await fitOverlaysToInk(scene, outDir, fontsDir); scene = fit.scene; } catch (e) { console.warn('[ingest] ink fit skipped:', e.message); }
  scene.source = { ...(scene.source || {}), parser: 'mupdf', classifier: steps.classifier };
  await writeFile(path.join(outDir, 'scene.json'), JSON.stringify(scene, null, 2));
  onStep('done');
  return { scene, steps, needsVision: ex.needsVision };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile?.(); } catch {}
  const [, , SRC, OUT] = process.argv;
  if (!SRC || !OUT) { console.error('usage: ingest <file.ai> <outdir> [--no-claude]'); process.exit(2); }
  try {
    const { scene, steps } = await ingest(SRC, OUT, { classify: !process.argv.includes('--no-claude'), onStep: (s) => console.error('…' + s) });
    const roles = {}; scene.elements.filter((e) => e.type !== 'group').forEach((e) => (roles[e.role] = (roles[e.role] || 0) + 1));
    console.log(`INGEST_OK ${OUT} · ${scene.elements.length} elements · classifier=${steps.classifier} · roles=${JSON.stringify(roles)}${scene.warnings.length ? '\nwarnings: ' + scene.warnings.join(' | ') : ''}`);
  } catch (e) { console.error('INGEST_FAIL ' + e.message); process.exit(3); }
}
