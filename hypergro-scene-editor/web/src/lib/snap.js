// Snapping for drag: canvas edges/centre, safe-zone margins and other elements' edges/centres. Returns the delta to
// add to the current move and the guide lines to draw.
export function snapDelta(moving, others, W, H, { margin = 0, threshold = 6, lines = [] } = {}) {
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const g of lines) (g.axis === 'x' ? xs : ys).push(g.pos); // guides pulled from the rulers
  if (margin) { xs.push(margin, W - margin); ys.push(margin, H - margin); }
  for (const b of others) { xs.push(b.x, b.x + b.width / 2, b.x + b.width); ys.push(b.y, b.y + b.height / 2, b.y + b.height); }
  const mx = [moving.x, moving.x + moving.width / 2, moving.x + moving.width], my = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  const best = (edges, cands) => { let r = null; for (const e of edges) for (const c of cands) { const d = c - e; if (Math.abs(d) <= threshold && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, pos: c }; } return r; };
  let sx = best(mx, xs), sy = best(my, ys); const guides = [];
  // Even spacing: when the moving item sits between two neighbours, snap so the gap on each side is the same.
  const between = (axis) => { const p = axis === 'x' ? 'x' : 'y', s = axis === 'x' ? 'width' : 'height', q = axis === 'x' ? 'y' : 'x', r = axis === 'x' ? 'height' : 'width';
    const near = others.filter((b) => b[q] < moving[q] + moving[r] && b[q] + b[r] > moving[q] && b[s] < (axis === 'x' ? W : H) * 0.9);
    const before = near.filter((b) => b[p] + b[s] <= moving[p] + threshold).sort((a, b) => (b[p] + b[s]) - (a[p] + a[s]))[0], after = near.filter((b) => b[p] >= moving[p] + moving[s] - threshold).sort((a, b) => a[p] - b[p])[0];
    if (!before || !after) return null; const room = after[p] - (before[p] + before[s]) - moving[s]; if (room < 0) return null; const target = before[p] + before[s] + room / 2; const d = target - moving[p];
    return Math.abs(d) <= threshold ? { d, marks: [before[p] + before[s] + room / 4, after[p] - room / 4] } : null; };
  if (!sx) { const e = between('x'); if (e) { sx = { d: e.d, pos: null }; e.marks.forEach((m) => guides.push({ axis: 'x', pos: m, even: true })); } }
  if (!sy) { const e = between('y'); if (e) { sy = { d: e.d, pos: null }; e.marks.forEach((m) => guides.push({ axis: 'y', pos: m, even: true })); } }
  if (sx?.pos != null) guides.push({ axis: 'x', pos: sx.pos }); if (sy?.pos != null) guides.push({ axis: 'y', pos: sy.pos });
  return { dx: sx ? sx.d : 0, dy: sy ? sy.d : 0, guides };
}
export const unionBounds = (bs) => { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)); return { x: x0, y: y0, width: Math.max(...bs.map((b) => b.x + b.width)) - x0, height: Math.max(...bs.map((b) => b.y + b.height)) - y0 }; };
