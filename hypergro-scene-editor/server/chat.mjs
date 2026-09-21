// Chat assistant: Claude drives the same operations layer (shared/scene.js TOOLS + runTool) that clicks and the MCP
// server use. One request = one user turn; the server runs the tool loop and returns the edited scene.
// Provider: the first-party Claude API (ANTHROPIC_API_KEY) or Google Cloud Vertex AI (CLAUDE_PROVIDER=vertex).
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, runTool, summarize, ROLES } from '../shared/scene.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Load <project>/.env before reading any setting (imports are hoisted, so this must live here, not in index.mjs).
// Variables already present in the real environment take precedence over the file.
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch {}
export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
export const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID || process.env.ANTHROPIC_VERTEX_PROJECT_ID || null;
export const VERTEX_REGION = process.env.VERTEX_REGION || process.env.CLOUD_ML_REGION || 'global';
export const PROVIDER = (process.env.CLAUDE_PROVIDER || (VERTEX_PROJECT ? 'vertex' : 'anthropic')).toLowerCase();
// Server-side refusal fallbacks are a first-party beta; Vertex does not support them.
const FALLBACKS = PROVIDER === 'anthropic' && process.env.CLAUDE_FALLBACKS !== '0';

// A relative GOOGLE_APPLICATION_CREDENTIALS (e.g. secrets/sa.json) is resolved against the project root so the
// server, the worker and the CLI scripts all find it regardless of cwd.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !path.isAbsolute(process.env.GOOGLE_APPLICATION_CREDENTIALS))
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(ROOT, process.env.GOOGLE_APPLICATION_CREDENTIALS);

const vertexCredsPresent = () =>
  (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) ||
  existsSync(path.join(homedir(), '.config', 'gcloud', 'application_default_credentials.json'));

let client = null;
export function getClient() {
  if (client) return client;
  if (PROVIDER === 'vertex') {
    if (!VERTEX_PROJECT) throw new Error('CLAUDE_PROVIDER=vertex needs VERTEX_PROJECT_ID');
    // Auth goes through google-auth-library: GOOGLE_APPLICATION_CREDENTIALS (service-account JSON) or gcloud ADC.
    client = new AnthropicVertex({ projectId: VERTEX_PROJECT, region: VERTEX_REGION });
  } else client = new Anthropic();
  return client;
}
export const hasClaude = () =>
  PROVIDER === 'vertex'
    ? !!VERTEX_PROJECT && vertexCredsPresent()
    : !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) || existsSync(path.join(homedir(), '.config', 'anthropic'));
export const describeProvider = () => (PROVIDER === 'vertex' ? `vertex · ${VERTEX_PROJECT} · ${VERTEX_REGION}` : 'anthropic');

// Frozen system prompt (stable prefix → cacheable). Volatile scene state travels in the user turn.
const SYSTEM = `You are the assistant inside Hypergro's ad-creative editor. A marketer is editing one creative (a "scene": text, images and shapes with roles such as headline, subhead, offer, cta, logo, product, disclaimer, background). You change the creative only by calling the provided tools; you never describe edits you did not make.

How to work:
- "target" accepts an element id (e.g. el_txt_003) or a role name (headline, subhead, offer, cta, logo, product, disclaimer, background, body). If an element is marked as selected, the user's request refers to it unless they clearly name another one.
- For a CTA, the role "cta" resolves to the button shape for colour changes; use the label's id to edit its copy.
- Keep changes minimal and on-brand: do not touch elements the user did not mention. Rewrite copy only when asked; keep the same tone and length class unless told otherwise. "Shorter" means fewer words with the same meaning.
- Colours are hex. If the user names a colour, pick a sensible hex (red #C8102E, blue #0B4EA2, green #1A7F4B, orange #E8541E, navy #0A2A5C, black #1C1B19, white #FFFFFF).
- "Bigger"/"smaller" on text means ±20% font size. Moving "to the bottom right" etc. means placing it near that corner with the same margin the element currently has from its nearest edges.
- Valid roles: ${ROLES.join(', ')}.
- Elements with "locked": true are brand-controlled (logo, disclaimer, background by default). Tools refuse to change them. Only call set_lock to unlock one when the user explicitly asks to change that element; say that you unlocked it.
- You can also delete_element, duplicate_element, set_font and set_order. Deleting is undoable but prefer set_visibility (hide) when the user says "remove" a piece of copy, unless they clearly want it gone.
- The editor shows the user a list of every change you made, so the reply is a short confirmation, not a list.
- If the scene state includes a brand kit, use its colours by name (e.g. "Golden Glow" → the hex given) and its fonts; the headline font is for headlines only. Prefer brand colours over generic ones.
- Elements with "encoding": "legacy" are typed in a legacy Indic font: the stored letters are keystrokes for that font, so never rewrite or translate them (the tool refuses anyway). Say in one sentence that this line is typed in a legacy font and the designer must retype it; you can still move, resize or recolour it.
- The user is a marketer, not a designer or developer. Words like "the offer", "the price", "the discount" mean whatever piece of copy carries that meaning, even if its role is headline; "the button" means the CTA. Act on the obvious reading. Only ask a question when two readings would give visibly different results and neither is clearly intended; never ask for permission to make a change the user just requested.

After the tools have run, reply with one short, friendly sentence (under 20 words) saying what changed, in plain words a marketer would use. Never mention ids, roles, tools, "elements" or the scene; say "the headline", "the button", "the small print". No preamble, no lists.`;

