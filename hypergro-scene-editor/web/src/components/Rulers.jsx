import React, { useEffect, useRef } from 'react';

const SIZE = 20;
const niceStep = (pxPerUnit) => { const target = 70 / pxPerUnit; const pow = 10 ** Math.floor(Math.log10(target)); return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= target) || 10 * pow; };

/** Rulers along the top and left of the stage, in the creative's own pixels. Drag out of a ruler to pull a guide. */
export default function Rulers({ stageRef, artRef, zoom, W, H, onPull }) {
  const top = useRef(), left = useRef();
  useEffect(() => {
    const stage = stageRef.current; if (!stage) return; let raf = 0;
    const draw = () => {
      raf = 0; const art = artRef.current; if (!art) return; const sr = stage.getBoundingClientRect(), ar = art.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      const ink = getComputedStyle(stage).getPropertyValue('--muted') || '#6b7280';
      for (const [cv, horiz] of [[top.current, true], [left.current, false]]) {
        if (!cv) continue; const len = horiz ? sr.width : sr.height; cv.width = Math.round((horiz ? len : SIZE) * dpr); cv.height = Math.round((horiz ? SIZE : len) * dpr);
        cv.style.width = (horiz ? len : SIZE) + 'px'; cv.style.height = (horiz ? SIZE : len) + 'px';
        const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, len, len); g.fillStyle = ink; g.strokeStyle = ink; g.font = '9px system-ui, sans-serif'; g.lineWidth = 1;
        const origin = horiz ? ar.left - sr.left : ar.top - sr.top; const step = niceStep(zoom), minor = step / 5; const max = horiz ? W : H;
        for (let u = Math.ceil(-origin / zoom / minor) * minor; u * zoom + origin < len; u += minor) {
          const p = Math.round(origin + u * zoom) + 0.5; const major = Math.abs(u / step - Math.round(u / step)) < 1e-6; const inside = u >= 0 && u <= max; g.globalAlpha = inside ? 0.9 : 0.35;
          g.beginPath(); if (horiz) { g.moveTo(p, SIZE); g.lineTo(p, major ? 6 : 14); } else { g.moveTo(SIZE, p); g.lineTo(major ? 6 : 14, p); } g.stroke();
          if (major) { if (horiz) g.fillText(String(Math.round(u)), p + 3, 9); else { g.save(); g.translate(9, p + 3); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.fillText(String(Math.round(u)), 0, 0); g.restore(); } }
        }
      }
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };
    ask(); stage.addEventListener('scroll', ask, { passive: true }); window.addEventListener('resize', ask); const ro = new ResizeObserver(ask); ro.observe(stage);
    return () => { stage.removeEventListener('scroll', ask); window.removeEventListener('resize', ask); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [stageRef, artRef, zoom, W, H]);
  return (
    <>
      <canvas ref={top} className="ruler ruler-x" title="Drag down to add a guide" onMouseDown={(ev) => onPull(ev, 'y')} />
      <canvas ref={left} className="ruler ruler-y" title="Drag right to add a guide" onMouseDown={(ev) => onPull(ev, 'x')} />
      <div className="ruler-corner" aria-hidden="true" />
    </>
  );
}
