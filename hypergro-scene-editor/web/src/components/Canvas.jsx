import React from 'react';
import { cropCss } from '../lib/edit.js';
import { paragraphs, toHtml, fromDom, listIndent } from '../lib/rich.js';
import { onPage, weightOf, isItalic, fontFamilyCss, lineHeightOf, assetUrl, isCssShape, coverPad } from '../lib/render.js';

const HANDLES = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]];
const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
const STEP_TEXT = { upload: 'Uploading…', queued: 'Queued…', extract: 'Reading the file…', classify: 'Understanding the layout…', understand: 'Applying brand rules…', done: 'Opening…' };

function elStyle(e, url) {
  const b = e.bounds, t = e.text || {}, isT = e.type === 'text';
  const st = { left: b.x, top: b.y, width: b.width, height: b.height, zIndex: e.zIndex + 1, opacity: e.opacity ?? 1, display: e.visible ? undefined : 'none',
    transform: e.transform?.rotation ? `rotate(${-e.transform.rotation}deg)` : undefined, cursor: e.locked ? 'default' : 'move', pointerEvents: e.meta?.collapsedGroup ? 'none' : undefined };
  if (isT) Object.assign(st, { '--li': listIndent(t) + 'px', color: e.fill || '#000', fontSize: t.fontSize, fontWeight: weightOf(t.fontStyle), fontStyle: isItalic(t.fontStyle) ? 'italic' : 'normal', fontFamily: fontFamilyCss(t.fontFamily),
    lineHeight: lineHeightOf(t) + 'px', letterSpacing: (t.letterSpacing || 0) + 'px', textAlign: t.align || 'left', textAlignLast: t.align === 'justify' ? 'left' : undefined, textDecoration: [t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ') || undefined, whiteSpace: t.kind === 'point' ? 'pre' : 'pre-wrap', backgroundColor: e.meta?.coverFill || 'transparent', boxShadow: e.meta?.coverFill ? `0 0 0 ${coverPad(t)}px ${e.meta.coverFill}` : undefined });
  else if (url) Object.assign(st, cropCss(e.meta?.crop) || {}, { backgroundImage: `url("${url}")`, transform: [st.transform, e.transform?.scaleY === -1 ? 'scaleY(-1)' : ''].filter(Boolean).join(' ') || undefined });
  else Object.assign(st, { backgroundColor: e.fill || '#e6e4de', borderRadius: e.meta?.kind === 'ellipse' ? '50%' : (e.meta?.cornerRadius || 0) + 'px' });
  return st;
}
let pendingCaret = null;
const caretFromPoint = (x, y) => { if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y); const p = document.caretPositionFromPoint?.(x, y); if (!p) return null; const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r; };
const startEditing = (node, text) => {
  if (!node || node.dataset.init) return; node.dataset.init = '1'; node.innerHTML = toHtml(text); node.focus(); try { document.execCommand('styleWithCSS', false, false); document.execCommand('defaultParagraphSeparator', false, 'div'); } catch { /* older browsers */ }
  let range = null;
  if (pendingCaret) { try { range = caretFromPoint(pendingCaret.x, pendingCaret.y); } catch {} if (range && !node.contains(range.startContainer)) range = null; pendingCaret = null; }
  if (!range) { range = document.createRange(); range.selectNodeContents(node); range.collapse(false); }
  const sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(range);
};

export default function Canvas({ scene, W, H, zoom, assets, sel, hover, editing, guides, userGuides = [], marquee = null, preview = false, dragging, showOriginal, referenceUrl, job, stageRef, artRef, ctl }) {
  const leaves = scene ? scene.elements.filter((e) => e.type !== 'group' && onPage(scene, e)).sort((a, b) => a.zIndex - b.zIndex) : [];
  const primary = scene?.elements.find((e) => e.id === sel[0]);
  const showHandles = primary && !primary.locked && sel.length === 1 && !editing && !preview;
  const b = primary?.bounds;
  // Handles sit in a wrapper that rotates with the item, so they stay on its corners.
  const hStyle = showHandles ? { left: b.x, top: b.y, width: b.width, height: b.height, transform: primary.transform?.rotation ? `rotate(${-primary.transform.rotation}deg)` : undefined } : null;
  return (
    <div ref={stageRef} className="stage" onMouseDown={ctl.stageDown}>
      <div className="stage-inner" style={{ width: Math.round(W * zoom), height: Math.round(H * zoom) }}>
        <div ref={artRef} className="art" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
          {!scene && !job && <div className="empty">Nothing here yet.</div>}
          {leaves.map((e) => {
            const isT = e.type === 'text', url = !isT && !isCssShape(e) ? assetUrl(e, assets) : null, missing = !isT && !isCssShape(e) && !url;
            const isEditing = isT && editing === e.id, selected = sel.includes(e.id);
            const style = elStyle(e, url); if (isEditing) Object.assign(style, { userSelect: 'text', cursor: 'text' }); if (showOriginal) style.visibility = 'hidden';
            return (
              <div key={e.id + (isEditing ? ':edit' : '')} className={'el ' + (isT ? 'text' + (e.text.list ? ' list list-' + e.text.list : '') : 'gfx') + (selected ? ' sel' : hover === e.id ? ' hov' : '') + (e.locked ? ' locked' : '') + (isEditing ? ' editing' : '')} style={style}
                title={isEditing ? undefined : e.locked ? `${e.name} · fixed by brand` : e.name} tabIndex={isEditing ? -1 : 0} role="button" aria-label={e.name}
                onMouseDown={(ev) => ctl.elDown(ev, e.id)} onMouseEnter={() => ctl.hover(e.id)} onMouseLeave={() => ctl.hover(null)}
                onFocus={() => { if (!isEditing && !selected) ctl.select(e.id); }}
                onDoubleClick={isT && !isEditing && e.text.encoding !== 'legacy' ? (ev) => { pendingCaret = { x: ev.clientX, y: ev.clientY }; ctl.editText(e.id); } : undefined}
                contentEditable={isEditing || undefined} suppressContentEditableWarning={isEditing || undefined} spellCheck={isEditing ? false : undefined}
                ref={isEditing ? (node) => startEditing(node, e.text) : undefined}
                onInput={isEditing ? (ev) => ctl.editInput(e.id, fromDom(ev.currentTarget)) : undefined}
                onPaste={isEditing ? (ev) => { ev.preventDefault(); const txt = (ev.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, txt); } : undefined}
                onBlur={isEditing ? ctl.editEnd : undefined}
                onKeyDown={isEditing ? (ev) => { ev.stopPropagation(); const meta = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase(); if (ev.key === 'Escape' || (meta && ev.key === 'Enter')) { ev.preventDefault(); ev.currentTarget.blur(); } else if (meta && !ev.shiftKey && (k === 'b' || k === 'i' || k === 'u')) { ev.preventDefault(); ctl.format({ b: 'bold', i: 'italic', u: 'underline' }[k]); } else if (meta && k === 's') { ev.preventDefault(); ctl.saveNow(); } } : undefined}>
                {isEditing ? null : isT ? paragraphs(e.text).map((p, pi) => <div key={pi} className={'para' + (p.text.trim() ? '' : ' empty')}>{p.segs.length ? p.segs.map((sg, si) => (sg.bold || sg.italic || sg.underline || sg.strike ? <span key={si} style={{ fontWeight: sg.bold ? 700 : undefined, fontStyle: sg.italic ? 'italic' : undefined, textDecoration: [sg.underline && 'underline', sg.strike && 'line-through'].filter(Boolean).join(' ') || undefined }}>{sg.text}</span> : sg.text)) : <br />}</div>) : missing ? `${e.name} (image missing)` : ''}
              </div>
            );
          })}
          {referenceUrl && showOriginal && <img className="overlay-img" src={referenceUrl} alt="Original" draggable={false} />}
          {!preview && userGuides.map((g, i) => <div key={'u' + i} className={'guide user ' + g.axis} style={g.axis === 'x' ? { left: g.pos, width: Math.max(1, 1 / zoom) } : { top: g.pos, height: Math.max(1, 1 / zoom) }} title="Drag to move · drag off the creative to remove" onMouseDown={(ev) => ctl.guideDown(ev, i)}><i style={g.axis === 'x' ? { left: -4 / zoom, right: -4 / zoom } : { top: -4 / zoom, bottom: -4 / zoom }} /></div>)}
          {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height, borderWidth: Math.max(1, 1 / zoom) }} aria-hidden="true" />}
          {guides.map((g, i) => <div key={i} className={'guide ' + g.axis + (g.even ? ' even' : '')} style={g.axis === 'x' ? { left: g.pos } : { top: g.pos }} aria-hidden="true" />)}
          {!preview && sel.length > 1 && !dragging && (() => { const bs = sel.map((id) => scene?.elements.find((x) => x.id === id)?.bounds).filter(Boolean); if (bs.length < 2) return null; const x0 = Math.min(...bs.map((q) => q.x)), y0 = Math.min(...bs.map((q) => q.y)), x1 = Math.max(...bs.map((q) => q.x + q.width)), y1 = Math.max(...bs.map((q) => q.y + q.height)); return <div className="multi-box" style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0, borderWidth: Math.max(1, 1 / zoom) }} aria-hidden="true" />; })()}
          {showHandles && !dragging && (
            <div className="handles" style={hStyle} aria-hidden="true">
              {HANDLES.map(([h, fx, fy]) => <div key={h} className="handle" style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: CURSOR[h], transform: `translate(-50%, -50%) scale(${1 / zoom})` }} onMouseDown={(ev) => ctl.handleDown(ev, primary.id, h)} />)}
              <div className="handle rot" style={{ left: '50%', top: `calc(100% + ${28 / zoom}px)`, transform: `translate(-50%, -50%) scale(${1 / zoom})` }} title="Drag to rotate" onMouseDown={(ev) => ctl.rotateDown(ev, primary.id)}>⟳</div>
            </div>
          )}
          {job && (
            <div className="skeleton" aria-live="polite">
              <div className="sk-blocks"><i style={{ width: '18%', height: '6%', top: '8%', left: '8%' }} /><i style={{ width: '60%', height: '14%', top: '30%', left: '8%' }} /><i style={{ width: '45%', height: '6%', top: '48%', left: '8%' }} /><i style={{ width: '22%', height: '8%', top: '64%', left: '8%' }} /><i style={{ width: '32%', height: '34%', top: '48%', left: '60%' }} /></div>
              <div className="sk-text">{STEP_TEXT[job.step] || job.step}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