const toApiMessages = (history) => {
  const out = [];
  for (const m of history || []) {
    const role = m.role === 'u' ? 'user' : 'assistant';
    const text = String(m.text || '').trim();
    if (!text) continue;
    if (!out.length && role !== 'user') continue; // conversation must start with a user turn
    if (out.length && out[out.length - 1].role === role) { out[out.length - 1].content += '\n' + text; continue; }
    out.push({ role, content: text });
  }
  return out.slice(-12);
};

async function createMessage(params) {
  const c = getClient();
  if (FALLBACKS) {
    // Server-side refusal fallbacks (beta): if the primary model declines, the API re-runs on a fallback model in the same call.
    try { return await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }); }
    catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; console.warn('[chat] fallbacks rejected, retrying without them:', e.message); }
  }
  return c.messages.create(params);
}

/**
 * @param {{scene:object, message:string, selected?:string|null, history?:{role:'u'|'a',text:string}[]}} req
 * @returns {Promise<{scene:object, reply:string, log:{name:string,input:object,result:string}[], model:string}>}
 */
export async function chat({ scene, message, selected = null, history = [], brand = null }) {
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  const ctx = { canvas: { width: scene.document.width, height: scene.document.height }, selected, ...(brand ? { brand } : {}), elements: summarize(scene) };
  const messages = [...toApiMessages(history), { role: 'user', content: `Current scene state (JSON):\n${JSON.stringify(ctx)}\n\nRequest: ${message}` }];
  let cur = scene, reply = '';
  const log = [];
  let usedModel = MODEL;
  for (let turn = 0; turn < 8; turn++) {
    const res = await createMessage({ model: MODEL, max_tokens: 8000, system: SYSTEM, tools, messages, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' } });
    usedModel = res.model || MODEL;
    if (res.stop_reason === 'refusal') { reply = 'I can’t make that change.'; break; }
    const toolUses = res.content.filter((b) => b.type === 'tool_use');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!toolUses.length) { reply = text; break; }
    messages.push({ role: 'assistant', content: res.content });
    const results = toolUses.map((tu) => {
      let r;
      try { const out = runTool(cur, tu.name, tu.input || {}); cur = out.scene; r = out.result; }
      catch (e) { r = 'Error: ' + e.message; }
      log.push({ name: tu.name, input: tu.input || {}, result: String(r) });
      return { type: 'tool_result', tool_use_id: tu.id, content: String(r) };
    });
    messages.push({ role: 'user', content: results });
    if (res.stop_reason === 'max_tokens') break;
  }
  if (!reply) reply = log.length ? log.map((l) => l.result).join(' · ') : 'Nothing to change.';
  return { scene: cur, reply, log, model: usedModel };
}

/** Translate the editable copy of a creative. Returns { translations: { [id]: text }, notes }. Locked, logo and legacy-font lines are left alone. */
export async function translateScene(scene, language) {
  const lines = scene.elements.filter((e) => e.type === 'text' && e.visible && !e.locked && e.role !== 'logo' && e.text?.encoding !== 'legacy' && (e.text?.content || '').trim()).map((e) => ({ id: e.id, role: e.role, text: e.text.content }));
  if (!lines.length) return { translations: {}, notes: ['nothing to translate'] };
  const system = `You translate advertising copy for an Indian bank into ${language}. Keep numbers, currency amounts, percentages, dates, product names, brand names (Federal Bank, Kotak, UPI) and legal wording exactly; keep each line's tone and keep its LENGTH close to the original: aim for at most 1.3× the original character count (Indic scripts run long, so prefer shorter, punchier wording over a literal rendering); a button label must stay a short imperative of one or two words, at most 1.5× the original length; keep line breaks (\n) where the original has them; for a button label use the natural short imperative. If the copy is already in ${language}, return it unchanged. Return ONLY a JSON object: {"translations": {"<id>": "<translated text>", ...}}. No commentary.`;
  const client = getClient();
  const r = await client.messages.create({ model: MODEL, max_tokens: 4000, system, messages: [{ role: 'user', content: JSON.stringify({ language, lines }) }] });
  const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('translation came back in an unexpected shape');
  const out = JSON.parse(m[0]); const translations = {};
  for (const l of lines) if (typeof out.translations?.[l.id] === 'string' && out.translations[l.id].trim()) translations[l.id] = out.translations[l.id].replace(/\\n/g, '\n');
  return { translations, model: MODEL };
}
