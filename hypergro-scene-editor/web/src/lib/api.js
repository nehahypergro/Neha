const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.detail || j.error || r.statusText); e.status = r.status; e.offline = r.status === 503; throw e; } return j; };

export async function health() { try { return await json(await fetch('/api/health')); } catch { return { ok: false, claude: false, model: null }; } }
export async function samples() { try { return await json(await fetch('/api/samples')); } catch { return []; } }
export async function recent() { try { return await json(await fetch('/api/bundles')); } catch { return []; } }

/** Upload a File (or name a repo sample) and poll the ingest job until done. Resolves with the job. */
export async function ingest(fileOrSample, { onStep, by } = {}) {
  let r;
  if (typeof fileOrSample === 'string') r = await fetch('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sample: fileOrSample, by }) });
  else { const fd = new FormData(); fd.append('file', fileOrSample); if (by) fd.append('by', by); r = await fetch('/api/ingest', { method: 'POST', body: fd }); }
  const { jobId } = await json(r);
  for (;;) {
    await sleep(700);
    const j = await json(await fetch('/api/jobs/' + jobId)); onStep?.(j);
    if (j.status === 'done') return j;
    if (j.status === 'failed') throw new Error(j.error || 'ingest failed');
  }
}

export async function chat(payload) { return json(await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })); }

// ---- versions + share for approval (server-side, needs an ingested bundle)
export const versions = {
  list: async (bundleId) => { try { return await json(await fetch(`/api/bundles/${bundleId}/versions`)); } catch { return []; } },
  save: async (bundleId, body) => json(await fetch(`/api/bundles/${bundleId}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  get: async (bundleId, vid) => json(await fetch(`/api/bundles/${bundleId}/versions/${vid}`)),
};

// ---- autosave (working state per ingested bundle) + artworks list
export const autosave = {
  get: async (bundleId) => { try { return await json(await fetch(`/api/bundles/${bundleId}/autosave`)); } catch { return null; } },
  put: async (bundleId, body) => json(await fetch(`/api/bundles/${bundleId}/autosave`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
};
export const artworks = recent;
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
export const translate = async (body) => json(await post('/api/translate', body));
export const transcribe = async (id, body) => json(await post(`/api/bundles/${id}/transcribe`, body));
export const bundles = {
  meta: async (id, patch) => json(await post(`/api/bundles/${id}/meta`, patch)),
  duplicate: async (id, body) => json(await post(`/api/bundles/${id}/duplicate`, body)),
  events: async (id) => { try { return await json(await fetch(`/api/bundles/${id}/events`)); } catch { return []; } },
  logEvents: async (id, entries) => { try { await post(`/api/bundles/${id}/events`, { entries }); } catch {} },
};
