import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, runTool } from '../shared/scene.js';

const scene = normalize({ version: '1.0', document: { name: 't', width: 400, height: 200 }, elements: [
  { id: 'el_1', type: 'text', name: 'Telugu line', bounds: { x: 10, y: 10, width: 200, height: 30 }, text: { content: 'kAoTaAlhBa', fontFamily: 'Shree-Tel-0900', fontSize: 20, encoding: 'legacy' }, meta: { legacyScript: 'telugu' } },
] });

test('legacy-encoded text refuses rewrites and font changes but accepts colour and size', () => {
  const r1 = runTool(scene, 'set_text', { target: 'el_1', content: 'Hello' });
  assert.equal(r1.scene.elements[0].text.content, 'kAoTaAlhBa'); assert.match(r1.result, /legacy telugu font/i);
  const r2 = runTool(scene, 'set_font', { target: 'el_1', fontFamily: 'Lato' });
  assert.equal(r2.scene.elements[0].text.fontFamily, 'Shree-Tel-0900'); assert.match(r2.result, /cannot be changed/);
  const r3 = runTool(scene, 'set_text', { target: 'el_1', fontSize: 30 }); assert.equal(r3.scene.elements[0].text.fontSize, 30);
  const r4 = runTool(scene, 'set_fill', { target: 'el_1', color: '#FF9C00' }); assert.equal(r4.scene.elements[0].fill, '#FF9C00');
});
