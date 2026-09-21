import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as S from '../shared/scene.js';
import { applyClassification, SCHEMA } from '../server/classify.mjs';
import { extract } from '../server/pdf-extract.mjs';

const ROOT = new URL('..', import.meta.url);
const demo = JSON.parse(await readFile(new URL('web/public/samples/demo/scene.json', ROOT)));
const load = () => S.understand(S.normalize(demo));

test('normalize + understand keep explicit roles', () => {
  const sc = load(); const h = sc.elements.find((e) => e.id === 'el_head');
  assert.equal(h.role, 'headline'); assert.equal(sc.elements.find((e) => e.id === 'el_bg').role, 'background');
  assert.ok(S.TOOLS.every((t) => !['adapt_to_size', 'set_layout'].includes(t.name)), 'adaptation tools removed');
});

test('set_fill on "cta" recolours the button, not the label', () => {
  const { scene } = S.runTool(load(), 'set_fill', { target: 'cta', color: '#0B4EA2' });
  assert.equal(scene.elements.find((e) => e.id === 'el_cta').fill, '#0B4EA2');
  assert.equal(scene.elements.find((e) => e.id === 'el_cta_t').fill, '#00265F');
});

test('move_element moves the whole semantic group', () => {
  const sc = load(); const before = sc.elements.find((e) => e.id === 'el_cta_t').bounds;
  const { scene } = S.runTool(sc, 'move_element', { target: 'el_cta', dx: 100, dy: -20 });
  const t = scene.elements.find((e) => e.id === 'el_cta_t').bounds;
  assert.equal(t.x, before.x + 100); assert.equal(t.y, before.y - 20);
});

test('applyOps deep-merges text/bounds/meta and records no extra keys', () => {
  const sc = load(); const out = S.applyOps(sc, [{ id: 'el_head', set: { text: { content: 'Hi' }, bounds: { x: 10 }, meta: { note: 1 } } }]);
  const h = out.elements.find((e) => e.id === 'el_head');
  assert.equal(h.text.content, 'Hi'); assert.equal(h.text.fontSize, 54); assert.equal(h.bounds.x, 10); assert.equal(h.bounds.width, 680); assert.equal(h.meta.note, 1);
});

test('applyClassification merges lines, adds a CTA button and groups it with the label', () => {
  const raw = { document: { name: 't', width: 1000, height: 1000, activeArtboard: 0, artboards: [{ id: 0, width: 1000, height: 1000 }] }, fonts: [], warnings: ['x'], elements: [
    { id: 'el_art_0', type: 'vector', name: 'Artwork', zIndex: 0, bounds: { x: 0, y: 0, width: 1000, height: 1000 }, asset: 'artwork-0.png', role: 'background', locked: true, editable: false },
    { id: 'el_txt_001', type: 'text', name: 'a', zIndex: 1, bounds: { x: 50, y: 100, width: 500, height: 60 }, fill: '#FFFFFF', text: { content: 'Get 5%', fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 50, align: 'left', kind: 'point' } },
    { id: 'el_txt_002', type: 'text', name: 'b', zIndex: 2, bounds: { x: 50, y: 165, width: 400, height: 60 }, fill: '#FFFFFF', text: { content: 'cashback', fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 50, align: 'left', kind: 'point' } },
    { id: 'el_txt_003', type: 'text', name: 'c', zIndex: 3, bounds: { x: 90, y: 700, width: 120, height: 30 }, fill: '#FFFFFF', text: { content: 'Apply now', fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 24, align: 'left', kind: 'point' } },
  ] };
  const out = applyClassification(raw, { merges: [{ ids: ['el_txt_001', 'el_txt_002'], content: 'Get 5%\ncashback', lineHeight: 65 }],
    elements: [{ id: 'el_txt_001', role: 'headline', name: 'Headline', align: 'left' }, { id: 'el_txt_003', role: 'cta', name: 'CTA label', align: 'center' }],
    ctaButtons: [{ labelId: 'el_txt_003', fill: '#e8541e', x: 60, y: 685, width: 180, height: 60, cornerRadius: 30 }], overlays: [], warnings: ['fonts approximate'] });
  const ids = out.elements.map((e) => e.id);
  assert.ok(!ids.includes('el_txt_002'), 'merged line removed');
  const h = out.elements.find((e) => e.id === 'el_txt_001');
  assert.equal(h.text.content, 'Get 5%\ncashback'); assert.equal(h.text.kind, 'point', 'merged lines keep explicit breaks, no auto-wrap'); assert.equal(h.text.lineHeight, 65); assert.equal(h.bounds.height, 125); assert.equal(h.role, 'headline');
  const btn = out.elements.find((e) => e.name === 'CTA button'), lbl = out.elements.find((e) => e.id === 'el_txt_003');
  assert.ok(btn && btn.fill === '#E8541E' && btn.meta.cornerRadius === 30);
  assert.equal(btn.semanticGroup, lbl.semanticGroup); assert.ok(btn.zIndex < lbl.zIndex, 'button drawn under its label');
  assert.deepEqual(out.warnings, ['x', 'classify: fonts approximate']);
  const done = S.understand(S.normalize(out));
  assert.equal(done.elements.find((e) => e.id === 'el_txt_001').role, 'headline');
});

