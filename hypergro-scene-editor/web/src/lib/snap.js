// Snapping for drag: canvas edges/centre, safe-zone margins and other elements' edges/centres. Returns the delta to
// add to the current move and the guide lines to draw.
export function snapDelta(moving, others, W, H, { margin = 0, threshold = 6 } = {}) {
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  if (margin) { xs.push(margin, W - margin); ys.push(margin, H - margin); }
  for (const b of others) { xs.push(b.x, b.x + b.width / 2, b.x + b.width); ys.push(b.y, b.y + b.height / 2, b.y + b.height); }
  const mx = [moving.x, moving.x + moving.width / 2, moving.x + moving.width], my = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  const best = (edges, cands) => { let r = null; for (const e of edges) for (const c of cands) { const d = c - e; if (Math.abs(d) <= threshold && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, pos: c }; } return r; };
  const sx = best(mx, xs), sy = best(my, ys);
  return { dx: sx ? sx.d : 0, dy: sy ? sy.d : 0, guides: [...(sx ? [{ axis: 'x', pos: sx.pos }] : []), ...(sy ? [{ axis: 'y', pos: sy.pos }] : [])] };
}
export const unionBounds = (bs) => { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)); return { x: x0, y: y0, width: Math.max(...bs.map((b) => b.x + b.width)) - x0, height: Math.max(...bs.map((b) => b.y + b.height)) - y0 }; };
