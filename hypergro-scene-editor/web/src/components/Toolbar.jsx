import React, { useState } from 'react';
import { isCssShape } from '../lib/render.js';
import { FONT_CHOICES, STYLE_CHOICES } from '../lib/palette.js';
import { Swatches, LogoPicker } from './Form.jsx';

const Vs = () => <span className="vs" aria-hidden="true" />;

function Actions({ el, els, ctl, reset }) {
  const ids = els.map((e) => e.id);
  return (
    <>
      <span className="grow" />
      {el && <button className="btn small" onClick={() => ctl.set(el.id, { visible: false }, `Hid ${el.name}`)}>Hide</button>}
      {reset && el && <button className="btn small" onClick={() => ctl.resetElement(el.id)}>Reset</button>}
      <button className="tb" title="Duplicate (⌘D)" aria-label="Duplicate" onClick={() => ctl.duplicate(ids)}>⧉</button>
      <button className="tb" title="Delete (⌫)" aria-label="Delete" onClick={() => ctl.remove(ids)}>🗑</button>
    </>
  );
}

function TextBar({ el, kit, palette, fullPalette, ctl }) {
  const brandFams = kit ? [[kit.fonts.headline.family, `${kit.fonts.headline.family} · headlines`], [kit.fonts.body.family, `${kit.fonts.body.family} · body copy`]] : [];
  const fonts = [...brandFams, ...FONT_CHOICES.filter((f) => !brandFams.some(([b]) => b === f)).map((f) => [f, f])];
  if (el.text.fontFamily && !fonts.some(([f]) => f === el.text.fontFamily)) fonts.push([el.text.fontFamily, el.text.fontFamily]);
  const styles = STYLE_CHOICES.includes(el.text.fontStyle) ? STYLE_CHOICES : [el.text.fontStyle, ...STYLE_CHOICES];
  const t = el.text; const legacy = t.encoding === 'legacy';
  return (
    <>
      {legacy && <><span className="pill legacy" title={`Typed in ${t.fontFamily}. The letters are keystrokes for that font, so new words or another font would show wrong characters. Size, colour and position are fine.`}>Legacy {el.meta?.legacyScript || 'Indic'} font · words can’t be changed here</span><button className="btn small" onClick={() => ctl.readWords(el)} title="Reads the printed words from the original design and turns them into real text you can edit and translate">Read the words</button></>}
      <select className="font-select" disabled={legacy} value={t.fontFamily || ''} aria-label="Font" style={{ fontFamily: `"${t.fontFamily}", sans-serif` }} onChange={(ev) => ctl.set(el.id, { text: { fontFamily: ev.target.value } }, `Changed the ${el.name} font`)}>{fonts.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select>
      <select value={t.fontStyle || 'Regular'} aria-label="Style" disabled={legacy} onChange={(ev) => ctl.set(el.id, { text: { fontStyle: ev.target.value } }, `Changed the ${el.name} style`)}>{styles.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      <span className="stepper" aria-label="Text size"><button onClick={() => ctl.setFontSize(el, Math.max(6, Math.round(t.fontSize) - 2), `Made the ${el.name} smaller`)} aria-label="Smaller">−</button><span>{Math.round(t.fontSize)}</span><button onClick={() => ctl.setFontSize(el, Math.round(t.fontSize) + 2, `Made the ${el.name} bigger`)} aria-label="Bigger">+</button></span>
      <Vs />
      <span className="colour-a" title="Text colour" aria-hidden="true">A<i style={{ background: el.fill || '#000' }} /></span>
      <Swatches label="Text colour" value={el.fill} palette={palette} more={fullPalette} onChange={(c) => ctl.set(el.id, { fill: c }, `Recoloured the ${el.name}`)} />
      <Vs />
      <span className="seg small" role="radiogroup" aria-label="Alignment">{['left', 'center', 'right'].map((a) => <button key={a} className={(t.align || 'left') === a ? 'on' : ''} aria-label={`Align ${a}`} title={`Align ${a}`} onClick={() => ctl.set(el.id, { text: { align: a } }, `Aligned the ${el.name} ${a}`)}>{a === 'left' ? '⇤' : a === 'center' ? '☰' : '⇥'}</button>)}</span>
      <Vs />
      {!legacy && <button className="btn small" onClick={() => ctl.editText(el.id)}>✎ Edit text</button>}
      <Actions el={el} els={[el]} ctl={ctl} reset />
    </>
  );
}

function ImageBar({ el, kit, surface, ctl }) {
  const [pick, setPick] = useState(false);
  const isLogo = el.role === 'logo' || !!el.meta?.logo;
  return (
    <>
      {isLogo && kit && <span className="menu-wrap"><button className="btn small" onClick={() => setPick(!pick)}>Swap logo ▾</button>{pick && <><div className="menu-backdrop" onMouseDown={() => setPick(false)} /><div className="menu left wide"><LogoPicker kit={kit} surface={surface} onClose={() => setPick(false)} onPick={(l) => { setPick(false); ctl.replaceLogo(l, el.id); }} /></div></>}</span>}
      <label className="btn small">Replace image<input type="file" accept="image/*" onChange={(ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) ctl.replaceImage(el.id, f); }} /></label>
      <span className="hint">Drag the corners to resize · the picture keeps its shape</span>
      <Actions el={el} els={[el]} ctl={ctl} reset />
    </>
  );
}

function ShapeBar({ el, palette, fullPalette, ctl }) {
  const r = el.meta?.cornerRadius || 0, maxR = Math.floor(Math.min(el.bounds.width, el.bounds.height) / 2);
  return (
    <>
      <span className="hint strong">{el.name} colour</span>
      <Swatches label={`${el.name} colour`} value={el.fill} palette={palette} more={fullPalette} onChange={(c) => ctl.set(el.id, { fill: c, renderMode: 'css' }, `Recoloured the ${el.name}`)} />
      {el.meta?.kind !== 'ellipse' && <><Vs /><span className="hint">Corners</span><span className="stepper" aria-label="Corner roundness"><button aria-label="Squarer" disabled={r <= 0} onClick={() => ctl.set(el.id, { meta: { cornerRadius: Math.max(0, r - 4) } }, `Made the ${el.name} squarer`)}>−</button><span>{Math.round(r)}</span><button aria-label="Rounder" disabled={r >= maxR} title={r >= maxR ? 'Already fully rounded' : undefined} onClick={() => ctl.set(el.id, { meta: { cornerRadius: Math.min(maxR, r + 4) } }, `Made the ${el.name} rounder`)}>+</button></span></>}
      <Actions el={el} els={[el]} ctl={ctl} reset />
    </>
  );
}

export default function Toolbar({ scene, sel, kit, palette, fullPalette, surfaces = {}, ctl }) {
  const els = sel.map((id) => scene?.elements.find((e) => e.id === id)).filter(Boolean);
  const el = els[0];
  let body;
  if (!el) body = <><span className="hint">Click anything on the creative to change it. Double-click text to type.</span><span className="grow" /><span className="hint">Drag to move · corners resize · ⌘Z undo</span></>;
  else if (els.length > 1) body = <><span className="hint strong">{els.length} items selected</span><Actions els={els} ctl={ctl} /></>;
  else if (el.locked) body = <span className="lockbar"><span className="pill">🔒 Fixed by brand</span><span>{el.name} stays as the brand book sets it, so the creative stays on brand.</span><button className="linkbtn" onClick={() => ctl.setLock(el, false)}>Unlock</button></span>;
  else if (el.type === 'text') body = <TextBar el={el} kit={kit} palette={palette} fullPalette={fullPalette} ctl={ctl} />;
  else if (isCssShape(el)) body = <ShapeBar el={el} palette={palette} fullPalette={fullPalette} ctl={ctl} />;
  else body = <ImageBar el={el} kit={kit} surface={surfaces[el.id]?.surface} ctl={ctl} />;
  return <div className="ctx" role="toolbar" aria-label={el ? `${el.name} tools` : 'Tools'} onMouseDown={(e) => e.stopPropagation()}>{body}</div>;
}
