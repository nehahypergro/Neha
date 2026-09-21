import React, { useState } from 'react';
import ReadyCard, { friendlyIssues } from './ReadyCard.jsx';

export default function BottomBar({ scene, issues, W, H, zoom, zoomMode, showOriginal, hasReference, ctl }) {
  const [open, setOpen] = useState(false);
  const rows = friendlyIssues(issues);
  return (
    <footer className="bottom">
      <span className="menu-wrap">
        <button className={'ready-pill' + (rows.length ? ' warn' : ' ok')} onClick={() => setOpen(!open)} aria-expanded={open}>{rows.length ? `⚠ ${rows.length} thing${rows.length > 1 ? 's' : ''} to look at` : '✓ Ready to publish'}</button>
        {open && <><div className="menu-backdrop" onMouseDown={() => setOpen(false)} /><div className="menu up left plain"><ReadyCard issues={issues} scene={scene} ctl={ctl} /></div></>}
      </span>
      {hasReference && <label className="check"><input type="checkbox" checked={showOriginal} onChange={ctl.toggleOriginal} /> Show original</label>}
      <button className="btn ghost small" onClick={ctl.resetAll} title="Put everything back as it was in the uploaded file">↺ Start over</button>
      <span className="spacer" />
      <span className="hintsm">{Math.round(W)} × {Math.round(H)} px</span>
      <span className="zoom">
        <button className="tb" onClick={() => ctl.setZoom(zoom / 1.25)} aria-label="Zoom out">−</button>
        <input type="range" min="10" max="200" value={Math.round(zoom * 100)} aria-label="Zoom" onChange={(e) => ctl.setZoom(+e.target.value / 100)} />
        <button className="tb" onClick={() => ctl.setZoom(zoom * 1.25)} aria-label="Zoom in">+</button>
        <span className="pct">{Math.round(zoom * 100)}%</span>
        <button className={'btn ghost small' + (zoomMode === 'fit' ? ' on' : '')} onClick={ctl.fit}>Fit</button>
      </span>
    </footer>
  );
}
