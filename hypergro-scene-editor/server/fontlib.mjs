// Team font library: TTF/OTF files the brand actually uses, stored under data/fonts/library and matched by the names
// inside the font (family, style, PostScript name) rather than by file name. Served to the editor as @font-face and
// to the PDF/.ai exporter, and consulted at ingest so extracted text points at the real face.
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFontName } from '../shared/fontname.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const u16 = (b, o) => b.readUInt16BE(o), u32 = (b, o) => b.readUInt32BE(o);
const tables = (b) => {
  let off = 0; if (b.toString('ascii', 0, 4) === 'ttcf') off = u32(b, 12); // first face of a collection
  const n = u16(b, off + 4); const out = {};
  for (let i = 0; i < n; i++) { const r = off + 12 + i * 16; out[b.toString('ascii', r, r + 4)] = { offset: u32(b, r + 8), length: u32(b, r + 12) }; }
  return out;
};

/** Names, weight and coverage read from a TrueType/OpenType file. */
/** The letters a TrueType file can really draw: code points whose glyph has an outline (plus the space). Fonts pulled out
 *  of a designer's file keep the full character map but only the outlines that file used; everything else is blank. The
 *  result is a CSS unicode-range, so the browser uses the partial font for exactly those letters and another font for the rest. */
export function drawableRange(b) {
  const t = tables(b); if (!t.cmap || !t.loca || !t.head || !t.maxp) return null;
  const long = u16(b, t.head.offset + 50) === 1, n = u16(b, t.maxp.offset + 4); const lo = t.loca.offset;
  const has = (g) => { if (g <= 0 || g >= n) return false; const a = long ? u32(b, lo + g * 4) : u16(b, lo + g * 2) * 2, z = long ? u32(b, lo + (g + 1) * 4) : u16(b, lo + (g + 1) * 2) * 2; return z > a; };
  const cps = new Set(); const base = t.cmap.offset, subs = u16(b, base + 2);
  for (let i = 0; i < subs; i++) {
    const sub = base + u32(b, base + 4 + i * 8 + 4); const fmt = u16(b, sub);
    if (fmt === 4) { const segs = u16(b, sub + 6) / 2; const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, offs = deltas + segs * 2;
      for (let k = 0; k < segs; k++) { const a = u16(b, starts + k * 2), z = u16(b, ends + k * 2), d = u16(b, deltas + k * 2), ro = u16(b, offs + k * 2); if (a === 0xFFFF) continue;
        for (let c = a; c <= z && c < 0xFFFF; c++) { let g; if (ro === 0) g = (c + d) & 0xFFFF; else { const at = offs + k * 2 + ro + (c - a) * 2; if (at + 2 > b.length) break; g = u16(b, at); if (g) g = (g + d) & 0xFFFF; } if (has(g) || (c === 0x20 && g > 0)) cps.add(c); } } }
    else if (fmt === 12) { const groups = u32(b, sub + 12); for (let g = 0; g < groups; g++) { const r = sub + 16 + g * 12; const a = u32(b, r), z = u32(b, r + 4), g0 = u32(b, r + 8); for (let c = a; c <= z && c - a < 70000; c++) if (has(g0 + (c - a)) || c === 0x20) cps.add(c); } }
    else if (fmt === 0) { for (let c = 0; c < 256; c++) { const g = b[sub + 6 + c]; if (has(g) || (c === 0x20 && g > 0)) cps.add(c); } }
    else if (fmt === 6) { const first = u16(b, sub + 6), cnt = u16(b, sub + 8); for (let k = 0; k < cnt; k++) { const g = u16(b, sub + 10 + k * 2); if (has(g)) cps.add(first + k); } }
  }
  if (!cps.size) return null; const list = [...cps].sort((x, y) => x - y); const parts = []; let a = list[0], z = list[0];
  for (const c of list.slice(1)) { if (c === z + 1) z = c; else { parts.push([a, z]); a = z = c; } } parts.push([a, z]);
  return { count: list.length, css: parts.map(([x, y]) => (x === y ? `U+${x.toString(16)}` : `U+${x.toString(16)}-${y.toString(16)}`)).join(',') };
}

