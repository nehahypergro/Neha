import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as mupdf from 'mupdf';
import { applyCutouts } from '../server/classify.mjs';

// A 200×100 artboard at referenceScale 2: layer 0 is an opaque photo-like fill, layer 1 holds a red "logo" square on
// transparent. The cutout must come out of layer 1 only, leaving a transparent hole, and become an image element.
test('a logo baked into an upper artwork layer is lifted out as its own image', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cutout-')); await mkdir(path.join(dir, 'assets'));
  const mk = (paint) => { const p = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 400, 200], true); p.clear(); const px = p.getPixels(); paint(px); return p.asPNG(); };
  await writeFile(path.join(dir, 'artwork-0.png'), mk((px) => { for (let i = 0; i < px.length; i += 4) { px[i] = 30; px[i + 1] = 60; px[i + 2] = 120; px[i + 3] = 255; } }));
  await writeFile(path.join(dir, 'artwork-0-1.png'), mk((px) => { for (let y = 20; y < 60; y++) for (let x = 20; x < 100; x++) { const i = (y * 400 + x) * 4; px[i] = 255; px[i + 3] = 255; } }));
  const scene = { document: { width: 200, height: 100, artboards: [{ artwork: 'artwork-0.png' }] }, ingest: { referenceScale: 2, previewScale: 1 }, warnings: [],
    elements: [{ id: 'el_art_0', type: 'vector', zIndex: 0, asset: 'artwork-0.png', meta: { collapsedGroup: true } }, { id: 'el_art_0_1', type: 'vector', zIndex: 1, asset: 'artwork-0-1.png', meta: { collapsedGroup: true } }] };
  const out = { cutouts: [{ name: 'Kotak logo', x: 8, y: 8, width: 44, height: 24, role: 'logo', backgroundFill: null }] };
  const res = await applyCutouts(scene, out, dir);
  const cut = res.elements.find((e) => e.meta?.cutout);
  assert.ok(cut, 'cutout element created'); assert.equal(cut.role, 'logo'); assert.equal(cut.type, 'image'); assert.ok(Math.abs(cut.bounds.x - 6) < 0.01 && Math.abs(cut.bounds.width - 48) < 0.01, 'box grown by 2 px each side');
  const cutPix = new mupdf.Image(await readFile(path.join(dir, cut.asset))).toPixmap(); const cp = cutPix.getPixels();
  assert.equal(cutPix.getWidth(), 96); assert.equal(cp[((16 * 96) + 16) * 4], 255, 'red logo pixel in the cutout'); assert.equal(cp[((16 * 96) + 16) * 4 + 3], 255);
  const layer1 = new mupdf.Image(await readFile(path.join(dir, 'artwork-0-1.png'))).toPixmap().getPixels();
  assert.equal(layer1[((30 * 400) + 40) * 4 + 3], 0, 'hole left in the upper layer');
  const layer0 = new mupdf.Image(await readFile(path.join(dir, 'artwork-0.png'))).toPixmap().getPixels();
  assert.equal(layer0[((30 * 400) + 40) * 4 + 3], 255, 'opaque bottom layer untouched without a flat fill');
  assert.ok(res.warnings.some((w) => /lifted out/.test(w)));
});
