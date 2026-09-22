# Hypergro Creative Editor — handover for the tech team

Date: 22 Sep 2026. Author of this state: Neha (with Claude Code). Repo: the `Neha` git repo, folder `hypergro-scene-editor`.

## 1. What it is
Bank marketers upload an Illustrator `.ai` (saved PDF-compatible), edit words, pictures, colours and language in a Canva-like
browser editor inside brand guardrails, and download print-ready JPG / PNG / SVG / PDF / .ai. Claude (via Google Vertex AI)
reads the layout, reads outlined text, powers the assistant and translation.

## 2. Architecture today (one Node process + a static web build)
```
browser (web/, React + Vite)                     server (server/, Express 5, Node 24)
  editor, all exports (jsPDF/svg2pdf/canvas)  ─►  /api/ingest    MuPDF extract → Claude classify → ink fit → scene bundle
  autosave, activity, languages               ─►  /api/bundles/* scene.json, autosave, versions, events, assets
  fonts via /api/fonts + /api/fontlib         ─►  /api/fonts     library first, Google Fonts fallback (cached on disk)
  ask / translate                             ─►  /api/chat, /api/translate (Claude)
  browser errors                              ─►  /api/errors    → data/errors.jsonl + ALERT_WEBHOOK_URL
                                                  data/          local cache; everything mirrored to the CDN (cdn.mjs)
```
Shared model: `shared/scene.js` (scene format v1.0, `applyOps`, tools). Read `README.md` for the full feature list.

## 3. Run it locally (10 minutes)
1. Install Node 24 (any 20.6+ works). `npm install`.
2. `cp .env.example .env`. Fill in:
   - `CLAUDE_PROVIDER=vertex`, `VERTEX_PROJECT_ID`, `VERTEX_REGION=global`, `GOOGLE_APPLICATION_CREDENTIALS=secrets/<sa>.json`
     (service account with `roles/aiplatform.user`; Claude models enabled in Model Garden). Never commit `secrets/`.
   - `CDN_UPLOAD_URL` (the Hypergro media-upload service). Optional but needed for anything beyond a laptop.
   - `ALERT_WEBHOOK_URL` (Slack / Google Chat / Teams incoming webhook) — alerts are silent until this is set.
   - Optional: `CDN_ROOT_URL` = the last root-index address (`data/cdn-root.url`) to rebuild `data/` on an empty machine.
3. `npm run dev` → editor on http://localhost:5173, API on :8787. Upload any `.ai` from `samples/` or the client.
4. Production build: `npm run build && npm start` (one process on `PORT`, default 8787).

## 4. Storage model (read before touching hosting)
- `data/bundles/<id>/` = one creative: `scene.json`, `autosave.json`, `meta.json`, `events.jsonl` (audit), `versions/`,
  `artwork-*.png` layers, `reference-0.png`, `assets/` (cutouts, swapped photos), `cdn.json` (path → CDN url).
- `data/fonts/library` (uploaded fonts) and `data/fonts/embedded` (subsets pulled from `.ai` files, realigned for browsers).
- Every change to a bundle is mirrored to the CDN a few seconds later (`server/cdn.mjs`). The CDN only creates new
  addresses (no overwrite, no listing), so `data/cdn-root.json` is the index of "latest address of everything" and is itself
  uploaded after each change. **This is a stop-gap, not a database.** CDN addresses are public to anyone who has them.
- Originals (`.ai`) are uploaded to the CDN during ingest, then deleted locally.

## 5. Steps to implement for production (in order)
1. **Auth + tenancy.** Add login (SSO or email). Attach `user` to every `/api/bundles/*` call and to `events.jsonl` entries
   (today the name is typed by the user). Add a `brandId` per creative; today brand checks assume `web/public/brand/federal-bank`.
2. **Database for scene data.** Move `scene.json`, autosave, versions, events and meta into Postgres (or Firestore). Keep
   the bundle folder layout as the storage-key layout; `server/bundles.mjs` is the only file that reads/writes them.
   Keep rasters and fonts on the CDN. Then delete the root-index mechanism in `cdn.mjs` (sections after "Everything else").
3. **Private media.** Rasters, originals and the audit record must not sit at public addresses for a bank. Either put the CDN
   behind signed URLs, or serve through the API with auth (the `restoreFromCdn` middleware already streams via the server).
4. **Hosting.** One container for the API (needs ≥2 GB RAM for large banners; MuPDF WASM, no native deps) + static web
   build. Ingest is CPU-heavy (30 s–3 min per file); run it in a worker/queue (`server/ingest-worker.mjs` exists) so API
   restarts do not kill uploads. Set `DATA_DIR` to a persistent volume or rely on `CDN_ROOT_URL` restore.
5. **Secrets.** Vertex service-account key and CDN/alert URLs into a secrets manager; nothing in `.env` on the box.
6. **Upload limits and queueing.** 300 MB cap exists (`multer`); add a per-user queue and a "try again" state in the UI.
7. **Assistant spend.** Add per-user/day caps and usage logging around `/api/chat` and `/api/translate`.
8. **Licensed fonts.** Shree Lipi fonts are published to the CDN because `CDN_INCLUDE_LICENSED_FONTS=1` was chosen; revisit
   once media is private.

## 6. Optional: frontend-only direction
The editor and all exports already run in the browser. A "thin relay" is enough server: (a) call Claude, (b) upload to CDN,
(c) fetch a Google font file, (d) log an error. These four can be serverless functions. Ingest can move to the browser for
small files (same MuPDF WASM); keep it server-side for large banners (memory). Storage (item 2 above) is still needed.

## 7. Known limitations to tell the client
- Outlined text (no live text in the `.ai`) is rebuilt by vision and fitted to the original pixels; the typeface is a guess.
  Ask designers for live-text files ("Create PDF Compatible File" ticked, text not outlined).
- Regional-language lines go into the PDF as sharp images, not selectable text (no shaping engine in the PDF path).
- Legacy Shree Lipi copy: display is exact; to change the words use "Read the words" (converts to Unicode first).
- Roll-up banners (very large formats) export artwork at 72 dpi because of a 24-megapixel-per-layer memory cap.
- Bold/italic per word, lists, crop, resize, guides, preview are implemented; per-word styling is dropped when the words are
  changed by the assistant or translation (ranges would no longer match).

## 8. Where things are
- `server/pdf-extract.mjs` extraction · `server/classify.mjs` Claude layout/vision · `server/inkfit.mjs` text fitting
- `server/fontlib.mjs` font library/parser · `server/cdn.mjs` mirroring · `server/errors.mjs` log + alerts · `server/bundles.mjs`
- `web/src/App.jsx` editor state and commands · `web/src/lib/{render,export,rich,edit,issues,errors}.js`
- `scripts/compare-export.mjs` original-vs-export audit · `scripts/cdn-push.mjs` backfill to CDN
- Memory of decisions: this file + git log.