export function parseFont(b) {
  const t = tables(b); const out = { family: null, subfamily: 'Regular', fullName: null, postScriptName: null, weight: 400, italic: false, scripts: [], glyphs: 0 };
  if (t.name) {
    const base = t.name.offset, count = u16(b, base + 2), strOff = base + u16(b, base + 4); const names = {};
    for (let i = 0; i < count; i++) {
      const r = base + 6 + i * 12; const platform = u16(b, r), enc = u16(b, r + 2), id = u16(b, r + 6), len = u16(b, r + 8), off = u16(b, r + 10);
      const raw = b.subarray(strOff + off, strOff + off + len); let s;
      try { s = platform === 3 || platform === 0 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1'); } catch { continue; }
      s = s.replace(/\0/g, '').trim(); if (!s) continue;
      const key = `${id}`; if (!names[key] || platform === 3) names[key] = s; // prefer Windows names
    }
    const strip = (v) => (v ? v.replace(/^[A-Z]{6}\+/, '') : v); // subset tag Illustrator adds to embedded fonts
    out.family = strip(names['16'] || names['1'] || null); out.subfamily = names['17'] || names['2'] || 'Regular';
    out.fullName = strip(names['4'] || null); out.postScriptName = strip(names['6'] || null);
  }
  if (t['OS/2']) { const o = t['OS/2'].offset; out.weight = u16(b, o + 4) || 400; out.italic = !!(u16(b, o + 62) & 1); }
  if (t.head && !out.italic) out.italic = !!(u16(b, t.head.offset + 44) & 2);
  if (/italic|oblique/i.test(out.subfamily)) out.italic = true;
  if (t.maxp) out.glyphs = u16(b, t.maxp.offset + 4);
  // Unicode coverage by script: walk the cmap's format 4 / 12 subtables.
  if (t.cmap) {
    const base = t.cmap.offset, n = u16(b, base + 2); const ranges = [];
    for (let i = 0; i < n; i++) {
      const sub = base + u32(b, base + 4 + i * 8 + 4); const fmt = u16(b, sub);
      if (fmt === 4) { const segX2 = u16(b, sub + 6); const ends = sub + 14, starts = ends + segX2 + 2; for (let s = 0; s < segX2 / 2; s++) ranges.push([u16(b, starts + s * 2), u16(b, ends + s * 2)]); }
      else if (fmt === 12) { const groups = u32(b, sub + 12); for (let g = 0; g < groups; g++) { const r = sub + 16 + g * 12; ranges.push([u32(b, r), u32(b, r + 4)]); } }
    }
    const covers = (lo, hi) => ranges.some(([a, z]) => a <= hi && z >= lo && z !== 0xFFFF);
    const SCRIPTS = [['devanagari', 0x900, 0x97F], ['bengali', 0x980, 0x9FF], ['gurmukhi', 0xA00, 0xA7F], ['gujarati', 0xA80, 0xAFF], ['oriya', 0xB00, 0xB7F], ['tamil', 0xB80, 0xBFF], ['telugu', 0xC00, 0xC7F], ['kannada', 0xC80, 0xCFF], ['malayalam', 0xD00, 0xD7F], ['arabic', 0x600, 0x6FF], ['latin', 0x41, 0x7A]];
    out.scripts = SCRIPTS.filter(([, lo, hi]) => covers(lo, hi)).map(([s]) => s);
    out.rupee = covers(0x20B9, 0x20B9); // ₹
  }
  // Legacy Indic faces (Shree Lipi, Kruti Dev, DV-TT…) map their letters onto Latin codes: a small, Latin-only cmap.
  const latinOnly = out.scripts.every((s) => s === 'latin');
  const name = `${out.family || ''} ${out.postScriptName || ''}`;
  const vendor = /shree|kruti|devlys|chanakya|walkman|baraha|amar|aakar|dv-?tt|dvb-?tt|akshar|shivaji|iskcon|sanskrit ?99|lmg|gopika|saumil|tamil ?bible|tab-|tam-|tscii|apple ?tamil|latha ?legacy|kalinga ?legacy/i.test(name);
  out.legacy = latinOnly && out.glyphs > 0 && ((vendor && out.glyphs < 400) || out.glyphs < 200);
  if (out.legacy) {
    const key = name.toLowerCase();
    const SCRIPT = [['telugu', /\btel|telugu/], ['tamil', /\btam|tamil|tscii|tab-/], ['kannada', /\bkan|kannada/], ['malayalam', /\bmal|malayalam/], ['odia', /\bori|odia|oriya|kalinga/], ['punjabi', /\bpun|gurmukhi|punjabi/], ['gujarati', /\bguj|gujarati|lmg|gopika|saumil/], ['bangla', /\bban|bangla|bengali/], ['assamese', /\bass|assam/], ['hindi', /\bdev|hindi|kruti|devlys|chanakya|walkman|dv-?tt|marathi|\bmar/]];
    out.legacyScript = SCRIPT.find(([, re]) => re.test(key))?.[0] || 'Indic';
  }
  return out;
}

const STYLE_WORDS = (w, italic) => `${w >= 850 ? 'Black' : w >= 750 ? 'ExtraBold' : w >= 650 ? 'Bold' : w >= 550 ? 'SemiBold' : w >= 450 ? 'Medium' : w >= 350 ? 'Regular' : w >= 250 ? 'Light' : 'Thin'}${italic ? ' Italic' : ''}`.replace(/^Regular Italic$/, 'Italic');

// Subsets usually carry the PostScript name as their family ("Montserrat-Bold"): read family + style out of it.
/** Rebuild an sfnt so browsers accept it: fonts pulled out of a PDF often have tables at odd offsets, which Chrome's
 *  sanitizer rejects ("misaligned table"). Tables are re-laid on 4-byte boundaries, checksums recomputed, the
 *  Apple-only 'true' tag replaced with the standard version. Returns the input untouched when it is not a TrueType sfnt. */
export function realignSfnt(buf) {
  const b = Buffer.from(buf); if (b.length < 12) return b;
  const tag = b.readUInt32BE(0); if (tag !== 0x00010000 && tag !== 0x74727565 /* 'true' */) return b; // OpenType CFF and collections are left alone
  const n = b.readUInt16BE(4); const tables = [];
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; if (o + 16 > b.length) return b; const name = b.toString('latin1', o, o + 4), off = b.readUInt32BE(o + 8), len = b.readUInt32BE(o + 12); if (off + len > b.length) return b; tables.push({ name, data: b.subarray(off, off + len) }); }
  tables.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  const pad = (x) => (x + 3) & ~3; let size = 12 + n * 16; for (const t of tables) size += pad(t.data.length);
  const out = Buffer.alloc(size); out.writeUInt32BE(0x00010000, 0); out.writeUInt16BE(n, 4);
  let es = 0; while ((1 << (es + 1)) <= n) es++; const sr = (1 << es) * 16; out.writeUInt16BE(sr, 6); out.writeUInt16BE(es, 8); out.writeUInt16BE(n * 16 - sr, 10);
  const sum = (d, o, l) => { let s = 0; for (let i = 0; i < l; i += 4) s = (s + (((d[o + i] || 0) << 24) | ((d[o + i + 1] || 0) << 16) | ((d[o + i + 2] || 0) << 8) | (d[o + i + 3] || 0))) >>> 0; return s; };
  let off = 12 + n * 16, headAt = -1;
  tables.forEach((t, i) => { const o = 12 + i * 16; out.write(t.name, o, 4, 'latin1'); t.data.copy(out, off); if (t.name === 'head') { headAt = off; out.writeUInt32BE(0, off + 8); } out.writeUInt32BE(sum(out, off, t.data.length), o + 4); out.writeUInt32BE(off, o + 8); out.writeUInt32BE(t.data.length, o + 12); off += pad(t.data.length); });
  if (headAt >= 0) out.writeUInt32BE((0xB1B0AFBA - sum(out, 0, out.length)) >>> 0, headAt + 8);
  return out;
}

