#!/usr/bin/env node
// Builds a synthetic, PDF-compatible ".ai" creative for smoke-testing the ingest pipeline without Illustrator.
// Every Illustrator file saved with "Create PDF Compatible File" (the default) is a PDF stream, which is what
// pdf-extract.mjs reads — so this file exercises the exact same code path as a real client .ai.
// Usage: node scripts/make-sample-ai.mjs [out.ai]
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';

const OUT = process.argv[2] || 'samples/cashback-kv.ai';
const W = 1080, H = 1080;
const col = (h) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

// ---- tiny PNG encoder (RGB, no deps) so the file carries an embedded raster "product shot"
function crc32(buf) { let crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { let c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, px) {
  const stride = w * 3 + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); const o = y * stride + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// a debit-card illustration: rounded gradient card with a chip and stripes
const card = png(420, 270, (x, y) => {
  const inside = (x > 6 && x < 414 && y > 6 && y < 264) && !((x < 26 || x > 394) && (y < 26 || y > 244) && Math.hypot(Math.min(Math.abs(x - 26), Math.abs(x - 394)), Math.min(Math.abs(y - 26), Math.abs(y - 244))) > 20);
  if (!inside) return [0, 76, 190];
  if (x > 40 && x < 100 && y > 60 && y < 105) return [255, 156, 0];
  if (y > 190 && y < 202 && x > 40 && x < 260) return [230, 236, 245];
  if (y > 214 && y < 224 && x > 40 && x < 180) return [200, 210, 228];
  const t = (x + y) / 690; return [Math.round(0 + 56 * t), Math.round(38 + 79 * t), Math.round(95 + 110 * t)];
});

const doc = await PDFDocument.create();
doc.setTitle('cashback-kv');
const page = doc.addPage([W, H]);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const reg = await doc.embedFont(StandardFonts.Helvetica);
const Y = (top, h = 0) => H - top - h; // scene (y-down) → PDF (y-up)

// background + decoration
page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: col('#004CBE') });
page.drawCircle({ x: 940, y: Y(180), size: 300, color: col('#3875CD') });

// logo: mark + wordmark
page.drawCircle({ x: 104, y: Y(104), size: 26, color: col('#FF9C00') });
page.drawText('FEDERAL BANK', { x: 146, y: Y(104) - 8, size: 24, font: bold, color: col('#FFFFFF') });

// copy
page.drawText('Get 5% cashback', { x: 80, y: Y(330), size: 84, font: bold, color: col('#FFFFFF') });
page.drawText('on every UPI payment', { x: 80, y: Y(420), size: 40, font: reg, color: col('#E1EEF9') });
page.drawText('this festive season', { x: 80, y: Y(470), size: 40, font: reg, color: col('#E1EEF9') });
page.drawText('Up to Rs.500 every month', { x: 80, y: Y(560), size: 36, font: bold, color: col('#FF9C00') });

// CTA: pill (path) + live label
const bx = 80, by = 660, bw = 280, bh = 72, r = 36;
// drawSvgPath takes y-down coordinates with the origin at the page's top-left (pdf-lib flips them itself)
const pill = `M ${bx + r} ${by} L ${bx + bw - r} ${by} A ${r} ${r} 0 0 1 ${bx + bw} ${by + r} L ${bx + bw} ${by + bh - r} A ${r} ${r} 0 0 1 ${bx + bw - r} ${by + bh} L ${bx + r} ${by + bh} A ${r} ${r} 0 0 1 ${bx} ${by + bh - r} L ${bx} ${by + r} A ${r} ${r} 0 0 1 ${bx + r} ${by} Z`;
page.drawSvgPath(pill, { x: 0, y: H, color: col('#FF9C00') });
const label = 'Apply now', ls = 28, lw = bold.widthOfTextAtSize(label, ls);
page.drawText(label, { x: bx + (bw - lw) / 2, y: Y(by + bh / 2) - ls * 0.36, size: ls, font: bold, color: col('#00265F') });

// product shot (embedded raster)
const img = await doc.embedPng(card);
page.drawImage(img, { x: 600, y: Y(560, 270), width: 420, height: 270 });

// disclaimer
page.drawText('T&C apply. Cashback is credited within 7 working days of the transaction.', { x: 80, y: Y(1020), size: 15, font: reg, color: col('#A9C6EA') });

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, await doc.save());
console.log(`wrote ${OUT} (${W}×${H}, 7 text lines, 1 image, 1 CTA pill)`);
