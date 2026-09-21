#!/usr/bin/env node
// Probe: does @opendesign/illustrator-parser-pdfcpu read this .ai (private data, text layers, artboard names)?
// Setup (once):  cd mcp && npm i @opendesign/illustrator-parser-pdfcpu
// Run:           node mcp/probe-opendesign.mjs path/to/file.ai   → writes probe/<name>.json + prints a summary
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const src = process.argv[2];
if (!src) { console.error('usage: probe-opendesign <file.ai>'); process.exit(2); }
const t0 = Date.now();
let mod, ctxMod;
try {
  mod = await import('@opendesign/illustrator-parser-pdfcpu/dist/index');
  ctxMod = await import('@opendesign/illustrator-parser-pdfcpu/dist/wasm_context');
} catch (e) { console.error('PROBE_FAIL package not installed or import paths changed:', e.message); process.exit(3); }
const { ArtBoardRefs, ArtBoard, PrivateData } = mod;
const { WASMContext } = ctxMod;

const out = { file: src, ok: false, ms: 0, errors: [] };
try {
  const bytes = new Uint8Array(await readFile(src));
  const ctx = await WASMContext(bytes);
  out.ctxKeys = Object.keys(ctx);
  try { out.privateData = await PrivateData(ctx); } catch (e) { out.errors.push('PrivateData: ' + e.message); }
  try {
    const refs = ArtBoardRefs(ctx);
    out.artboardRefs = refs;
    out.artboards = await Promise.all(refs.map(r => ArtBoard(ctx, r)));
  } catch (e) { out.errors.push('ArtBoard: ' + e.message); }
  out.ok = out.errors.length === 0;
} catch (e) { out.errors.push('WASMContext: ' + e.message); }
out.ms = Date.now() - t0;

// summary: walk any object tree and count node types / names / text
const counts = {}, names = new Set(), texts = [], fonts = new Set();
const walk = (n, d = 0) => {
  if (!n || typeof n !== 'object' || d > 40) return;
  if (Array.isArray(n)) return n.forEach(x => walk(x, d + 1));
  if (typeof n.Type === 'string') counts[n.Type] = (counts[n.Type] || 0) + 1;
  if (typeof n.type === 'string') counts[n.type] = (counts[n.type] || 0) + 1;
  if (typeof n.Name === 'string') names.add(n.Name);
  if (typeof n.name === 'string') names.add(n.name);
  if (typeof n.Text === 'string' && n.Text.trim()) texts.push(n.Text.slice(0, 60));
  if (typeof n.text === 'string' && n.text.trim() && texts.length < 200) texts.push(n.text.slice(0, 60));
  if (typeof n.FontName === 'string') fonts.add(n.FontName);
  if (typeof n.fontName === 'string') fonts.add(n.fontName);
  for (const k in n) if (k !== 'Bytes' && k !== 'bytes' && k !== 'data') walk(n[k], d + 1);
};
walk(out.artboards); walk(out.privateData);
const pd = out.privateData || {};
const textLayers = pd.TextLayers || pd.textLayers || pd.LayerNames || null;
out.summary = { artboards: out.artboards?.length ?? 0, artboardNames: pd.ArtboardNames || pd.artboardNames || null,
  privateDataKeys: Object.keys(pd), textLayerCount: Array.isArray(textLayers) ? textLayers.length : null,
  nodeTypes: counts, layerNames: [...names].slice(0, 50), textSamples: texts.slice(0, 30), fonts: [...fonts] };

await mkdir('probe', { recursive: true });
const dst = path.join('probe', path.basename(src, path.extname(src)) + '.json');
await writeFile(dst, JSON.stringify(out, (k, v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : v), 2));
console.log(JSON.stringify(out.summary, null, 2));
console.log(out.ok ? `PROBE_OK ${out.ms}ms → ${dst}` : `PROBE_PARTIAL ${out.errors.join(' | ')} → ${dst}`);
