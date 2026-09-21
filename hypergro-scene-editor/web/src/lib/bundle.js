// Loading scene bundles from a picked folder, a .zip, or a server URL. Returns {raw, assets, name}.
import JSZip from 'jszip';

export const addAssets = (raw, assets, resolve) => {
  const add = (p) => { if (p && !assets[p]) assets[p] = resolve(p); };
  (raw.assets || []).forEach((a) => add(a.path));
  (raw.elements || []).forEach((e) => { add(e.asset); add(e.assetSvg); });
  (raw.document?.artboards || []).forEach((a) => { add(a.reference); add(a.artwork); add(a.preview); });
};

export async function loadFiles(files, label) {
  const byPath = {};
  files.forEach((f) => { const parts = (f.webkitRelativePath || f.name).split('/'); byPath[parts.length > 1 ? parts.slice(1).join('/') : parts[0]] = f; });
  const sj = Object.keys(byPath).find((k) => /(^|\/)scene\.json$/.test(k));
  if (!sj) throw new Error('No scene.json in that folder');
  const dir = sj.replace(/scene\.json$/, ''); const raw = JSON.parse(await byPath[sj].text()); const assets = {};
  Object.keys(byPath).forEach((k) => { if (k.startsWith(dir) && k !== sj) assets[k.slice(dir.length)] = URL.createObjectURL(byPath[k]); });
  return { raw, assets, name: label || sj.replace(/\/?scene\.json$/, '') || 'scene' };
}

export async function loadZip(file) {
  const zip = await JSZip.loadAsync(file); const files = [];
  for (const [p, f] of Object.entries(zip.files)) { if (f.dir) continue; const blob = await f.async('blob'); const fo = new File([blob], p.split('/').pop()); Object.defineProperty(fo, 'webkitRelativePath', { value: 'zip/' + p }); files.push(fo); }
  return loadFiles(files, file.name);
}

export async function loadUrl(base, name) {
  if (!base.endsWith('/')) base += '/';
  const r = await fetch(base + 'scene.json'); if (!r.ok) throw new Error(`Could not load ${base}scene.json (${r.status})`);
  const raw = await r.json(); const assets = {};
  addAssets(raw, assets, (p) => base + p);
  return { raw, assets, name: name || raw.document?.name || base };
}

// Read dropped items (folders included) into File objects with webkitRelativePath set.
export function readDrop(dataTransfer) {
  const files = []; const items = [...(dataTransfer.items || [])];
  const readEntry = (entry, prefix) => new Promise((res) => {
    if (entry.isFile) entry.file((f) => { Object.defineProperty(f, 'webkitRelativePath', { value: prefix + f.name }); files.push(f); res(); });
    else { const rd = entry.createReader(); const all = []; const next = () => rd.readEntries(async (ents) => { if (!ents.length) { for (const e of all) await readEntry(e, prefix + entry.name + '/'); res(); } else { all.push(...ents); next(); } }); next(); }
  });
  return (async () => { for (const it of items) { const en = it.webkitGetAsEntry?.(); if (en) await readEntry(en, 'root/'); } if (!files.length) files.push(...dataTransfer.files); return files; })();
}
