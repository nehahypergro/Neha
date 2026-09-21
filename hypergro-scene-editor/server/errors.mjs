// Error log + alert channel. Every failure (server crash, failed upload, anything the browser reports) is appended to
// data/errors.jsonl, and the first occurrence of each distinct failure is posted to ALERT_WEBHOOK_URL (a Slack, Google
// Chat or Teams incoming webhook: anything that accepts {"text": "..."}). Repeats of the same failure are counted, not
// re-sent, for 15 minutes, so a broken page cannot flood the channel.
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

let FILE = null; const recent = new Map(); const QUIET_MS = 15 * 60 * 1000;
export const initErrors = async (dataDir) => { await mkdir(dataDir, { recursive: true }); FILE = path.join(dataDir, 'errors.jsonl'); };
const clip = (s, n) => String(s ?? '').slice(0, n);

export async function reportError({ source = 'server', where = '', message = '', stack = '', ...rest }) {
  const entry = { at: new Date().toISOString(), source, where: clip(where, 200), message: clip(message, 1000), stack: clip(stack, 4000), ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, clip(typeof v === 'string' ? v : JSON.stringify(v), 500)])) };
  console.error(`[error] ${entry.source} · ${entry.where} · ${entry.message}`);
  try { if (FILE) await appendFile(FILE, JSON.stringify(entry) + '\n'); } catch { /* the log must never throw */ }
  const key = `${entry.source}|${entry.where}|${entry.message}`; const now = Date.now(); const last = recent.get(key);
  if (last && now - last.at < QUIET_MS) { last.count++; return entry; }
  recent.set(key, { at: now, count: 1 }); if (recent.size > 500) recent.delete(recent.keys().next().value);
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (hook) {
    const text = [`Creative editor: ${entry.source === 'browser' ? 'a user hit a problem' : 'server problem'}`, `While: ${entry.where || 'unknown'}`, `Error: ${entry.message}`, entry.user ? `User: ${entry.user}` : '', entry.bundle ? `Creative: ${entry.bundle}` : '', entry.url ? `Page: ${entry.url}` : '', last ? `(seen ${last.count} more time${last.count > 1 ? 's' : ''} in the last 15 min)` : ''].filter(Boolean).join('\n');
    fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000) }).catch((e) => console.error('[error] alert webhook failed:', e.message));
  }
  return entry;
}

export async function recentErrors(limit = 50) { try { const lines = (await readFile(FILE, 'utf8')).trim().split('\n'); return lines.slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }

/** What the API tells the browser when a route blows up: never a stack, always a next step. */
export const publicMessage = (status) => (status === 413 ? 'That file is too large (413).' : status >= 500 ? 'Internal server error (500). The team has been told.' : 'That request could not be completed.');