function tidyNames(p) {
  if (/^[\w]+-[\w]+$/.test(p.family) || (!/\s/.test(p.family) && /-/.test(p.postScriptName || ''))) { const parsed = parseFontName(p.postScriptName || p.family, { bold: p.weight >= 600, italic: p.italic }); p.family = parsed.family; p.subfamily = parsed.style; p.italic = /italic/i.test(parsed.style); p.weight = /black/i.test(parsed.style) ? 900 : /extrabold/i.test(parsed.style) ? 800 : /bold/i.test(parsed.style) ? 700 : /semibold/i.test(parsed.style) ? 600 : /medium/i.test(parsed.style) ? 500 : /light/i.test(parsed.style) ? 300 : 400; }
  return p;
}
export class FontLibrary {
  /** `dir` holds full fonts people uploaded; `embeddedDir` holds partial fonts pulled out of uploaded .ai files (marked subset). */
  constructor(dir, embeddedDir = null) { this.dir = dir; this.embeddedDir = embeddedDir; this.index = []; this.stamp = 0; }
  async scan() {
    await mkdir(this.dir, { recursive: true }); if (this.embeddedDir) await mkdir(this.embeddedDir, { recursive: true });
    const dirs = [[this.dir, false], ...(this.embeddedDir ? [[this.embeddedDir, true]] : [])];
    const entries = []; for (const [d, subset] of dirs) for (const f of (await readdir(d)).filter((f) => /\.(ttf|otf|ttc)$/i.test(f)).sort()) entries.push({ d, f, subset });
    const stamp = (await Promise.all(entries.map((e) => stat(path.join(e.d, e.f)).then((s) => s.mtimeMs)))).reduce((a, b) => a + b, entries.length);
    if (stamp === this.stamp) return this.index;
    const index = [];
    for (const { d, f: file, subset } of entries) {
      try { const b = await readFile(path.join(d, file)); const p = parseFont(b); if (!p.family) continue; if (subset) tidyNames(p); const dr = subset ? drawableRange(b) : null; index.push({ file, dir: d, subset, size: b.length, ...p, ...(dr ? { unicodeRange: dr.css, letters: dr.count } : {}), style: STYLE_WORDS(p.weight, p.italic) }); }
      catch (e) { index.push({ file, dir: d, subset, error: e.message }); }
    }
    this.index = index; this.stamp = stamp; return index;
  }
  pathOf(entry) { return path.join(entry.dir || this.dir, entry.file); }
  /** Keep a font program found inside an uploaded file (only when no full font of that name is on file). */
  async addEmbedded(postScriptName, buffer) {
    if (!this.embeddedDir) return null; buffer = realignSfnt(buffer); const p = parseFont(buffer); if (!p.family) return null;
    tidyNames(p);
    const list = await this.scan(); const norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
    // A full font of the same name on file does not make the file's own cut redundant: the browser uses the file's glyphs for
    // the letters it has (exact look) and the full font for anything new. Only a subset already stored is skipped.
    const file = (p.postScriptName || postScriptName).replace(/[^\w.-]+/g, '-') + '.ttf';
    await writeFile(path.join(this.embeddedDir, file), buffer); this.stamp = 0;
    return { file, ...p, subset: true, style: STYLE_WORDS(p.weight, p.italic) };
  }
  /** Best file for a request: PostScript name wins, then family + weight/italic. */
  async find({ postScriptName, family, weight = 400, italic = false }) {
    // Full fonts win over partial ones pulled out of a file.
    const list = (await this.scan()).filter((f) => !f.error).sort((a, b) => (a.subset ? 1 : 0) - (b.subset ? 1 : 0));
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (postScriptName) { const hit = list.find((f) => norm(f.postScriptName) === norm(postScriptName) || norm(f.fullName) === norm(postScriptName) || norm(f.file.replace(/\.[^.]+$/, '')) === norm(postScriptName)); if (hit) return hit; }
    if (!family) return null;
    let fam = list.filter((f) => norm(f.family) === norm(family) || norm(f.fullName) === norm(family));
    // Some foundries name each weight as its own family ("Lato Light", "Merriweather Light 18pt"): count those in too.
    const styled = /^(thin|hairline|extralight|ultralight|light|regular|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|\d+pt)+$/;
    fam = [...fam, ...list.filter((f) => !fam.includes(f) && norm(f.family).startsWith(norm(family)) && (!fam.length || styled.test(norm(f.family).slice(norm(family).length))))];
    if (!fam.length) return null;
    return fam.sort((a, b) => (Math.abs(a.weight - weight) + (a.italic !== !!italic ? 1000 : 0)) - (Math.abs(b.weight - weight) + (b.italic !== !!italic ? 1000 : 0)))[0];
  }
  async add(name, buffer) {
    const p = parseFont(buffer); if (!p.family) throw new Error('That file does not look like a TrueType or OpenType font');
    const safe = (p.postScriptName || `${p.family}-${p.subfamily}`).replace(/[^\w.-]+/g, '-') + path.extname(name).toLowerCase().replace(/[^.a-z]/g, '');
    const file = safe.endsWith('.ttf') || safe.endsWith('.otf') || safe.endsWith('.ttc') ? safe : safe + '.ttf';
    await mkdir(this.dir, { recursive: true }); await writeFile(path.join(this.dir, file), buffer); this.stamp = 0;
    return { file, ...p, style: STYLE_WORDS(p.weight, p.italic) };
  }
}

export const library = new FontLibrary(path.join(ROOT, 'data', 'fonts', 'library'), path.join(ROOT, 'data', 'fonts', 'embedded'));
