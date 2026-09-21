import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Sheets.jsx';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Crop a picture: drag the bright window or its corners. Values are fractions of the source image. */
export function CropSheet({ el, url, onApply, onClose }) {
  const [c, setC] = useState(el.meta?.crop || { x: 0, y: 0, w: 1, h: 1 }); const box = useRef(); const drag = useRef(null); const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const move = (ev) => { const d = drag.current; if (!d) return; const r = box.current.getBoundingClientRect(); const dx = (ev.clientX - d.sx) / r.width, dy = (ev.clientY - d.sy) / r.height; let { x, y, w, h } = d.c0; const MIN = 0.05;
      if (d.h === 'move') { x = clamp(x + dx, 0, 1 - w); y = clamp(y + dy, 0, 1 - h); }
      else { if (d.h.includes('w')) { const nx = clamp(x + dx, 0, x + w - MIN); w += x - nx; x = nx; } if (d.h.includes('e')) w = clamp(w + dx, MIN, 1 - x); if (d.h.includes('n')) { const ny = clamp(y + dy, 0, y + h - MIN); h += y - ny; y = ny; } if (d.h.includes('s')) h = clamp(h + dy, MIN, 1 - y); }
      setC({ x, y, w, h }); };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  const down = (ev, h) => { ev.preventDefault(); ev.stopPropagation(); drag.current = { h, sx: ev.clientX, sy: ev.clientY, c0: c }; };
  const pct = (v) => v * 100 + '%';
  return (
    <Modal title={`Crop ${el.name}`} onClose={onClose}>
      <p className="hintsm">Drag the bright area to choose what stays. Drag a corner to change its size. The picture keeps its size on the creative; only the edges are trimmed.</p>
      <div className="cropper" ref={box}>
        <img src={url} alt="" draggable={false} onLoad={(ev) => setSize({ w: ev.currentTarget.clientWidth, h: ev.currentTarget.clientHeight })} />
        <div className="win" style={{ left: pct(c.x), top: pct(c.y), width: pct(c.w), height: pct(c.h) }} onMouseDown={(ev) => down(ev, 'move')}>
          {size.w > 0 && <img src={url} alt="" draggable={false} style={{ width: size.w, height: size.h, left: -c.x * size.w, top: -c.y * size.h }} />}
        </div>
        {[['nw', c.x, c.y], ['ne', c.x + c.w, c.y], ['sw', c.x, c.y + c.h], ['se', c.x + c.w, c.y + c.h]].map(([h, x, y]) => <div key={h} className="ch" style={{ left: pct(x), top: pct(y), cursor: h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }} onMouseDown={(ev) => down(ev, h)} />)}
      </div>
      <div className="modal-foot"><button className="btn" onClick={() => setC({ x: 0, y: 0, w: 1, h: 1 })}>Show the whole picture</button><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn accent" onClick={() => onApply(c)}>Apply crop</button></div>
    </Modal>
  );
}

const PRESETS = [['Instagram post', 1080], ['Story / Reel', 1080], ['Facebook / LinkedIn', 1200], ['Large (2×)', null]];
/** Resize the whole creative in pixels. The shape is kept, so one number drives the other. */
export function ResizeSheet({ W, H, onApply, onClose }) {
  const [w, setW] = useState(Math.round(W)); const ratio = H / W; const h = Math.round(w * ratio); const ok = w >= 50 && w <= 12000 && Math.round(w) !== Math.round(W);
  return (
    <Modal title="Resize the creative" onClose={onClose}>
      <p className="hintsm">Now {Math.round(W)} × {Math.round(H)} px. The creative keeps its shape, so everything on it (text, pictures, spacing) grows or shrinks together. For a different shape, such as post to story, ask your designer for that layout.</p>
      <div className="row-btns" style={{ alignItems: 'center' }}>
        <label className="hintsm">Width <input className="dim-input" type="number" min="50" max="12000" value={w} onChange={(e) => setW(+e.target.value || 0)} /></label>
        <span>×</span>
        <label className="hintsm">Height <input className="dim-input" type="number" min="50" value={h} onChange={(e) => setW(Math.round((+e.target.value || 0) / ratio))} /></label>
        <span className="hintsm">px</span>
      </div>
      <div className="row-btns">{[0.5, 2, 3].map((k) => <button key={k} className="btn small" onClick={() => setW(Math.round(W * k))}>{k < 1 ? 'Half size' : `${k}× bigger`}</button>)}<button className="btn small" onClick={() => setW(1080)}>1080 wide</button><button className="btn small" onClick={() => setW(1920)}>1920 wide</button></div>
      {w > W * 1.01 && <p className="hintsm">Making it bigger does not add detail to photos. Text and shapes stay sharp.</p>}
      <div className="modal-foot"><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn accent" disabled={!ok} onClick={() => onApply(w)}>Resize to {w} × {h}</button></div>
    </Modal>
  );
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); const M = mac ? '⌘' : 'Ctrl';
const KEYS = [
  ['Basics', [['Undo', `${M} Z`], ['Redo', `${M} ⇧ Z`], ['Save now', `${M} S`], ['Copy', `${M} C`], ['Cut', `${M} X`], ['Paste', `${M} V`], ['Duplicate', `${M} D`], ['Delete', '⌫'], ['Select everything', `${M} A`], ['Deselect / close', 'Esc']]],
  ['Arrange', [['Nudge 1 px', '← ↑ → ↓'], ['Nudge 10 px', '⇧ + arrows'], ['Group', `${M} G`], ['Ungroup', `${M} ⇧ G`], ['Bring forward', `${M} ]`], ['Send backward', `${M} [`], ['Bring to front', `${M} ⇧ ]`], ['Send to back', `${M} ⇧ [`], ['Lock / unlock', `${M} ⇧ L`], ['Add to selection', '⇧ + click'], ['Move without snapping', `hold ${M}`]]],
  ['Text', [['Add a text box', 'T'], ['Edit the selected text', 'Enter'], ['Bold', `${M} B`], ['Italic', `${M} I`], ['Underline', `${M} U`], ['Uppercase', `${M} ⇧ K`], ['Align left / centre / right', `${M} ⇧ L / C / R`], ['Bigger / smaller text', `${M} ⇧ . / ,`]]],
  ['View', [['Zoom in / out', `${M} + / −`], ['Fit to screen', `${M} 0`], ['Rulers and guides', '⇧ R'], ['Preview', `${M} ⌥ P`], ['This list', '?']]],
];
export function ShortcutsSheet({ onClose }) {
  return (<Modal title="Keyboard shortcuts" onClose={onClose}><dl className="keys">{KEYS.map(([group, rows]) => <React.Fragment key={group}><h4>{group}</h4>{rows.map(([a, b]) => <React.Fragment key={a}><dt>{a}</dt><dd>{b}</dd></React.Fragment>)}</React.Fragment>)}</dl></Modal>);
}
