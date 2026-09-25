import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as S from '../../shared/scene.js';
import { useEditor } from './useEditor.js';
import Home from './components/Home.jsx';
import EditorHeader from './components/EditorHeader.jsx';
import AskBox from './components/AskBox.jsx';
import Form from './components/Form.jsx';
import Toolbar from './components/Toolbar.jsx';
import BottomBar from './components/BottomBar.jsx';
import Canvas from './components/Canvas.jsx';
import Layers from './components/Layers.jsx';
import { FontReplaceSheet } from './components/Sheets.jsx';
import FileCheck from './components/FileCheck.jsx';
import { ReadWordsSheet, NameSheet } from './components/Sheets.jsx';
import { getUserName, setUserName } from './lib/user.js';
import * as api from './lib/api.js';
import { fail, report, explain, setErrorContext } from './lib/errors.js';
import * as E from './lib/edit.js';
import * as R from './lib/rich.js';
import Rulers from './components/Rulers.jsx';
import { CropSheet, ResizeSheet, ShortcutsSheet } from './components/EditSheets.jsx';
import { loadFiles, loadZip, loadUrl, readDrop, addAssets } from './lib/bundle.js';
import { ensureFonts } from './lib/fonts.js';
import { localEdit } from './lib/localEdit.js';
import { renderToCanvas, download } from './lib/render.js';
import { exportFile } from './lib/export.js';
import { computeIssues, fitFontSize, textFit, safeMargin, forgetFonts } from './lib/issues.js';
import { snapDelta, unionBounds } from './lib/snap.js';
import { brandPalette } from './lib/palette.js';
import { loadBrand, swatchPalette, brandSummary, brandFontFamilies } from './lib/brand.js';
import { surfaceUnder, kitLogoOf, logoFor, SURFACE_LABEL } from './lib/logoSurface.js';
import { loadFontLibrary, mapSceneFonts, uploadFont, libraryFonts } from './lib/fontlib.js';

const DEMO_NAME = 'Federal Bank sample creative';
const EXAMPLES = ['Change the offer to 10%', 'Make the headline shorter', 'Make the button text stronger'];
// Translated copy is usually longer. Shrink it into its box (down to 72%); if it still spills, let it wrap on more lines
// and shrink further (down to 58%). Whatever still does not fit is left for the "Ready to publish" check.
function fitTranslated(e) {
  const withSize = (el, fs) => ({ ...el, text: { ...el.text, fontSize: fs, lineHeight: el.text.lineHeight ? Math.round(el.text.lineHeight * fs / e.text.fontSize * 100) / 100 : null } });
  // The checker tolerates a 2% spill; a fresh translation should not, so every check here uses a slightly narrower box.
  const strict = (el) => ({ ...el, bounds: { ...el.bounds, width: el.bounds.width * 0.97 - 2 } });
  if (textFit(strict(e)).ok) return e;
  const base = e.text.fontSize; let fs = base;
  while (fs > base * 0.72) { fs = Math.round((fs - 0.5) * 10) / 10; if (textFit(strict(withSize(e, fs))).ok) return withSize(e, fs); }
  const wrapped = { ...e, text: { ...e.text, kind: 'area' } }; fs = base * 0.9;
  while (fs > base * 0.5) { if (textFit(strict(withSize(wrapped, fs))).ok) return withSize(wrapped, fs); fs = Math.round((fs - 0.5) * 10) / 10; }
  return withSize(wrapped, Math.round(base * 0.5 * 10) / 10);
}
const SCRIPT_RE = { Hindi: /[\u0900-\u097F]/, Marathi: /[\u0900-\u097F]/, Malayalam: /[\u0D00-\u0D7F]/, Tamil: /[\u0B80-\u0BFF]/, Telugu: /[\u0C00-\u0C7F]/, Kannada: /[\u0C80-\u0CFF]/, Bengali: /[\u0980-\u09FF]/, Assamese: /[\u0980-\u09FF]/, Gujarati: /[\u0A80-\u0AFF]/, Punjabi: /[\u0A00-\u0A7F]/, Odia: /[\u0B00-\u0B7F]/ };
// Unicode face per language for translated copy; the brand's own Unicode fonts win when on file under the same family.
const SCRIPT_FONT = { hindi: 'Noto Sans Devanagari', marathi: 'Noto Sans Devanagari', malayalam: 'Noto Sans Malayalam', tamil: 'Noto Sans Tamil', telugu: 'Noto Sans Telugu', kannada: 'Noto Sans Kannada', bangla: 'Noto Sans Bengali', bengali: 'Noto Sans Bengali', assamese: 'Noto Sans Bengali', gujarati: 'Noto Sans Gujarati', punjabi: 'Noto Sans Gurmukhi', odia: 'Noto Sans Oriya' };
const LANG_FONT = { Hindi: 'Noto Sans Devanagari', Marathi: 'Noto Sans Devanagari', Malayalam: 'Noto Sans Malayalam', Tamil: 'Noto Sans Tamil', Telugu: 'Noto Sans Telugu', Kannada: 'Noto Sans Kannada', Bengali: 'Noto Sans Bengali', Assamese: 'Noto Sans Bengali', Gujarati: 'Noto Sans Gujarati', Punjabi: 'Noto Sans Gurmukhi', Odia: 'Noto Sans Oriya', English: null };
const DESIGNER = new URLSearchParams(location.search).get('designer') === '1';
const dismissedBanner = (id) => { try { return !!id && localStorage.getItem('hg:fc:' + id) === '1'; } catch { return false; } };
// Text transcribed from a render by the vision pass carries an estimated size; shrink it to its box once so it never spills over the original artwork.
const fitOverlays = (sc) => { sc.elements = sc.elements.filter((e) => !(e.type === 'text' && e.meta?.overlay && ['logo', 'decoration'].includes(e.role))); for (const e of sc.elements) { if (e.type !== 'text' || !e.meta?.overlay || e.meta.fitted) continue; const fs = fitFontSize(e); if (fs < e.text.fontSize) e.text = { ...e.text, fontSize: fs, lineHeight: e.text.lineHeight ? Math.round(e.text.lineHeight * fs / e.text.fontSize * 100) / 100 : null }; e.meta = { ...e.meta, fitted: true }; } return sc; };
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };

