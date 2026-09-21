import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readiness, appendEvents, readEvents } from '../server/bundles.mjs';

const text = (id, extra = {}) => ({ id, type: 'text', visible: true, role: 'body', bounds: { x: 0, y: 0, width: 10, height: 10 }, text: { content: 'x', fontFamily: 'Lato', ...extra.text }, meta: extra.meta || {} });

test('readiness grades an upload in plain words', () => {
  const ready = readiness({ elements: [text('a'), text('b'), { id: 'p', type: 'image', visible: true, role: 'image', meta: {} }, { id: 'l', type: 'image', visible: true, role: 'logo', meta: {} }], fonts: [{ family: 'Lato', onFile: true }], warnings: [] });
  assert.equal(ready.grade, 'ready'); assert.ok(ready.items.every((i) => i.ok));
  const partly = readiness({ elements: [text('a'), text('b', { meta: { overlay: true } }), text('c', { text: { encoding: 'legacy' } })], fonts: [{ family: 'Gotham', onFile: false }], warnings: ['“Kotak logo” sits on a photo or gradient in the artwork, so it stays part of the artwork'] });
  assert.equal(partly.grade, 'limited'); assert.deepEqual(partly.fontsNotOnFile, ['Gotham']); assert.equal(partly.legacy, 1); assert.equal(partly.logosBaked, 1);
  assert.ok(partly.items.some((i) => /Gotham/.test(i.text)) && partly.items.some((i) => /legacy/.test(i.text)));
});

test('the audit log is append-only and skips duplicates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'events-'));
  assert.equal(await appendEvents(dir, [{ at: 1, by: 'Neha', label: 'Uploaded a.ai' }, { at: 2, by: 'Neha', label: 'Changed the headline' }]), 2);
  assert.equal(await appendEvents(dir, [{ at: 2, by: 'Neha', label: 'Changed the headline' }, { at: 3, label: 'Downloaded the print PDF file' }]), 1);
  const ev = await readEvents(dir); assert.equal(ev.length, 3); assert.equal(ev[2].by, 'Someone'); assert.equal(ev[0].label, 'Uploaded a.ai');
});
