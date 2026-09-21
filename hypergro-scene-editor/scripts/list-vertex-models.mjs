#!/usr/bin/env node
// Probes which Claude models this GCP project can call on Vertex AI, per region, with 1-token requests.
//   npm run vertex-models            (uses VERTEX_PROJECT_ID / GOOGLE_APPLICATION_CREDENTIALS from .env)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch {}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS);
const project = process.env.VERTEX_PROJECT_ID || process.env.ANTHROPIC_VERTEX_PROJECT_ID;
if (!project) { console.error('VERTEX_PROJECT_ID not set'); process.exit(2); }
const REGIONS = (process.argv[2] || 'global,us-east5,us-central1,europe-west1,asia-southeast1').split(',');
const MODELS = (process.argv[3] || 'claude-opus-5,claude-sonnet-5,claude-opus-4-8,claude-opus-4-7,claude-opus-4-6,claude-sonnet-4-6,claude-haiku-4-5,claude-haiku-4-5@20251001,claude-sonnet-4-5@20250929,claude-opus-4-5@20251101,claude-opus-4-1@20250805').split(',');
console.log(`project ${project} · ${REGIONS.length} regions × ${MODELS.length} models`);
const ok = [];
for (const region of REGIONS) {
  const client = new AnthropicVertex({ projectId: project, region, maxRetries: 0, timeout: 30000 });
  const rows = await Promise.all(MODELS.map(async (model) => {
    try { const r = await client.messages.create({ model, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }); ok.push({ region, model, served: r.model }); return `  ✓ ${model.padEnd(28)} → served as ${r.model}`; }
    catch (e) { const code = e.status || (e.name || 'ERR'); return `  ✗ ${model.padEnd(28)} ${code}${code === 429 ? ' (quota: model exists)' : code === 403 ? ' (permission)' : ''}`; }
  }));
  console.log(`\n[${region}]\n` + rows.join('\n'));
}
console.log(ok.length ? `\nUSABLE: ${ok.map((o) => `${o.model} @ ${o.region}`).join(', ')}` : '\nNo Claude model is callable with this service account. Enable Claude models in Vertex AI Model Garden for the project (Console → Vertex AI → Model Garden → Claude → Enable) and grant the service account roles/aiplatform.user.');
