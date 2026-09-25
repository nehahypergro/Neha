// One upload = one process. MuPDF (WebAssembly) keeps its own heap, and after many files in a long-running server that heap
// can be exhausted or corrupted ("memory access out of bounds"), taking every later upload down with it. A fresh process per
// file starts from a clean heap, and a crash here cannot touch the API.
import { ingest } from './ingest.mjs';
const [src, outDir, name, classify] = process.argv.slice(2);
try {
  const r = await ingest(src, outDir, { classify: classify !== 'false', name, onStep: (s) => process.send?.({ step: s }) });
  process.send?.({ done: true, steps: r.steps, needsVision: r.needsVision });
} catch (e) { process.send?.({ error: e.message, stack: String(e.stack || '').slice(0, 2000) }); process.exitCode = 1; }
