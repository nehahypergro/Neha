// Scene state: the working scene, the untouched original for resets, the assets map, and a labelled undo/redo
// history where every entry also records which elements it touched (shown as plain sentences in the Activity list).
import { useReducer } from 'react';
import * as S from '../../shared/scene.js';

const initial = { scene: null, original: null, assets: {}, fileName: '', bundleId: null, info: null, undo: [], redo: [] };
const sig = (e) => JSON.stringify([e.bounds, e.text, e.fill, e.visible, e.locked, e.opacity, e.zIndex, e.asset, e.assetSvg, e.renderMode, e.meta, e.name, e.role, e.transform]);
const diffIds = (a, b) => {
  if (!a || !b) return [];
  const am = new Map(a.elements.map((e) => [e.id, e])), bm = new Map(b.elements.map((e) => [e.id, e])); const ids = [];
  for (const [id, e] of bm) { const o = am.get(id); if (!o || sig(o) !== sig(e)) ids.push(id); }
  for (const id of am.keys()) if (!bm.has(id)) ids.push(id);
  return ids;
};
const describe = (ids, ...scenes) => ids.map((id) => { const e = scenes.map((s) => s?.elements.find((x) => x.id === id)).find(Boolean); return e ? { id, type: e.type, name: e.name, fill: e.type !== 'text' && e.fill ? e.fill : null } : null; }).filter(Boolean).slice(0, 8);
const record = (s, label, ids, next) => ({ ...s, undo: [...s.undo.slice(-79), { scene: s.scene, label: label || 'Edit', at: Date.now(), items: describe(ids || diffIds(s.scene, next), next, s.scene) }], redo: [] });

function reducer(s, a) {
  switch (a.type) {
    case 'open': return { ...s, scene: a.scene, original: a.original || a.scene, assets: a.assets, fileName: a.name, bundleId: a.bundleId || null, info: a.info || null, undo: [], redo: [] };
    case 'snapshot': return record(s, a.label, a.ids || [], s.scene);
    case 'ops': case 'replace': {
      if (!s.scene) return s;
      const next = a.type === 'ops' ? S.applyOps(s.scene, a.ops) : a.scene;
      return { ...(a.record === false ? s : record(s, a.label, a.ids || (a.type === 'ops' ? a.ops.map((o) => o.id) : null), next)), scene: next };
    }
    case 'reset': return s.original ? { ...record(s, 'Reset to original', diffIds(s.scene, s.original), s.original), scene: s.original } : s;
    case 'undo': { const p = s.undo[s.undo.length - 1]; if (!p) return s; return { ...s, undo: s.undo.slice(0, -1), redo: [...s.redo, { scene: s.scene, label: p.label, at: p.at, items: p.items }], scene: p.scene }; }
    case 'redo': { const n = s.redo[s.redo.length - 1]; if (!n) return s; return { ...s, redo: s.redo.slice(0, -1), undo: [...s.undo, { scene: s.scene, label: n.label, at: n.at, items: n.items }], scene: n.scene }; }
    case 'undoTo': { let st = s; while (st.undo.length > a.depth) st = reducer(st, { type: 'undo' }); return st; }
    case 'asset': return { ...s, assets: { ...s.assets, [a.path]: a.url } };
    default: return s;
  }
}

export function useEditor() { return useReducer(reducer, initial); }