test('classification schema is strict everywhere (required + no additional properties)', () => {
  const walk = (s) => { if (s.type === 'object') { assert.equal(s.additionalProperties, false); assert.deepEqual(s.required, Object.keys(s.properties)); Object.values(s.properties).forEach(walk); } if (s.items) walk(s.items); };
  walk(SCHEMA);
});

test('extract + understand on the synthetic .ai finds text, image, CTA group and logo group', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'hg-'));
  try {
    const { scene, stats } = await extract(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'samples', 'cashback-kv.ai'), out);
    assert.equal(stats.textRuns, 7); assert.equal(stats.imagesPromoted, 1); assert.ok(stats.shapesPromoted >= 2);
    const sc = S.understand(S.normalize(scene));
    const roles = Object.fromEntries(sc.elements.map((e) => [e.id, e.role]));
    const byRole = (r) => sc.elements.filter((e) => e.role === r);
    assert.equal(byRole('headline').length, 1); assert.equal(byRole('headline')[0].text.content, 'Get 5% cashback');
    assert.equal(byRole('cta').length, 2, 'button + label'); assert.equal(new Set(byRole('cta').map((e) => e.semanticGroup)).size, 1);
    assert.equal(byRole('logo').length, 2); assert.equal(byRole('product').length, 1); assert.equal(byRole('disclaimer').length, 1);
    assert.equal(byRole('offer')[0]?.text.content, 'Up to Rs.500 every month', JSON.stringify(roles));
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('guardrails: logo, disclaimer and background are locked by default and tools refuse to edit them', () => {
  const sc = load();
  assert.deepEqual(sc.elements.filter((e) => e.locked).map((e) => e.id).sort(), ['el_bg', 'el_disc', 'el_logo']);
  const r = S.runTool(sc, 'set_visibility', { target: 'disclaimer', visible: false });
  assert.match(r.result, /locked/); assert.equal(r.scene.elements.find((e) => e.id === 'el_disc').visible, true);
  const un = S.runTool(sc, 'set_lock', { target: 'disclaimer', locked: false }).scene;
  assert.equal(S.runTool(un, 'set_visibility', { target: 'disclaimer', visible: false }).scene.elements.find((e) => e.id === 'el_disc').visible, false);
});

test('delete, duplicate and reorder', () => {
  const sc = load();
  const del = S.runTool(sc, 'delete_element', { target: 'cta' });
  assert.equal(del.scene.elements.length, sc.elements.length - 2, 'button + label deleted together'); assert.match(del.result, /^Deleted CTA button, CTA label$/);
  const dup = S.duplicateElements(sc, ['el_cta', 'el_cta_t']);
  assert.deepEqual(dup.ids, ['el_cta_copy', 'el_cta_t_copy']);
  const copies = dup.scene.elements.filter((e) => dup.ids.includes(e.id));
  assert.equal(new Set(copies.map((e) => e.semanticGroup)).size, 1); assert.notEqual(copies[0].semanticGroup, 'sg_cta'); assert.equal(copies[0].bounds.x, 64 + 24);
  const back = S.applyOps(sc, S.reorderOps(sc, ['el_head'], 'back'));
  const order = [...back.elements].sort((a, b) => a.zIndex - b.zIndex).map((e) => e.id);
  assert.equal(order[0], 'el_bg', 'background stays at the bottom'); assert.equal(order[1], 'el_head');
  const fwd = S.applyOps(sc, S.reorderOps(sc, ['el_sub'], 'forward'));
  const o2 = [...fwd.elements].sort((a, b) => a.zIndex - b.zIndex).map((e) => e.id);
  assert.ok(o2.indexOf('el_sub') === order.indexOf('el_sub') + 1 || o2.indexOf('el_sub') > [...sc.elements].sort((a, b) => a.zIndex - b.zIndex).map((e) => e.id).indexOf('el_sub'));
});

test('set_font changes family and style; summarize exposes locks', () => {
  const sc = load();
  const r = S.runTool(sc, 'set_font', { target: 'headline', fontFamily: 'Poppins', fontStyle: 'Bold' });
  assert.equal(r.scene.elements.find((e) => e.id === 'el_head').text.fontFamily, 'Poppins');
  assert.equal(S.summarize(sc).find((e) => e.id === 'el_disc').locked, true);
});