export default function App() {
  const [ed, dispatch] = useEditor();
  const scene = ed.scene;
  const W = scene?.document.width || 1200, H = scene?.document.height || 628;
  const [view, setView] = useState('home');
  const [sel, setSel] = useState([]), [focusKey, setFocusKey] = useState(null), [hover, setHover] = useState(null), [editing, setEditing] = useState(null), [guides, setGuides] = useState([]), [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1), [zoomMode, setZoomMode] = useState('fit'), [showOriginal, setShowOriginal] = useState(false), [layersOpen, setLayersOpen] = useState(false);
  const [contentsOpen, setContentsOpen] = useState(() => pref('hg:contents', false)), [assistOpen, setAssistOpen] = useState(() => pref('hg:assist', false));
  const [langProgress, setLangProgress] = useState({}), [bannerGone, setBannerGone] = useState({}), [exportTick, setExportTick] = useState(0), [lastFormat, setLastFormat] = useState(() => { try { return localStorage.getItem('hg:lastFormat') || 'jpg'; } catch { return 'jpg'; } });
  const assistVisits = useRef(0); const viewRef = useRef('home');
  const [marquee, setMarquee] = useState(null), [userGuides, setUserGuides] = useState([]), [rulers, setRulers] = useState(() => pref('hg:rulers', false)), [preview, setPreview] = useState(false), [saveTick, setSaveTick] = useState(0);
  const userGuidesRef = useRef(userGuides); userGuidesRef.current = userGuides; const previewRef = useRef(preview); previewRef.current = preview; const pasteCount = useRef(0); const saveNowRef = useRef(false);
  const [dropping, setDropping] = useState(false), [sheet, setSheet] = useState(null), [toast, setToastState] = useState(null);
  const [exchanges, setExchanges] = useState([]), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ ok: false, claude: false, model: null, checked: false });
  const [samples, setSamples] = useState([]), [artworks, setArtworks] = useState([]), [job, setJob] = useState(null);
  const [versions, setVersions] = useState([]), [fontsTick, setFontsTick] = useState(0), [kit, setKit] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'saved' }), [exporting, setExporting] = useState(null), [past, setPast] = useState([]), [surfaces, setSurfaces] = useState({}), [fontLib, setFontLib] = useState([]);
  const [user, setUserState] = useState(() => getUserName()), [art, setArt] = useState(null), [displayName, setDisplayName] = useState('');
  const userRef = useRef(user); userRef.current = user; const artRefState = useRef(art); artRefState.current = art;
  const by = () => userRef.current || 'Someone';
  useEffect(() => { setErrorContext(() => ({ user: userRef.current || '', screen: viewRef.current || '', bundle: viewRef.current === 'home' ? '' : edRef.current?.bundleId || '' })); }, []);
  const stageRef = useRef(null), artRef = useRef(null), drag = useRef(null), fieldSnap = useRef({ id: null, snapped: false }), editSnapped = useRef(false), skipAutosave = useRef(false), toastTimer = useRef(null);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const edRef = useRef(ed); edRef.current = ed;
  const selRef = useRef(sel); selRef.current = sel;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const exRef = useRef(exchanges); exRef.current = exchanges;
  const editingRef = useRef(editing); editingRef.current = editing;
  const dimsRef = useRef([W, H]); dimsRef.current = [W, H];
  const statusRef = useRef(status); statusRef.current = status;
  const kitRef = useRef(kit); kitRef.current = kit;
  const pastRef = useRef(past); pastRef.current = past;

  const setToast = useCallback((text, ms = 4000, action = null) => { clearTimeout(toastTimer.current); setToastState(text ? { text, at: Date.now(), action } : null); if (text) toastTimer.current = setTimeout(() => setToastState(null), ms); }, []);
  viewRef.current = view;
  useEffect(() => { if (view !== 'editor') return; try { const n = (+localStorage.getItem('hg:assistVisits') || 0) + 1; localStorage.setItem('hg:assistVisits', String(n)); assistVisits.current = n; } catch {} }, [view]);
  useEffect(() => { if (!exporting) return; const t = setInterval(() => setExportTick((x) => x + 1), 1000); return () => clearInterval(t); }, [exporting]);
  const ops = useCallback((o, label, record = true, ids = null) => dispatch({ type: 'ops', ops: o, record, label, ids }), [dispatch]);
  const set = useCallback((id, patch, label, record = true) => ops([{ id, set: patch }], label, record), [ops]);
  const sceneColors = useMemo(() => brandPalette(scene), [scene]);
  const palette = useMemo(() => swatchPalette(kit, sceneColors), [kit, sceneColors]);
  const fullPalette = useMemo(() => swatchPalette(kit, sceneColors, { full: true }), [kit, sceneColors]);
  const baseIssues = useMemo(() => computeIssues(scene, ed.assets, W, H, kit), [scene, ed.assets, W, H, kit, fontsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Which approved logo version sits on which background: sampled from a small render whenever the creative changes.
  useEffect(() => {
    if (!scene || !kit) { setSurfaces({}); return; }
    const logos = scene.elements.filter((e) => e.visible && e.type !== 'group' && kitLogoOf(kit, e));
    if (!logos.length) { setSurfaces({}); return; }
    let live = true;
    const t = setTimeout(async () => {
      const out = {};
      for (const e of logos) {
        const group = e.semanticGroup ? scene.elements.filter((x) => x.semanticGroup === e.semanticGroup).map((x) => x.id) : [e.id];
        try { out[e.id] = await surfaceUnder(scene, ed.assets, e.bounds, group); } catch {}
      }
      if (live) setSurfaces(out);
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [scene, ed.assets, kit]);
  const issues = useMemo(() => {
    if (!scene || !kit) return baseIssues;
    const extra = [];
    for (const [id, s] of Object.entries(surfaces)) {
      const e = scene.elements.find((x) => x.id === id); const cur = kitLogoOf(kit, e); if (!e || !cur || cur.on === s.surface) continue;
      const best = logoFor(kit, s.surface, cur.kind); if (!best || best.id === cur.id) continue;
      extra.push({ id: 'logosurface:' + id, severity: 'warn', elementId: id, title: `“${e.name}” is the version for ${SURFACE_LABEL[cur.on]}, but it sits on ${SURFACE_LABEL[s.surface]}.`, detail: `Use ${best.name}.`, action: { type: 'logoSurface', elementId: id, logoId: best.id, label: `Use ${best.name}` } });
    }
    return extra.length ? [...extra, ...baseIssues] : baseIssues;
  }, [baseIssues, surfaces, scene, kit]);
  const referenceUrl = scene ? ed.assets[scene.document.artboards?.[scene.document.activeArtboard ?? 0]?.reference] || null : null;
  const refreshArtworks = useCallback(() => api.artworks().then(setArtworks).catch(() => {}), []);

  // ---- zoom / fit
  const fit = useCallback(() => { const st = stageRef.current; if (!st || st.clientWidth < 100) return; const z = Math.max(.1, Math.min((st.clientWidth - 48) / W, (st.clientHeight - 48) / H, 1.6)); setZoom((cur) => (Math.abs(z - cur) > .001 ? z : cur)); }, [W, H]);
  useEffect(() => { if (zoomMode !== 'fit' || view !== 'editor') return; fit(); const ro = new ResizeObserver(fit); if (stageRef.current) ro.observe(stageRef.current); return () => ro.disconnect(); }, [fit, zoomMode, view]);
  useEffect(() => { try { localStorage.setItem('hg:contents', contentsOpen ? '1' : '0'); localStorage.setItem('hg:assist', assistOpen ? '1' : '0'); } catch {} }, [contentsOpen, assistOpen]);

  // ---- boot
  useEffect(() => {
    (async () => { const h = await api.health(); setStatus({ ...h, checked: true }); if (h.ok) { setSamples(await api.samples()); refreshArtworks(); setFontLib(await loadFontLibrary()); forgetFonts(); setFontsTick((t) => t + 1); } })();
    loadBrand().then((k) => { setKit(k); return ensureFonts({ elements: brandFontFamilies(k).map((f) => ({ text: { fontFamily: f } })) }); }).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }).catch((e) => console.warn('brand kit not loaded', e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openScene(raw, assets, name, bundleId, info, { autosaved = null, activity = [], record = null } = {}) {
    setArt(record); setDisplayName(record?.name || name);
    const original = mapSceneFonts(fitOverlays(S.understand(S.normalize(raw)))); const sc = autosaved ? mapSceneFonts(fitOverlays(S.understand(S.normalize(autosaved)))) : original;
    skipAutosave.current = true;
    dispatch({ type: 'open', scene: sc, original, assets, name, bundleId, info });
    setSel([]); setEditing(null); setZoomMode('fit'); setShowOriginal(false); setExchanges([]); setPast(Array.isArray(activity) ? activity : []); setSaveState({ status: bundleId ? 'saved' : 'local' }); setView('editor');
    ensureFonts(sc).then(() => { forgetFonts(); setFontsTick((t) => t + 1); });
    loadVersions(bundleId, name);
    if (bundleId) api.bundles.events(bundleId).then((ev) => { if (ev.length) setPast(ev); });
    if (autosaved) setToast('Picked up where you left off. “Start over” goes back to the uploaded file.', 6000);
  }
  const openBundle = ({ raw, assets, name }) => openScene(raw, assets, name, null, null);
  async function loadVersions(bundleId, name) {
    if (bundleId) setVersions(await api.versions.list(bundleId));
    else { try { setVersions(JSON.parse(localStorage.getItem('hg:versions:' + name) || '[]').map((v) => ({ ...v, status: 'local' }))); } catch { setVersions([]); } }
  }
  async function openDemo() {
    try { const { raw, assets } = await loadUrl('/samples/demo/', DEMO_NAME); let auto = null; try { auto = JSON.parse(localStorage.getItem('hg:autosave:' + DEMO_NAME) || 'null'); } catch {} openScene(raw, assets, DEMO_NAME, null, null, { autosaved: auto?.scene || null, activity: auto?.activity || [] }); }
    catch (e) { setToast(fail(e, 'opening the sample')); }
  }
  async function openArtwork(a) {
    try { const { raw, assets } = await loadUrl(a.bundle, a.name); const auto = await api.autosave.get(a.id); if (auto?.scene) addAssets(auto.scene, assets, (q) => (a.bundle.endsWith('/') ? a.bundle : a.bundle + '/') + q); openScene(raw, assets, a.name, a.id, { readiness: a.readiness }, { autosaved: auto?.scene || null, activity: auto?.activity || [], record: a }); }
    catch (e) { setToast(fail(e, 'opening that creative'), 9000); }
  }

  // ---- guides are a working aid, not part of the creative: kept per creative in this browser, never exported
  useEffect(() => { try { setUserGuides(JSON.parse(localStorage.getItem('hg:guides:' + (ed.bundleId || ed.fileName)) || '[]')); } catch { setUserGuides([]); } }, [ed.bundleId, ed.fileName]);
  useEffect(() => { if (!ed.fileName || drag.current?.kind === 'guide') return; try { localStorage.setItem('hg:guides:' + (ed.bundleId || ed.fileName), JSON.stringify(userGuides.filter((g) => g.pos > -9000))); } catch {} }, [userGuides]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- autosave: debounced after any change; server for uploaded creatives, this browser for the sample / opened folders
  useEffect(() => {
    if (!scene || !ed.fileName) return;
    if (skipAutosave.current) { skipAutosave.current = false; return; }
    setSaveState((s) => ({ ...s, status: 'unsaved' }));
    const t = setTimeout(async () => {
      setSaveState({ status: 'saving' });
      try { if (!userRef.current && !localStorage.getItem('hg:askedName')) { localStorage.setItem('hg:askedName', '1'); setToast('Changes are recorded as “Someone”.', 10000, { label: 'Add your name', fn: () => setSheet({ name: true }) }); } } catch {}
      const activity = [...pastRef.current, ...edRef.current.undo.map((h) => ({ label: h.label, at: h.at, by: by() }))].slice(-80);
      try {
        if (ed.bundleId) { const c = await renderToCanvas(scene, ed.assets, Math.min(1, 320 / W)); await api.autosave.put(ed.bundleId, { scene, png: c.toDataURL('image/jpeg', 0.7), activity }); setSaveState({ status: 'saved' }); refreshArtworks(); }
        else { localStorage.setItem('hg:autosave:' + ed.fileName, JSON.stringify({ savedAt: Date.now(), scene, activity })); setSaveState({ status: 'local' }); }
      } catch { setSaveState({ status: 'error' }); }
    }, saveNowRef.current ? 0 : 1500); saveNowRef.current = false;
    return () => clearTimeout(t);
  }, [scene, saveTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- upload + understand
  async function runIngest(src, label) {
    if (job) return;
    setJob({ step: 'upload' });
    try {
      const j = await api.ingest(src, { onStep: (s) => setJob((cur) => ({ ...(cur || {}), ...s, startedAt: cur?.startedAt || Date.now() })), by: by() });
      const record = { id: j.id, bundle: j.result.bundle, name: j.result.name || j.name, readiness: j.result.readiness, variants: [], replaces: j.result.replaced || [] };
      refreshArtworks();
      const openIt = async () => { const { raw, assets } = await loadUrl(j.result.bundle, j.name); openScene(raw, assets, record.name, j.id, j.result, { record }); if (j.result.readiness?.grade === 'limited') setSheet({ fileCheck: j.result.readiness, name: record.name }); };
      if (viewRef.current === 'home') await openIt(); else setToast(`“${record.name}” is ready.`, 12000, { label: 'Open', fn: openIt });
    } catch (e) { report(e, 'uploading a file', { file: name }); setToast(uploadError(e), 12000); }
    finally { setJob(null); }
  }
  const uploadError = (e) => { const m = String(e?.message || ''); if (/password/i.test(m)) return 'This file is password-protected. Ask the designer for a version without a password.'; if (/PDF Compatible|Not a PDF-compatible/i.test(m)) return 'This file was saved without PDF compatibility. Ask the designer to re-save it with “Create PDF Compatible File” ticked.'; if (/Upload an Illustrator/i.test(m)) return 'That isn’t an Illustrator or PDF file. Upload the .ai file your designer sent.'; return explain(e, 'reading that file').replace(/^Something went wrong while reading that file\. Try again\./, 'We couldn’t read that file. Try uploading it again. If it fails twice, ask the designer to re-save it from Illustrator and send the new file.'); };
  async function onDrop(ev) {
    ev.preventDefault(); setDropping(false);
    try {
      const files = await readDrop(ev.dataTransfer);
      if (files.length === 1 && /\.zip$/i.test(files[0].name)) return openBundle(await loadZip(files[0]));
      if (files.length === 1 && /\.(ai|pdf)$/i.test(files[0].name)) return runIngest(files[0], files[0].name);
      openBundle(await loadFiles(files));
    } catch (e) { setToast(fail(e, 'opening those files'), 9000); }
  }

  // ---- selection + direct manipulation
  const select = useCallback((id, { add } = {}) => { setFocusKey(null); setSel((cur) => (add ? (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]) : [id])); }, []);
  function startDrag(ev, id, kind, handle) {
    if (editingRef.current === id) return;
    if (editingRef.current) setEditing(null);
    ev.stopPropagation(); ev.preventDefault();
    const sc = sceneRef.current; const el = sc?.elements.find((x) => x.id === id); if (!el) return;
    let ids = selRef.current;
    if (kind === 'move') { ids = ev.shiftKey ? (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]) : ids.includes(id) ? ids : [id]; setFocusKey(null); setSel(ids); }
    if (el.locked || (kind === 'move' && ev.shiftKey)) return;
    if (kind === 'rotate') {
      const r = artRef.current.getBoundingClientRect(); const z = zoomRef.current; const cx = r.left + (el.bounds.x + el.bounds.width / 2) * z, cy = r.top + (el.bounds.y + el.bounds.height / 2) * z;
      drag.current = { kind, id, cx, cy, a0: Math.atan2(ev.clientY - cy, ev.clientX - cx), rot0: el.transform?.rotation || 0, name: el.name, items: [{ id }], snapped: false };
      return;
    }
    const moving = kind === 'move'
      ? [...new Map(ids.flatMap((i) => { const e = sc.elements.find((x) => x.id === i); if (!e || e.locked) return []; return e.semanticGroup && !ev.altKey ? sc.elements.filter((x) => x.semanticGroup === e.semanticGroup && !x.locked) : [e]; }).map((e) => [e.id, e])).values()]
      : [el];
    if (!moving.length) return;
    drag.current = { kind, handle, id, sx: ev.clientX, sy: ev.clientY, items: moving.map((x) => ({ id: x.id, ...x.bounds })), b0: { ...el.bounds }, fs: el.text?.fontSize, type: el.type, name: moving.length > 1 ? `${moving.length} items` : el.name, snapped: false };
  }
  useEffect(() => {
    const move = (ev) => {
      const d = drag.current; if (!d) return; const sc = sceneRef.current; const z = zoomRef.current; const [w, h] = dimsRef.current;
      if (d.kind === 'marquee' || d.kind === 'guide') {
        const r = artRef.current.getBoundingClientRect(); const px = (ev.clientX - r.left) / z, py = (ev.clientY - r.top) / z;
        if (d.kind === 'guide') { const pos = Math.round(d.axis === 'x' ? px : py); d.pos = pos; d.inside = d.axis === 'x' ? px >= 0 && px <= w : py >= 0 && py <= h; setUserGuides((g) => { const n = [...g]; n[d.index] = { axis: d.axis, pos }; return n; }); return; }
        if (!d.moved && Math.abs(ev.clientX - d.sx) < 4 && Math.abs(ev.clientY - d.sy) < 4) return; d.moved = true;
        const box = { x: Math.min(d.x0, px), y: Math.min(d.y0, py), width: Math.abs(px - d.x0), height: Math.abs(py - d.y0) }; setMarquee(box);
        const hit = sc.elements.filter((e) => e.type !== 'group' && e.visible && !e.locked && !e.meta?.collapsedGroup && e.role !== 'background' && (e.artboardId ?? 0) === (sc.document.activeArtboard ?? 0) && e.bounds.x < box.x + box.width && e.bounds.x + e.bounds.width > box.x && e.bounds.y < box.y + box.height && e.bounds.y + e.bounds.height > box.y).map((e) => e.id);
        setSel(d.add ? [...new Set([...d.base, ...hit])] : hit); return;
      }
      if (d.kind === 'rotate') {
        const a = Math.atan2(ev.clientY - d.cy, ev.clientX - d.cx); let rot = d.rot0 - (a - d.a0) * 180 / Math.PI;
        rot = ((rot + 180) % 360 + 360) % 360 - 180; if (ev.shiftKey) rot = Math.round(rot / 15) * 15; if (Math.abs(rot) < 3) rot = 0;
        if (!d.snapped) { if (Math.abs(rot - d.rot0) < 1) return; dispatch({ type: 'snapshot', label: `Rotated ${d.name}`, ids: [d.id] }); d.snapped = true; setDragging(true); }
        ops([{ id: d.id, set: { transform: { rotation: Math.round(rot * 10) / 10 } } }], null, false); return;
      }
      let dx = (ev.clientX - d.sx) / z, dy = (ev.clientY - d.sy) / z;
      if (!d.snapped) { if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; dispatch({ type: 'snapshot', label: `${d.kind === 'move' ? 'Moved' : 'Resized'} ${d.name}`, ids: d.items.map((i) => i.id) }); d.snapped = true; setDragging(true); }
      if (d.kind === 'move') {
        const u = unionBounds(d.items); const ids = new Set(d.items.map((i) => i.id));
        const others = sc.elements.filter((e) => e.type !== 'group' && e.visible && !ids.has(e.id) && e.role !== 'background').map((e) => e.bounds);
        const snap = ev.metaKey || ev.ctrlKey ? { dx: 0, dy: 0, guides: [] } : snapDelta({ ...u, x: u.x + dx, y: u.y + dy }, others, w, h, { margin: 0, threshold: 6 / z, lines: userGuidesRef.current });
        dx += snap.dx; dy += snap.dy; setGuides(snap.guides);
        ops(d.items.map((it) => ({ id: it.id, set: { bounds: { x: Math.round(it.x + dx), y: Math.round(it.y + dy) } } })), null, false);
      } else {
        const b = d.b0, hd = d.handle; let { x, y, width: bw, height: bh } = b;
        if (hd.includes('e')) bw = Math.max(4, b.width + dx); if (hd.includes('w')) { bw = Math.max(4, b.width - dx); x = b.x + b.width - bw; }
        if (hd.includes('s')) bh = Math.max(4, b.height + dy); if (hd.includes('n')) { bh = Math.max(4, b.height - dy); y = b.y + b.height - bh; }
        const corner = hd.length === 2;
        if (corner && d.type === 'image' && !ev.shiftKey) { const r = b.width / b.height; if (Math.abs(dx) >= Math.abs(dy)) bh = bw / r; else bw = bh * r; if (hd.includes('w')) x = b.x + b.width - bw; if (hd.includes('n')) y = b.y + b.height - bh; }
        const s = { bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(bw), height: Math.round(bh) } };
        if (d.fs && corner && ev.shiftKey && d.type === 'text') s.text = { fontSize: Math.round(d.fs * bw / b.width) };
        ops([{ id: d.id, set: s }], null, false);
      }
    };
    const up = () => { const d = drag.current; if (!d) return;
      if (d.kind === 'guide' && !d.inside) setUserGuides((g) => g.filter((_, i) => i !== d.index)); // dragged off the creative = removed
      if (d.kind === 'marquee') { setMarquee(null); if (!d.moved && !d.add) { setSel([]); } }
      drag.current = null; setGuides([]); setDragging(false); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dispatch, ops]);

  // ---- keyboard
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!e.target?.isContentEditable;
      const meta = e.metaKey || e.ctrlKey; const sc = sceneRef.current; const ids = selRef.current;
      if (e.key === 'Escape') { if (editingRef.current) { setEditing(null); e.target?.blur?.(); } else if (previewRef.current) setPreview(false); else { setSheet(null); setSel([]); } return; }
      if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); ctlRef.current.saveNow(); return; } // never let the browser's "save page" dialog open
      if (typing) return;
      const C = ctlRef.current, k = e.key.toLowerCase(); const one = ids.length === 1 ? sc?.elements.find((x) => x.id === ids[0]) : null; const txt = one?.type === 'text' && !one.locked && one.text.encoding !== 'legacy' ? one : null;
      if (meta && e.altKey && (k === 'p' || e.code === 'KeyP')) { e.preventDefault(); C.togglePreview(); return; }
      if (previewRef.current) return;
      if (meta && k === 'c' && ids.length) { e.preventDefault(); C.copy(ids); return; }
      if (meta && k === 'x' && ids.length) { e.preventDefault(); C.cut(ids); return; }
      if (meta && k === 'v') { e.preventDefault(); C.paste(); return; }
      if (meta && k === 'a') { e.preventDefault(); C.selectAll(); return; }
      if (meta && k === 'g') { e.preventDefault(); if (e.shiftKey) C.ungroup(ids); else C.group(ids); return; }
      if (meta && (e.key === ']' || e.key === '}') && ids.length) { e.preventDefault(); C.order(ids, e.shiftKey ? 'front' : 'forward'); return; }
      if (meta && (e.key === '[' || e.key === '{') && ids.length) { e.preventDefault(); C.order(ids, e.shiftKey ? 'back' : 'backward'); return; }
      if (meta && e.shiftKey && k === 'l' && !txt && one) { e.preventDefault(); C.setLock(one, !one.locked); return; }
      if (txt && meta && !e.shiftKey && k === 'b') { e.preventDefault(); C.toggleBold(txt); return; }
      if (txt && meta && !e.shiftKey && k === 'i') { e.preventDefault(); C.toggleItalic(txt); return; }
      if (txt && meta && !e.shiftKey && k === 'u') { e.preventDefault(); C.textStyle(txt, { underline: !txt.text.underline }, `${txt.text.underline ? 'Removed the underline from' : 'Underlined'} the ${txt.name}`); return; }
      if (txt && meta && e.shiftKey && k === 'k') { e.preventDefault(); C.toggleCase(txt); return; }
      if (txt && meta && e.shiftKey && ['l', 'c', 'r', 'j'].includes(k)) { e.preventDefault(); const a = { l: 'left', c: 'center', r: 'right', j: 'justify' }[k]; C.textStyle(txt, { align: a }, `Aligned the ${txt.name} ${a}`); return; }
      if (txt && meta && e.shiftKey && (e.key === '>' || e.key === '.')) { e.preventDefault(); C.setFontSize(txt, Math.round(txt.text.fontSize) + 1, `Made the ${txt.name} bigger`); return; }
      if (txt && meta && e.shiftKey && (e.key === '<' || e.key === ',')) { e.preventDefault(); C.setFontSize(txt, Math.max(6, Math.round(txt.text.fontSize) - 1), `Made the ${txt.name} smaller`); return; }
      if (!meta && !e.altKey && k === 't') { e.preventDefault(); C.addText(); return; }
      if (!meta && e.shiftKey && k === 'r') { e.preventDefault(); C.toggleRulers(); return; }
      if (!meta && e.key === '?') { e.preventDefault(); C.showShortcuts(); return; }
      if (e.key === 'Enter' && ids.length === 1) { const el = sc?.elements.find((x) => x.id === ids[0]); if (el?.type === 'text' && !el.locked) { e.preventDefault(); editSnapped.current = false; setEditing(el.id); } return; }
      if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return; }
      if (meta && e.key.toLowerCase() === 'd' && ids.length) { e.preventDefault(); ctlRef.current.duplicate(ids); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && ids.length) { e.preventDefault(); ctlRef.current.remove(ids); return; }
      if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(Math.min(4, zoomRef.current * 1.25)); setZoomMode('manual'); }
      if (meta && e.key === '-') { e.preventDefault(); setZoom(Math.max(.1, zoomRef.current / 1.25)); setZoomMode('manual'); }
      if (meta && e.key === '0') { e.preventDefault(); setZoomMode('fit'); }
      if (ids.length && /^Arrow/.test(e.key)) {
        e.preventDefault(); const st = e.shiftKey ? 10 : 1; const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
        const els = ids.map((i) => sc?.elements.find((x) => x.id === i)).filter((x) => x && !x.locked); if (!els.length) return;
        ops(els.map((el) => ({ id: el.id, set: { bounds: { x: el.bounds.x + dx, y: el.bounds.y + dy } } })), `Nudged ${els.length > 1 ? els.length + ' items' : els[0].name}`);
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, ops]);

  // ---- "Ask for a change": the server runs Claude + the shared tool layer; the tool log is replayed here so concurrent edits survive
  async function runChat(text) {
    const sc = sceneRef.current; if (!sc) return;
    const selected = selRef.current[0] || null; const at = Date.now();
    setExchanges((x) => [...x.slice(-9), { q: text, at, status: 'busy' }]); setBusy(true); setDraft('');
    const applyLog = (log, label) => {
      const e = edRef.current; let next = e.scene;
      for (const c of log) next = S.runTool(next, c.name, c.input || {}).scene;
      dispatch({ type: 'replace', scene: next, label });
      ensureFonts(next).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }); // translations may need a script font
      const changed = next.elements.filter((x) => { const o = e.scene.elements.find((y) => y.id === x.id); return !o || JSON.stringify(o) !== JSON.stringify(x); }).map((x) => x.name);
      return { changed, undoDepth: e.undo.length + 1 };
    };
    let result;
    try {
      if (!statusRef.current.claude) { const err = new Error('offline'); err.offline = true; throw err; }
      const history = exRef.current.filter((x) => x.status !== 'busy').slice(-6).flatMap((x) => [{ role: 'u', text: x.q }, { role: 'a', text: x.a }]);
      const res = await api.chat({ scene: sc, message: text, selected, brand: brandSummary(kitRef.current), history });
      result = { a: plain(res.reply) || 'Done.', ...(res.log?.length ? applyLog(res.log, 'Assistant: ' + text.slice(0, 60)) : {}) };
    } catch (err) {
      if (!err.offline) report(err, 'asking the assistant', { request: text.slice(0, 200) });
      const le = localEdit(S, sceneRef.current, text, selected);
      result = { a: err.offline ? le.reply.replace(' (offline mode)', '') : `Sorry, that didn’t work. ${le.scene ? le.reply.replace(' (offline mode)', '') : 'Try asking for one change at a time, or click the item on the creative and change it there.'}` };
      if (le.scene) { const e = edRef.current; dispatch({ type: 'replace', scene: le.scene, label: 'Assistant: ' + text.slice(0, 50) }); result.undoDepth = e.undo.length + 1; }
    }
    setExchanges((x) => x.map((it) => (it.at === at ? { ...it, status: 'done', ...result } : it))); setBusy(false);
  }
  // Keep replies to what a marketer needs: strip tool chatter and ids, first two sentences only.
  const plain = (t) => (t || '').replace(/\b(el_[\w-]+|tool call|set_text|set_fill|move_element|list_elements)\b/g, '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');

  // ---- download
  const base = () => (ed.original?.document.name || scene?.document.name || 'creative').replace(/\.[^.]+$/, '');
  async function exportAs(format) {
    const sc = sceneRef.current; if (!sc || exporting) return; setExporting({ format, phase: 'fonts', startedAt: Date.now() }); setExportTick(0);
    try { localStorage.setItem('hg:lastFormat', format); } catch {} setLastFormat(format);
    try { await ensureFonts(sc); const { blob, filename, note } = await exportFile(sc, edRef.current.assets, format, base(), (phase) => setExporting((x) => (x ? { ...x, phase } : x))); download(filename, URL.createObjectURL(blob)); setToast(`Downloaded ${filename}${note && /check/.test(note) ? `. ${note.replace(/^.*?· /, '')}` : ''}`, 8000, { label: 'Download again', fn: () => download(filename, URL.createObjectURL(blob)) }); logEvent(`Downloaded the ${format === 'ai' ? 'editable .ai' : format === 'pdf' ? 'print PDF' : format.toUpperCase()} file`); }
    catch (e) { setToast(fail(e, 'building your download', { format }), 12000, { label: 'Try again', fn: () => exportAs(format) }); }
    finally { setExporting(null); }
  }

  // ---- audit record: things that are not scene edits (downloads, renames, copies) are posted straight to the log
  function logEvent(label) { const e = { at: Date.now(), by: by(), label }; setPast((p) => [...p, e]); if (edRef.current.bundleId) api.bundles.logEvents(edRef.current.bundleId, [e]); }
  const setUser = (n) => { setUserName(n); setUserState(n); };
  async function rename(name) {
    const n = String(name || '').trim(); if (!n || n === displayName) return; setDisplayName(n);
    if (edRef.current.bundleId) { await api.bundles.meta(edRef.current.bundleId, { name: n, by: by() }).catch(() => {}); refreshArtworks(); setPast((p) => [...p, { at: Date.now(), by: by(), label: `Renamed the creative to “${n}”` }]); }
    else setToast('Renamed for this session.');
  }
  async function duplicateArtwork(a, { language = null, scene = null, open = true } = {}) {
    try {
      const r = await api.bundles.duplicate(a.id, { name: language ? `${a.name} · ${language}` : `${a.name} copy`, language, variantOf: language ? a.id : null, scene, fromName: a.name, by: by() });
      const list = await api.artworks(); setArtworks(list);
      const rec = { id: r.id, bundle: r.bundle, name: r.name, readiness: a.readiness || null, variants: [], language, variantOf: language ? a.id : null };
      if (open) { await openArtwork(rec); setToast(language ? `This is the ${language} version. Read every line before you use it.` : `Started a new creative from “${a.name}”.`, 6000); }
      return rec;
    } catch (e) { setToast(fail(e, 'making the copy'), 9000); return null; }
  }
  async function makeLanguages(langs) {
    const a = artRefState.current, sc = sceneRef.current; if (!a?.id || !sc || !langs.length) { setToast('Upload a creative first to make language versions.'); return; }
    setLangProgress((p) => ({ ...p, ...Object.fromEntries(langs.map((l) => [l, 'pending'])) }));
    const made = [];
    let lastLangError = null;
    for (const lang of langs) {
      setLangProgress((p) => ({ ...p, [lang]: 'working' }));
      try {
        const r = await api.translate({ scene: sc, language: lang });
        const font = LANG_FONT[lang] || null; const t = r.translations || {}; const re = SCRIPT_RE[lang];
        await ensureFonts({ elements: [{ text: { fontFamily: font } }] }).catch(() => {});
        const next = { ...sc, elements: sc.elements.map((e) => { if (e.type !== 'text' || !t[e.id]) return e; const inScript = !re || re.test(t[e.id]); const changed = { ...e, text: { ...e.text, content: t[e.id], ...(font && inScript ? { fontFamily: font } : {}) } }; return t[e.id] === e.text.content ? e : fitTranslated(changed); }) };
        const rec = await duplicateArtwork({ ...a, name: displayName || a.name }, { language: lang, scene: next, open: false });
        if (rec) { made.push({ lang, rec }); setLangProgress((p) => ({ ...p, [lang]: 'done' })); const list = await api.artworks(); setArtworks(list); const me = list.find((x) => x.id === a.id); if (me && artRefState.current?.id === a.id) setArt(me); }
        else setLangProgress((p) => ({ ...p, [lang]: 'error' }));
      } catch (e) { report(e, 'making a language version', { language: lang }); lastLangError = e; setLangProgress((p) => ({ ...p, [lang]: 'error' })); }
    }
    if (made.length) { const first = made[0]; setToast(`${made.length} of ${langs.length} language version${langs.length > 1 ? 's' : ''} ready. Read every line before using them.`, 9000, { label: `Open ${first.lang}`, fn: () => openArtwork(first.rec) }); logEvent(`Made ${made.map((m) => m.lang).join(', ')} version${made.length > 1 ? 's' : ''}`); }
    else setToast(lastLangError ? explain(lastLangError, 'making the language versions') : 'No language version could be made. Try again in a minute. If it fails again, translate one language at a time.', 10000);
    setTimeout(() => setLangProgress((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v === 'error'))), 4000);
  }

  // ---- legacy-font lines: read the printed words from the original render, confirm, then keep them as real text
  async function readWords(el) {
    const id = edRef.current.bundleId; if (!id) { setToast('This works on uploaded creatives only.'); return; }
    const script = el.meta?.legacyScript || 'Indic'; setSheet({ readWords: { el, script, status: 'reading' } });
    try { const r = await api.transcribe(id, { scene: sceneRef.current, elementId: el.id, script }); setSheet({ readWords: { el, script, status: 'done', text: r.text, confidence: r.confidence, notes: r.notes } }); }
    catch (e) { setSheet({ readWords: { el, script, status: 'error', error: fail(e, 'reading the words') } }); }
  }
  function applyWords(el, text, script) {
    const font = SCRIPT_FONT[script] || null; const meta = { ...(el.meta || {}) }; delete meta.legacyFont; delete meta.legacyScript; meta.convertedFrom = el.text.fontFamily;
    const { encoding, ...rest } = el.text;
    dispatch({ type: 'replace', scene: { ...sceneRef.current, elements: sceneRef.current.elements.map((e) => (e.id === el.id ? { ...e, text: { ...rest, content: text, ...(font ? { fontFamily: font } : {}) }, meta } : e)) }, label: `Turned the ${el.name} into editable ${script} text`, ids: [el.id] });
    ensureFonts(sceneRef.current).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }); setSheet(null); setFocusKey(null); setSel([el.id]);
    setToast('Done. Check the line against the original, then edit or translate it like any other text.', 6000);
  }

  // ---- copies (versions)
  async function saveVersion(name, { quiet = false } = {}) {
    if (!scene) return null;
    try {
      if (ed.bundleId) { await ensureFonts(scene); const c = await renderToCanvas(scene, ed.assets, 1); const v = await api.versions.save(ed.bundleId, { name, scene, png: c.toDataURL('image/png'), by: by() }); setVersions((l) => [v, ...l]); refreshArtworks(); if (!quiet) setToast(`Saved a copy called “${name}”. Find it under Activity.`); return v; }
      const v = { vid: Date.now().toString(36), name, createdAt: Date.now(), scene, status: 'local' }; const k = 'hg:versions:' + ed.fileName; const list = [v, ...JSON.parse(localStorage.getItem(k) || '[]')].slice(0, 20); localStorage.setItem(k, JSON.stringify(list)); setVersions(list); if (!quiet) setToast(`Saved a copy called “${name}” on this computer.`); return v;
    } catch (e) { setToast(fail(e, 'saving the copy'), 9000); return null; }
  }
  async function restoreVersion(v) {
    try { const full = v.scene ? v : await api.versions.get(ed.bundleId, v.vid); const sc = S.understand(S.normalize(full.scene)); dispatch({ type: 'replace', scene: sc, label: `Opened the copy “${v.name}”` }); setSel([]); setToast(`Now showing the copy “${v.name}”. Undo brings back what you had.`); }
    catch (e) { setToast(fail(e, 'opening that copy'), 9000); }
  }

  // ---- controller shared with every component
  const ctl = {
    select, selectFromForm: (id) => { setSel([id]); setFocusKey(Date.now()); }, clearSel: () => setSel([]), set, ops,
    stageDown: (ev) => { setEditing(null); if (!ev || ev.button !== 0 || !artRef.current || preview) { setSel([]); return; } const r = artRef.current.getBoundingClientRect(); const z = zoomRef.current; drag.current = { kind: 'marquee', sx: ev.clientX, sy: ev.clientY, x0: (ev.clientX - r.left) / z, y0: (ev.clientY - r.top) / z, add: ev.shiftKey, base: selRef.current, moved: false }; },
    pullGuide: (ev, axis) => { ev.preventDefault(); const index = userGuidesRef.current.length; setUserGuides((g) => [...g, { axis, pos: -9999 }]); drag.current = { kind: 'guide', axis, index, inside: false }; },
    guideDown: (ev, index) => { ev.preventDefault(); ev.stopPropagation(); const g = userGuidesRef.current[index]; if (g) drag.current = { kind: 'guide', axis: g.axis, index, inside: true }; },
    clearGuides: () => setUserGuides([]),
    toggleRulers: () => setRulers((v) => { try { localStorage.setItem('hg:rulers', JSON.stringify(!v)); } catch {} return !v; }),
    togglePreview: () => { setPreview((v) => !v); setSel([]); setEditing(null); },
    showShortcuts: () => setSheet({ shortcuts: true }),
    saveNow: () => { if (!sceneRef.current) return; saveNowRef.current = true; setSaveTick((t) => t + 1); setToast(edRef.current.bundleId ? 'Saved. Your changes are also saved automatically as you work.' : 'Saved in this browser.', 3500); },
    copy: (ids) => { const n = E.copyElements(sceneRef.current, ids, edRef.current.assets); if (n) { pasteCount.current = 0; setToast(`Copied ${n > 1 ? n + ' items' : '1 item'}. Paste with ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'} V, here or in another creative.`, 3500); } },
    cut: (ids) => { const sc = sceneRef.current; const free = E.unlocked(sc, ids).map((e) => e.id); if (!free.length) return; E.copyElements(sc, free, edRef.current.assets); pasteCount.current = 0; ctlRef.current.remove(free); },
    paste: () => { const sc = sceneRef.current; const clip = E.readClipboard(); if (!sc || !clip) { setToast('Nothing to paste yet. Select something and copy it first.', 4000); return; } const out = E.pasteElements(sc, clip, ++pasteCount.current); if (!out.ids.length) return; const base = edRef.current.bundleId ? `/bundles/${edRef.current.bundleId}/` : null; out.scene.elements.filter((e) => out.ids.includes(e.id)).forEach((e) => { for (const pth of [e.asset, e.assetSvg]) if (pth && !edRef.current.assets[pth] && clip.assetUrls?.[pth]) dispatch({ type: 'asset', path: pth, url: clip.assetUrls[pth] }); }); dispatch({ type: 'replace', scene: out.scene, label: `Pasted ${out.ids.length > 1 ? out.ids.length + ' items' : '1 item'}` }); setSel(out.ids); },
    selectAll: () => { const sc = sceneRef.current; if (sc) setSel(sc.elements.filter((e) => e.type !== 'group' && e.visible && !e.locked && !e.meta?.collapsedGroup && e.role !== 'background' && (e.artboardId ?? 0) === (sc.document.activeArtboard ?? 0)).map((e) => e.id)); },
    setPage: (i) => { const sc = sceneRef.current; if (!sc) return; const n = sc.document.artboards?.length || 1; dispatch({ type: 'page', page: Math.max(0, Math.min(n - 1, i)) }); setSel([]); setEditing(null); },
    group: (ids) => { const o = E.groupOps(sceneRef.current, ids); if (o.length) ops(o, `Grouped ${o.length} items`); else setToast('Select two or more items to group them. Hold Shift and click, or drag a box around them.', 5000); },
    ungroup: (ids) => { const o = E.ungroupOps(sceneRef.current, ids); if (o.length) ops(o, 'Ungrouped'); },
    align: (ids, how) => { const o = E.alignOps(sceneRef.current, ids, how); if (o.length) ops(o, `Aligned ${o.length > 1 ? o.length + ' items' : sceneRef.current.elements.find((x) => x.id === o[0].id)?.name} ${how}`); },
    distribute: (ids, axis) => { const o = E.distributeOps(sceneRef.current, ids, axis); if (o.length) ops(o, `Spaced ${o.length} items evenly`); else setToast('Select three or more items to space them evenly.', 4000); },
    order: (ids, action) => { const o = S.reorderOps(sceneRef.current, ids, action); if (o?.length) ops(o, { front: 'Brought to front', back: 'Sent to back', forward: 'Brought forward', backward: 'Sent backward' }[action] || 'Reordered'); },
    addText: () => { const sc = sceneRef.current; if (!sc) return; const el = E.newTextElement(sc, { family: kitRef.current?.fonts.body.family || 'Lato', color: kitRef.current?.colors?.primary?.[0]?.hex || '#1A1A1A' }); dispatch({ type: 'replace', scene: { ...sc, elements: [...sc.elements, el] }, label: 'Added a text box' }); setSel([el.id]); ensureFonts({ elements: [el] }).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }); setTimeout(() => ctlRef.current.editText(el.id), 60); },
    addImage: async (f) => { const sc = sceneRef.current; if (!sc || !f) return; if (!/^image\//.test(f.type)) { setToast('That file isn’t a picture. Choose a PNG or JPG image.', 6000); return; }
      try { const url = URL.createObjectURL(f); const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('invalid image')); i.src = url; });
        const clean = (Date.now() + '-' + f.name).replace(/[^\w.-]+/g, '-'); const pth = 'user/' + clean; dispatch({ type: 'asset', path: pth, url });
        const el = E.newImageElement(sc, pth, f.name.replace(/\.[^.]+$/, ''), img.naturalWidth, img.naturalHeight); dispatch({ type: 'replace', scene: { ...sc, elements: [...sc.elements, el] }, label: `Added the picture ${el.name}` }); setSel([el.id]);
        const bid = edRef.current?.bundleId; if (bid) { const fd = new FormData(); fd.append('file', f); fd.append('name', clean); const r = await fetch(`/api/bundles/${bid}/assets`, { method: 'POST', body: fd }); if (!r.ok) throw new Error('upload ' + r.status); }
      } catch (e) { setToast(fail(e, 'adding that picture'), 9000); } },
    textStyle: (el, patch, label) => { if (editingRef.current === el.id && ('underline' in patch || 'strike' in patch) && Object.keys(patch).length === 1) { ctlRef.current.format('underline' in patch ? 'underline' : 'strike'); return; } set(el.id, { text: patch }, label); },
    toggleBold: (el) => { if (editingRef.current === el.id) { ctlRef.current.format('bold'); ensureFonts(sceneRef.current).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }); return; } const st = E.styleFrom(!E.isBoldStyle(el.text.fontStyle), E.isItalicStyle(el.text.fontStyle)); set(el.id, { text: { fontStyle: st, postScriptName: null } }, `Made the ${el.name} ${E.isBoldStyle(st) ? 'bold' : 'regular weight'}`); ensureFonts({ elements: [{ text: { ...el.text, fontStyle: st } }] }).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }); },
    toggleItalic: (el) => { if (editingRef.current === el.id) { ctlRef.current.format('italic'); return; } const st = E.styleFrom(E.isBoldStyle(el.text.fontStyle), !E.isItalicStyle(el.text.fontStyle)); set(el.id, { text: { fontStyle: st, postScriptName: null } }, `Made the ${el.name} ${E.isItalicStyle(st) ? 'italic' : 'upright'}`); ensureFonts({ elements: [{ text: { ...el.text, fontStyle: st } }] }).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }); },
    toggleCase: (el) => { const next = E.toggleCase(el.text.content); set(el.id, { text: { content: next, runs: next.length === el.text.content.length ? el.text.runs || null : null } }, `Changed the ${el.name} capitals`); },
    toggleList: (el, kind) => { if (editingRef.current === el.id) setEditing(null); const off = el.text.list === kind; const clean = R.stripTypedMarkers(el.text.content, el.text.runs); const lines = clean.content.split('\n').length; const patch = { list: off ? null : kind, content: clean.content, runs: clean.runs || null, ...(el.text.kind === 'point' && !off ? {} : {}) }; const lh = el.text.lineHeight || el.text.fontSize * 1.2; set(el.id, { text: patch, bounds: { height: Math.max(el.bounds.height, Math.round(lines * lh)), ...(el.text.kind === 'point' && !off ? { width: Math.round(el.bounds.width + R.listIndent({ ...el.text, list: kind })) } : {}) } }, off ? `Made the ${el.name} plain text again` : kind === 'bullet' ? `Made the ${el.name} a bulleted list` : `Made the ${el.name} a numbered list`); },
    openCrop: (el) => setSheet({ crop: el.id }),
    applyCrop: (el, c) => { const st = E.cropSet(el, c); set(el.id, st, st.meta.crop ? `Cropped ${el.name}` : `Removed the crop from ${el.name}`); setSheet(null); },
    openResize: () => setSheet({ resize: true }),
    applyResize: (width) => { const sc = sceneRef.current; const next = E.resizeScene(sc, width); if (next === sc) return; dispatch({ type: 'replace', scene: next, label: `Resized the creative to ${Math.round(next.document.width)} × ${Math.round(next.document.height)} px` }); setUserGuides([]); setZoomMode('fit'); setSheet(null); setToast(`Now ${Math.round(next.document.width)} × ${Math.round(next.document.height)} px. Undo puts it back.`, 6000); },
    setSize: (el, patch) => { const b = el.bounds; const lock = el.type === 'image'; let w = patch.width ?? b.width, h = patch.height ?? b.height; if (lock) { const r = b.width / b.height; if (patch.width != null) h = w / r; else w = h * r; } w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h)); set(el.id, { bounds: { width: w, height: h } }, `Resized ${el.name} to ${w} × ${h} px`); },
    elDown: (ev, id) => startDrag(ev, id, 'move'), handleDown: (ev, id, h) => startDrag(ev, id, 'resize', h), rotateDown: (ev, id) => startDrag(ev, id, 'rotate'), hover: setHover,
    editText: (id) => { const el = sceneRef.current?.elements.find((x) => x.id === id); if (!el || el.type !== 'text' || el.locked) return; setFocusKey(null); setSel([id]); editSnapped.current = false; setEditing(id); },
    editInput: (id, text) => { if (!editSnapped.current) { const el = sceneRef.current?.elements.find((x) => x.id === id); dispatch({ type: 'snapshot', label: `Changed the ${el?.name || 'text'}`, ids: [id] }); editSnapped.current = true; } const rich = typeof text === 'string' ? { content: text.replace(/\n$/, ''), runs: null } : text; set(id, { text: { content: rich.content, runs: rich.runs || null } }, null, false); },
    // Style only the highlighted words while typing. The browser applies it to the selection, then the box is read back into content + ranges.
    format: (cmd) => { if (!editingRef.current) return false; try { document.execCommand('styleWithCSS', false, false); document.execCommand(cmd === 'strike' ? 'strikeThrough' : cmd, false, null); } catch { return false; } const node = document.querySelector('.el.text.editing'); if (node) ctlRef.current.editInput(editingRef.current, R.fromDom(node)); return true; },
    editEnd: () => setEditing(null),
    fieldEdit: (id, text) => { if (fieldSnap.current.id !== id || !fieldSnap.current.snapped) { const el = sceneRef.current?.elements.find((x) => x.id === id); dispatch({ type: 'snapshot', label: `Changed the ${el?.name || 'text'}`, ids: [id] }); fieldSnap.current = { id, snapped: true }; } set(id, { text: { content: text } }, null, false); },
    fieldEnd: () => { fieldSnap.current = { id: null, snapped: false }; },
    setFontSize: (el, fs, label) => set(el.id, { text: { fontSize: fs, ...(el.text.lineHeight ? { lineHeight: Math.round(el.text.lineHeight * fs / el.text.fontSize * 100) / 100 } : {}) } }, label),
    setLock: (el, locked) => set(el.id, { locked, meta: { lockedBy: locked ? 'user' : 'unlocked' } }, `${locked ? 'Locked' : 'Unlocked'} ${el.name}`),
    duplicate: (ids) => { const sc = sceneRef.current; if (!sc) return; const out = S.duplicateElements(sc, ids.flatMap((i) => { const e = sc.elements.find((x) => x.id === i); return e?.semanticGroup ? sc.elements.filter((x) => x.semanticGroup === e.semanticGroup).map((x) => x.id) : [i]; })); if (!out.ids.length) return; dispatch({ type: 'replace', scene: out.scene, label: `Duplicated ${ids.length > 1 ? ids.length + ' items' : sc.elements.find((x) => x.id === ids[0])?.name}` }); setSel(out.ids); },
    remove: (ids) => { const sc = sceneRef.current; if (!sc) return; const all = [...new Set(ids.flatMap((i) => { const e = sc.elements.find((x) => x.id === i); if (!e || e.locked) return []; return e.semanticGroup ? sc.elements.filter((x) => x.semanticGroup === e.semanticGroup && !x.locked).map((x) => x.id) : [i]; }))]; if (!all.length) { setToast('That item is fixed by the brand. Unlock it first if you really want to delete it.'); return; } dispatch({ type: 'replace', scene: S.deleteElements(sc, all), label: `Deleted ${all.length > 1 ? all.length + ' items' : sc.elements.find((x) => x.id === all[0])?.name}`, ids: all }); setSel([]); },
    resetElement: (id) => { const o = ed.original?.elements.find((e) => e.id === id); const cur = sceneRef.current?.elements.find((e) => e.id === id); if (!o || !cur) return; set(id, { bounds: { ...o.bounds }, ...(o.text ? { text: { ...o.text } } : {}), fill: o.fill, visible: o.visible, opacity: o.opacity, transform: { ...o.transform }, asset: o.asset, assetSvg: o.assetSvg, renderMode: o.renderMode ?? null, meta: { cornerRadius: o.meta?.cornerRadius } }, `Reset ${cur.name}`); },
    resetAll: () => { if (!ed.original) return; dispatch({ type: 'reset' }); setSel([]); setEditing(null); setToast('Back to the uploaded file. Undo if you didn’t mean that.'); },
    replaceImage: (id, f) => { const clean = (Date.now() + '-' + f.name).replace(/[^\w.-]+/g, '-'); const p = 'user/' + clean; dispatch({ type: 'asset', path: p, url: URL.createObjectURL(f) }); const bid = edRef.current?.bundleId; if (bid) { const fd = new FormData(); fd.append('file', f); fd.append('name', clean); fetch(`/api/bundles/${bid}/assets`, { method: 'POST', body: fd }).then((r) => { if (!r.ok) throw new Error(); }).catch(() => setToast('That image could not be saved with the creative. It will be missing after a reload, so add it again.', 9000)); } const el = sceneRef.current?.elements.find((x) => x.id === id); set(id, { asset: p, assetSvg: null, renderMode: null }, `Replaced the image in ${el?.name || 'an item'}`); },
    runIssueAction: (i) => {
      const a = i.action; const sc = sceneRef.current; if (!a || !sc) return; const el = sc.elements.find((e) => e.id === a.elementId);
      if (a.type === 'select') { setFocusKey(null); setSel([a.elementId]); }
      else if (a.type === 'fitText' && el) { const fs = fitFontSize(el); set(el.id, { text: { fontSize: fs, lineHeight: el.text.lineHeight ? Math.round(el.text.lineHeight * fs / el.text.fontSize * 100) / 100 : null } }, `Shrunk ${el.name} to fit`); }
      else if (a.type === 'replaceFont') setSheet({ fontReplace: a.family });
      else if (a.type === 'logoSurface' && el) { const logo = kitRef.current?.logos.find((l) => l.id === a.logoId); if (logo) ctlRef.current.replaceLogo(logo, el.id); }
      else if (a.type === 'brandColor' && el) set(el.id, el.type === 'text' ? { fill: a.hex } : { fill: a.hex, renderMode: 'css' }, `Recoloured ${el.name} to ${a.name}`);
      else if (a.type === 'brandFont' && el) { set(el.id, { text: { fontFamily: a.family } }, `Switched ${el.name} to ${a.family}`); ensureFonts({ elements: [{ text: { fontFamily: a.family } }] }).then(() => { forgetFonts(); setFontsTick((t) => t + 1); }); }
    },
    replaceFont: async (from, to) => { const sc = sceneRef.current; const els = sc.elements.filter((e) => e.text?.fontFamily === from); ops(els.map((e) => ({ id: e.id, set: { text: { fontFamily: to } } })), `Replaced the font ${from} with ${to}`); setSheet(null); await ensureFonts({ elements: [{ text: { fontFamily: to } }] }); forgetFonts(); setFontsTick((t) => t + 1); },
    insertLogo: (logo, at) => { const k = kitRef.current, sc = sceneRef.current; if (!k || !sc) return; const w = sc.document.width, h = sc.document.height, m = safeMargin(w, h); const width = at?.width || Math.max(120, Math.min(360, Math.round(w * 0.22))); const height = Math.round(width * logo.h / logo.w);
      const path = `brand/${logo.file}`; dispatch({ type: 'asset', path, url: k.base + logo.file });
      const el = { id: 'el_brand_' + Date.now().toString(36), type: 'image', name: logo.name, parentId: null, artboardId: 0, zIndex: Math.max(0, ...sc.elements.map((e) => e.zIndex)) + 1, bounds: { x: at?.x ?? m, y: at?.y ?? m, width, height }, transform: { rotation: 0, scaleX: 1, scaleY: 1 }, fill: null, gradient: null, stroke: null, opacity: 1, blendMode: 'normal', asset: null, assetSvg: path, editable: true, locked: false, visible: true, role: 'logo', meta: { brand: k.id, logo: logo.id } };
      const b = at?.scene || sc; dispatch({ type: 'replace', scene: { ...b, elements: [...b.elements, el] }, label: at?.label || `Added the ${logo.name}` }); setFocusKey(null); setSel([el.id]); },
    replaceLogo: (logo, id) => { const sc = sceneRef.current; if (!sc) return; const target = sc.elements.find((e) => e.id === (id || selRef.current[0]) && e.role === 'logo'); const old = target ? (target.semanticGroup ? sc.elements.filter((e) => e.semanticGroup === target.semanticGroup) : [target]) : sc.elements.filter((e) => e.role === 'logo' && e.visible); if (!old.length) return ctlRef.current.insertLogo(logo);
      const u = unionBounds(old.map((e) => e.bounds)); const hidden = S.applyOps(sc, old.map((e) => ({ id: e.id, set: { visible: false, locked: false } })));
      ctlRef.current.insertLogo(logo, { x: Math.round(u.x), y: Math.round(u.y), width: Math.round(u.width), scene: hidden, label: `Swapped the logo for ${logo.name}` }); },
    uploadFont: async (file) => { try { const f = await uploadFont(file); setFontLib(libraryFonts()); forgetFonts(); setFontsTick((t) => t + 1); const sc = sceneRef.current; if (sc) { const mapped = mapSceneFonts(structuredClone(sc)); if (JSON.stringify(mapped) !== JSON.stringify(sc)) dispatch({ type: 'replace', scene: mapped, label: `Applied the font ${f.family}` }); } setToast(`Stored ${f.family}${f.style && f.style !== 'Regular' ? ' ' + f.style : ''}. Text in that font now shows correctly here and in downloads.`, 6000); return f; } catch (e) { setToast('Could not store that font: ' + e.message, 6000); return null; } },
    surfaceAtDefault: () => { const k = kitRef.current, sc = sceneRef.current; if (!k || !sc) return Promise.resolve(null); const w = sc.document.width, h = sc.document.height, m = safeMargin(w, h); const width = Math.max(120, Math.min(360, Math.round(w * 0.22))); return surfaceUnder(sc, edRef.current.assets, { x: m, y: m, width, height: Math.round(width * 0.18) }); },
    runChat, undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }),
    saveVersion, restoreVersion, rename, renameArtwork: (a, n) => api.bundles.meta(a.id, { name: n, by: by() }).then(refreshArtworks).catch(() => {}), duplicateArtwork, startNewLikeThis: () => { const a = artRefState.current; if (a?.id) duplicateArtwork({ ...a, name: displayName || a.name }); else setToast('Upload a creative first.'); },
    archiveArtwork: (a) => api.bundles.meta(a.id, { archived: true, by: by() }).then(refreshArtworks).catch(() => {}), openVariant: (v) => openArtwork({ id: v.id, bundle: `/bundles/${v.id}/`, name: v.name, language: v.language, variants: [] }), makeLanguages, openFileCheck: () => { const a = artRefState.current; if (a?.readiness) setSheet({ fileCheck: a.readiness, name: displayName || a.name }); }, setUser, logEvent, readWords,
    setZoom: (z) => { setZoom(Math.min(4, Math.max(.1, z))); setZoomMode('manual'); }, fit: () => setZoomMode('fit'),
    toggleOriginal: () => setShowOriginal((v) => !v), toggleLayers: () => setLayersOpen((v) => !v), toggleContents: () => setContentsOpen((v) => !v), toggleAssist: () => setAssistOpen((v) => !v),
    exportAs, exportSceneJson: () => scene && download(`${base()}-${W}x${H}.scene.json`, 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(scene, null, 2))),
    pickAi: (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) runIngest(f, f.name); },
    ingestSample: (n) => runIngest(n, n), openArtwork, openDemo,
    goHome: () => { setView('home'); setSel([]); setEditing(null); refreshArtworks(); },
    pickFolder: async (ev) => { const files = [...ev.target.files]; ev.target.value = ''; try { openBundle(await loadFiles(files)); } catch (e) { setToast(fail(e, 'opening that folder'), 9000); } },
    pickZip: async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; try { openBundle(await loadZip(f)); } catch (e) { setToast(fail(e, 'reading that zip'), 9000); } },
  };
  const ctlRef = useRef(ctl); ctlRef.current = ctl;
  if (import.meta.env.DEV) window.__hg = { scene, ed, assets: ed.assets, S, issues, ctl, kit, exportFile, view };

  return (
    <div className={'app' + (dropping ? ' dropping' : '')} onDragOver={(e) => { e.preventDefault(); if (!dropping) setDropping(true); }} onDragLeave={() => dropping && setDropping(false)} onDrop={onDrop}>
      {view === 'home' || !scene ? (
        <Home kit={kit} artworks={artworks} job={job} samples={samples} fonts={fontLib} user={user} onUser={setUser} ctl={ctl} />
      ) : (
        <div className={"editor" + (preview ? " preview-mode" : "")}>
          <EditorHeader kit={kit} name={displayName || ed.fileName || scene.document.name} saveState={saveState} exporting={exporting} exportTick={exportTick} lastFormat={lastFormat} langProgress={langProgress} designer={DESIGNER} canUndo={ed.undo.length > 0} canRedo={ed.redo.length > 0} undo={ed.undo} redo={ed.redo} past={past} versions={versions} user={user} onUser={setUser} contentsOpen={contentsOpen} hasCheck={!!art?.readiness} variants={art?.variants || []} language={art?.language || null} ctl={ctl} />
          <Toolbar scene={scene} sel={sel} kit={kit} palette={palette} fullPalette={fullPalette} surfaces={surfaces} editing={editing} ctl={ctl} />
          {art?.readiness && art.readiness.grade !== 'ready' && !bannerGone[ed.bundleId] && !dismissedBanner(ed.bundleId) && (
            <div className={'ready-banner ' + (art.readiness.grade === 'limited' ? 'bad' : 'warn')} role="status">
              <b>{art.readiness.grade === 'limited' ? 'Limited' : 'Partly editable'}</b><span>{art.readiness.items.find((i) => !i.ok)?.text}</span>
              <button className="linkbtn" onClick={() => setSheet({ fileCheck: art.readiness, name: displayName || art.name })}>See what you can change</button>
              <span className="spacer" /><button className="tb" aria-label="Dismiss" onClick={() => { setBannerGone((g) => ({ ...g, [ed.bundleId]: true })); try { localStorage.setItem('hg:fc:' + ed.bundleId, '1'); } catch {} }}>✕</button>
            </div>
          )}
          <div className="ebody">
            {contentsOpen && (
              <aside className="side">
                <Form scene={scene} assets={ed.assets} sel={sel} palette={palette} fullPalette={fullPalette} kit={kit} focusKey={focusKey} surfaces={surfaces} ctl={ctl} />
                {DESIGNER && layersOpen && <section className="activity"><div className="field-label">Layers (developer)</div><Layers scene={scene} sel={sel} ctl={ctl} /></section>}
              </aside>
            )}
            <div className={'stage-wrap' + (rulers && !preview ? ' rulers' : '')}>
              {rulers && !preview && <Rulers stageRef={stageRef} artRef={artRef} zoom={zoom} W={W} H={H} onPull={ctl.pullGuide} />}
              <Canvas scene={scene} W={W} H={H} zoom={zoom} assets={ed.assets} sel={sel} hover={hover} editing={editing} guides={guides} userGuides={userGuides} marquee={marquee} preview={preview} dragging={dragging} showOriginal={showOriginal} referenceUrl={referenceUrl} job={job} stageRef={stageRef} artRef={artRef} ctl={ctl} />
              <div className="assist" onMouseDown={(e) => e.stopPropagation()}>
                {assistOpen && <div className="assist-pop"><AskBox exchanges={exchanges} busy={busy} draft={draft} setDraft={setDraft} examples={EXAMPLES} undoLen={ed.undo.length} online={status.claude} ctl={ctl} /></div>}
                <button className={'spark' + (assistOpen ? ' on' : '') + (!assistOpen && assistVisits.current <= 3 ? ' labelled' : '')} onClick={ctl.toggleAssist} aria-expanded={assistOpen} title={assistOpen ? 'Close' : 'Ask for a change'}>{assistOpen ? '✕' : assistVisits.current <= 3 ? '✦ Ask for a change' : '✦'}</button>
              </div>
            </div>
          </div>
          <BottomBar scene={scene} issues={issues} W={W} H={H} zoom={zoom} zoomMode={zoomMode} showOriginal={showOriginal} hasReference={!!referenceUrl} rulers={rulers} guideCount={userGuides.length} page={scene?.document.activeArtboard ?? 0} pages={scene?.document.artboards?.length || 1} ctl={ctl} />
        </div>
      )}
      {toast && <div className="toast" role="status" key={toast.at}>{toast.text}{toast.action && <button className="btn small toast-action" onClick={() => { setToast(null); toast.action.fn(); }}>{toast.action.label}</button>}<button className="linkbtn" onClick={() => setToast(null)}>Dismiss</button></div>}
      {sheet?.name && <NameSheet value={user} onClose={() => setSheet(null)} onSave={(n) => { setUser(n); setSheet(null); setToast(`Changes are now recorded as ${n}.`); }} />}
      {sheet?.readWords && <ReadWordsSheet {...sheet.readWords} font={SCRIPT_FONT[sheet.readWords.script] || null} onClose={() => setSheet(null)} onApply={(text) => applyWords(sheet.readWords.el, text, sheet.readWords.script)} onRetry={() => readWords(sheet.readWords.el)} />}
      {preview && <div className="preview-bar"><span className="hintsm">Preview · Esc to go back</span><button className="btn small" onClick={() => setPreview(false)}>Back to editing</button></div>}
      {sheet?.shortcuts && <ShortcutsSheet onClose={() => setSheet(null)} />}
      {sheet?.resize && scene && <ResizeSheet W={W} H={H} onClose={() => setSheet(null)} onApply={ctl.applyResize} />}
      {sheet?.crop && scene && (() => { const el = scene.elements.find((x) => x.id === sheet.crop); const url = el && (ed.assets[el.asset] || ed.assets[el.assetSvg]); return el && url ? <CropSheet el={el} url={url} onClose={() => setSheet(null)} onApply={(c) => ctl.applyCrop(el, c)} /> : null; })()}
      {sheet?.fileCheck && <FileCheck readiness={sheet.fileCheck} name={sheet.name} kit={kit} onClose={() => setSheet(null)} onStart={() => setSheet(null)} />}
      {sheet?.fontReplace && <FontReplaceSheet family={sheet.fontReplace} suggest={kit?.fonts.body.family} onClose={() => setSheet(null)} onPick={(to) => ctl.replaceFont(sheet.fontReplace, to)} onUpload={async (file) => { const f = await ctl.uploadFont(file); if (f) setSheet(null); }} />}
    </div>
  );
}
