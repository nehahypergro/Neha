// Mixed-style text and real lists.
//   text.runs = [{ start, end, bold?, italic?, underline?, strike? }]   character ranges over text.content
//   text.list = 'bullet' | 'number' | null                               every paragraph (line) of the box is an item
// The markers of a list are never part of the content: they are drawn in a gutter, so wrapped lines hang under the
// text and numbers renumber by themselves. The same paragraph/segment model feeds the screen, JPG/PNG, SVG and PDF.
import { isItalic, weightOf } from './render.js';

const FLAGS = ['bold', 'italic', 'underline', 'strike'];
const same = (a, b) => FLAGS.every((f) => !!a[f] === !!b[f]);

/** Sorted, merged, clipped to the content, empty ones dropped. Returns null when nothing is styled. */
export function normRuns(runs, length) {
  const flags = Array.from({ length }, () => ({})); for (const r of runs || []) for (let i = Math.max(0, r.start); i < Math.min(length, r.end); i++) for (const f of FLAGS) if (r[f]) flags[i][f] = true;
  const out = []; let cur = null;
  flags.forEach((fl, i) => { const any = FLAGS.some((f) => fl[f]); if (cur && any && same(cur, fl) && cur.end === i) cur.end = i + 1; else { cur = any ? { start: i, end: i + 1, ...fl } : null; if (cur) out.push(cur); } });
  return out.length ? out : null;
}

/** The style words for a segment: the box's own style plus the segment's bold / italic. */
export function segFontStyle(base, seg) {
  let s = base || 'Regular';
  if (seg?.bold && weightOf(s) < 600) s = /italic|oblique/i.test(s) ? 'Bold Italic' : 'Bold';
  if (seg?.italic && !isItalic(s)) s = s === 'Regular' ? 'Italic' : s + ' Italic';
  return s;
}
export const segText = (t, seg) => (seg && (seg.bold || seg.italic) ? { ...t, fontStyle: segFontStyle(t.fontStyle, seg), postScriptName: null } : t);

/** Paragraphs with their styled segments: [{ text, start, segs: [{ text, bold, italic, underline, strike }] }]. */
export function paragraphs(t) {
  const content = String(t.content ?? ''); const runs = normRuns(t.runs, content.length) || []; const out = []; let at = 0;
  for (const p of content.split('\n')) {
    const segs = []; let i = at; const end = at + p.length;
    while (i < end) { const r = runs.find((x) => x.start <= i && x.end > i); const next = r ? Math.min(end, r.end) : Math.min(end, ...runs.filter((x) => x.start > i).map((x) => x.start), end); segs.push({ text: content.slice(i, next), bold: !!(r?.bold), italic: !!(r?.italic), underline: !!(t.underline || r?.underline), strike: !!(t.strike || r?.strike) }); i = next; }
    out.push({ text: p, start: at, segs }); at = end + 1;
  }
  return out;
}

// ---- lists
export const listIndent = (t) => (t.list === 'number' ? t.fontSize * 1.35 : t.list === 'bullet' ? t.fontSize * 0.9 : 0);
/** Marker text for each paragraph (blank paragraphs get none and do not take a number). */
export function markers(t, paras) { if (!t.list) return paras.map(() => null); let n = 0; return paras.map((p) => (p.text.trim() ? (t.list === 'number' ? `${++n}.` : '•') : null)); }
const TYPED = /^\s*(?:[•\-–*]|\d+[.)])\s+/;
/** Remove bullets / numbers someone typed by hand, shifting the runs so styling stays on the same words. */
export function stripTypedMarkers(content, runs) {
  let out = '', shift = 0; const moved = (runs || []).map((r) => ({ ...r })); let at = 0;
  String(content).split('\n').forEach((line, i) => { const m = TYPED.exec(line); const cut = m ? m[0].length : 0; if (cut) for (const r of moved) { const s = at - shift; if (r.start >= s + cut) r.start -= cut; else if (r.start > s) r.start = s; if (r.end >= s + cut) r.end -= cut; else if (r.end > s) r.end = s; } shift += cut; out += (i ? '\n' : '') + line.slice(cut); at += line.length + 1; });
  return { content: out, runs: normRuns(moved, out.length) };
}

// ---- contentEditable: scene text -> HTML for typing, and back
const escHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function toHtml(t) {
  return paragraphs(t).map((p) => `<div class="para${p.text.trim() ? '' : ' empty'}">${p.segs.map((s) => { let h = escHtml(s.text); if (s.bold) h = `<b>${h}</b>`; if (s.italic) h = `<i>${h}</i>`; if (s.underline && !t.underline) h = `<u>${h}</u>`; if (s.strike && !t.strike) h = `<s>${h}</s>`; return h; }).join('') || '<br>'}</div>`).join('');
}
const BLOCK = /^(DIV|P|LI|H[1-6])$/;
/** Read what the person typed back into { content, runs }. Works with the markup browsers create for bold/italic/etc. */
export function fromDom(root) {
  const paras = []; let cur = null; const open = () => { cur = []; paras.push(cur); };
  const styleOf = (node) => { const f = {}; for (let n = node.parentNode; n && n !== root; n = n.parentNode) { const tag = n.nodeName; const st = n.style || {};
    if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(st.fontWeight || '')) f.bold = true; if (tag === 'I' || tag === 'EM' || st.fontStyle === 'italic') f.italic = true;
    const deco = st.textDecoration || st.textDecorationLine || ''; if (tag === 'U' || /underline/.test(deco)) f.underline = true; if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(deco)) f.strike = true; } return f; };
  const walk = (node) => { for (const n of node.childNodes) {
    if (n.nodeType === 3) { const text = n.nodeValue.replace(/\u200b/g, ''); if (!text) continue; if (!cur) open(); cur.push({ text, f: styleOf(n) }); }
    else if (n.nodeType !== 1) continue;
    else if (n.nodeName === 'BR') { if (n.nextSibling) open(); else if (!cur) open(); } // a trailing <br> is only the browser's placeholder for an empty line
    else if (BLOCK.test(n.nodeName)) { open(); walk(n); cur = null; }
    else walk(n); } };
  walk(root);
  let content = ''; const runs = [];
  paras.forEach((p, i) => { if (i) content += '\n'; for (const seg of p) { if (FLAGS.some((k) => seg.f[k])) runs.push({ start: content.length, end: content.length + seg.text.length, ...seg.f }); content += seg.text; } });
  return { content, runs: normRuns(runs, content.length) };
}
/** Which flags cover the whole range [start, end)? Used to light up the B / I / U / S buttons. */
export function flagsAt(t, start, end) { const len = String(t.content || '').length; if (start == null || end == null || start === end) { start = 0; end = len; } const rs = normRuns(t.runs, len) || []; const out = {}; for (const f of FLAGS) { let covered = start < end; for (let i = start; i < end && covered; i++) if (!rs.some((r) => r[f] && r.start <= i && r.end > i)) covered = false; out[f] = covered; } return out; }
