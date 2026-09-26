// Contact sheet of PNGs (dev):  node scripts/sheet.mjs out.png a.png b.png …   — each image scaled to 420px tall, side by side
import * as mupdf from 'mupdf'; import { readFileSync, writeFileSync } from 'node:fs';
const [,, out, ...files] = process.argv; const H = 420; const pix = files.map((f) => new mupdf.Image(readFileSync(f)).toPixmap());
const ws = pix.map((p) => Math.round(p.getWidth() * H / p.getHeight())); const W = ws.reduce((a, b) => a + b + 12, 0);
const o = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, W, H], false); const d = o.getPixels(); d.fill(180); let off = 0;
pix.forEach((p, i) => { const pw = p.getWidth(), ph = p.getHeight(), n = p.getNumberOfComponents(), q = p.getPixels(); const w = ws[i]; for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const sx = Math.min(pw - 1, Math.floor(x * pw / w)), sy = Math.min(ph - 1, Math.floor(y * ph / H)); const j = (sy * pw + sx) * n, k = (y * W + off + x) * 3; const a = n === 4 ? q[j + 3] / 255 : 1; for (let c = 0; c < 3; c++) d[k + c] = Math.round(q[j + c] * a + 255 * (1 - a)); } off += w + 12; });
writeFileSync(out, o.asPNG()); console.log('sheet', out, W + 'x' + H);
