import React from 'react';

export default function BottomBar({ scene, issues, W, H, zoom, zoomMode, showOriginal, hasReference, rulers, guideCount = 0, page = 0, pages = 1, ctl }) {
  return (
    <footer className="bottom">
      {hasReference && <label className="check"><input type="checkbox" checked={showOriginal} onChange={ctl.toggleOriginal} /> Show original</label>}
      <button className="btn ghost small" onClick={ctl.resetAll} title="Put everything back as it was in the uploaded file">↺ Start over</button>
      <label className="check" title="Rulers in pixels. Drag out of a ruler to pull a guide; things snap to guides. (⇧R)"><input type="checkbox" checked={!!rulers} onChange={ctl.toggleRulers} /> Rulers</label>
      {guideCount > 0 && <button className="linkbtn" onClick={ctl.clearGuides}>Clear {guideCount} guide{guideCount > 1 ? 's' : ''}</button>}
      <span className="spacer" />
      {pages > 1 && <span className="pager" aria-label="Page"><button className="tb" aria-label="Previous page" disabled={page <= 0} onClick={() => ctl.setPage(page - 1)}>‹</button><span>Page {page + 1} of {pages}</span><button className="tb" aria-label="Next page" disabled={page >= pages - 1} onClick={() => ctl.setPage(page + 1)}>›</button></span>}
      <button className="btn ghost small" onClick={ctl.togglePreview} title="See it without the editing tools (⌘⌥P)">⤢ Preview</button>
      <button className="linkbtn" onClick={ctl.openResize} title="Change the pixel size of the creative">{Math.round(W)} × {Math.round(H)} px</button>
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
