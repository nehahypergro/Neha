#!/usr/bin/env node
// Verifies the configured Claude provider end to end with one tiny request, and explains common failures.
//   npm run check-claude          (reads .env: CLAUDE_PROVIDER / VERTEX_PROJECT_ID / GOOGLE_APPLICATION_CREDENTIALS / ANTHROPIC_API_KEY)
import { existsSync } from 'node:fs';
try { process.loadEnvFile?.(); } catch {}
const { getClient, hasClaude, describeProvider, MODEL, PROVIDER, VERTEX_REGION } = await import('../server/chat.mjs');

console.log(`provider: ${describeProvider()}\nmodel:    ${MODEL}`);
if (PROVIDER === 'vertex') {
  const k = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  console.log(`key file: ${k || '(none; using gcloud ADC if present)'}${k ? (existsSync(k) ? ' ✓' : ' ✗ MISSING') : ''}`);
}
if (!hasClaude()) { console.error('\nNo usable credentials found. See README → Configuration.'); process.exit(2); }

const t0 = Date.now();
try {
  const res = await getClient().messages.create({ model: MODEL, max_tokens: 64, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  console.log(`\nCLAUDE_OK ${Date.now() - t0}ms · served by ${res.model} · reply: ${JSON.stringify(text)} · tokens in/out ${res.usage.input_tokens}/${res.usage.output_tokens}`);
} catch (e) {
  console.error(`\nCLAUDE_FAIL ${e.status || ''} ${e.name || ''}: ${e.message}`);
  if (PROVIDER === 'vertex') {
    if (e.status === 404) console.error(`→ Model "${MODEL}" is not available in region "${VERTEX_REGION}" for this project. Enable it in Vertex AI Model Garden, or set CLAUDE_MODEL / VERTEX_REGION in .env (try VERTEX_REGION=us-east5).`);
    if (e.status === 403) console.error('→ The service account lacks access: grant roles/aiplatform.user on the project and make sure the Vertex AI API is enabled.');
    if (e.status === 401 || /credential|token/i.test(e.message)) console.error('→ Credentials problem: check GOOGLE_APPLICATION_CREDENTIALS points at a valid service-account JSON (must end with "}").');
    if (e.status === 429) console.error('→ Quota exhausted for this model/region; request quota or try another region.');
  } else if (e.status === 401) console.error('→ ANTHROPIC_API_KEY is missing or invalid.');
  process.exit(1);
}
