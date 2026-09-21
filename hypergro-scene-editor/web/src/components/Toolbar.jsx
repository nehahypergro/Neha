import React, { useState } from 'react';
import { isCssShape } from '../lib/render.js';
import { FONT_CHOICES, STYLE_CHOICES } from '../lib/palette.js';
import { Swatches, LogoPicker } from './Form.jsx';
import { isBoldStyle, isItalicStyle, listKind } from '../lib/edit.js';

/** Align, space and layer order in one menu. One item aligns to the page; several align to each other. */
function Arrange({ els, ctl }) {
  const [open, setOpen] = useState(false); const ids = els.map((e) => e.id); const many = els.length > 1; const grouped = els.some((e) => e.semanticGroup?.startsWith('user_'));
  const go = (fn) => () => { fn(); setOpen(false); };
  return (
    <span className="menu-wrap">
      <button className="btn small" onClick={() => setOpen(!open)} aria-expanded={open} title="Align, space evenly, bring forward or send back">Position ▾</button>
      {open && <><div className="menu-backdrop" onMouseDown={() => setOpen(false)} /><div className="menu left"><div className="align-grid">
        <span className="hintsm full">{many ? 'Align to each other' : 'Align to the page'}</span>
        {[['left', '⇤ Left'], ['center', '↔ Centre'], ['right', '⇥ Right'], ['top', '⤒ Top'], ['middle', '↕ Middle'], ['bottom', '⤓ Bottom']].map(([k, l]) => <button key={k} className="btn small" onClick={go(() => ctl.align(ids, k))}>{l}</button>)}
        {els.length > 2 && <><span className="hintsm full">Space evenly</span><button className="btn small" onClick={go(() => ctl.distribute(ids, 'x'))}>Across</button><button className="btn small" onClick={go(() => ctl.distribute(ids, 'y'))}>Down</button><span /></>}
        <span className="hintsm full">Layer</span>
        <button className="btn small" onClick={go(() => ctl.order(ids, 'forward'))} title="⌘ ]">Forward</button><button className="btn small" onClick={go(() => ctl.order(ids, 'backward'))} title="⌘ [">Backward</button><span />
        <button className="btn small" onClick={go(() => ctl.order(ids, 'front'))}>To front</button><button className="btn small" onClick={go(() => ctl.order(ids, 'back'))}>To back</button><span />
        {many && <button className="btn small full" onClick={go(() => ctl.group(ids))} title="⌘ G">Group, so they move together</button>}
        {grouped && <button className="btn small full" onClick={go(() => ctl.ungroup(ids))} title="⌘ ⇧ G">Ungroup</button>}
      </div></div></>}
    </span>
  );
}
function SizeFields({ el, ctl }) {
  const [w, setW] = useState(null), [h, setH] = useState(null); const b = el.bounds;
  const commit = (k, v) => { const n = Math.round(+v); if (n >= 4 && n !== Math.round(b[k])) ctl.setSize(el, { [k]: n }); setW(null); setH(null); };
  return (<span className="hint" title={el.type === 'image' ? 'Size in pixels. Pictures keep their shape.' : 'Size in pixels'}>W <input className="dim-input" type="number" min="4" value={w ?? Math.round(b.width)} onChange={(e) => setW(e.target.value)} onBlur={(e) => commit('width', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label="Width in pixels" /> H <input className="dim-input" type="number" min="4" value={h ?? Math.round(b.height)} onChange={(e) => setH(e.target.value)} onBlur={(e) => commit('height', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-label="Height in pixels" /></span>);
}
function FontSize({ el, ctl }) {
  const [v, setV] = useState(null); const fs = Math.round(el.text.fontSize);
  const commit = (raw) => { const n = Math.round(+raw); if (n >= 4 && n <= 2000 && n !== fs) ctl.setFontSize(el, n, `Set the ${el.name} size to ${n}`); setV(null); };
  return (<span className="stepper" aria-label="Text size"><button onClick={() => ctl.setFontSize(el, Math.max(4, fs - 1), `Made the ${el.name} smaller`)} aria-label="Smaller">−</button><input className="size-input" type="number" min="4" max="2000" value={v ?? fs} aria-label="Text size" onChange={(e) => setV(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><button onClick={() => ctl.setFontSize(el, fs + 1, `Made the ${el.name} bigger`)} aria-label="Bigger">+</button></span>);
}

const Vs = () => <span className="vs" aria-hidden="true" />;

function Actions({ el, els, ctl, reset }) {
  const ids = els.map((e) => e.id);
  return (
    <>
      <span className="grow" />
      <Arrange els={els} ctl={ctl} />
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
      <FontSize el={el} ctl={ctl} />
      <Vs />
      <span className="colour-a" title="Text colour" aria-hidden="true">A<i style={{ background: el.fill || '#000' }} /></span>
      <Swatches label="Text colour" value={el.fill} palette={palette} more={fullPalette} onChange={(c) => ctl.set(el.id, { fill: c }, `Recoloured the ${el.name}`)} />
      <Vs />
      <button className={'tgl' + (isBoldStyle(t.fontStyle) ? ' on' : '')} disabled={legacy} aria-pressed={isBoldStyle(t.fontStyle)} title="Bold (⌘B)" onClick={() => ctl.toggleBold(el)}>B</button>
      <button className={'tgl i' + (isItalicStyle(t.fontStyle) ? ' on' : '')} disabled={legacy} aria-pressed={isItalicStyle(t.fontStyle)} title="Italic (⌘I)" onClick={() => ctl.toggleItalic(el)}>I</button>
      <button className={'tgl u' + (t.underline ? ' on' : '')} aria-pressed={!!t.underline} title="Underline (⌘U)" onClick={() => ctl.textStyle(el, { underline: !t.underline }, `${t.underline ? 'Removed the underline from' : 'Underlined'} the ${el.name}`)}>U</button>
      <button className={'tgl s' + (t.strike ? ' on' : '')} aria-pressed={!!t.strike} title="Strikethrough" onClick={() => ctl.textStyle(el, { strike: !t.strike }, `${t.strike ? 'Removed the strikethrough from' : 'Struck through'} the ${el.name}`)}>S</button>
      <button className="tgl" disabled={legacy} title="UPPERCASE on / off (⌘⇧K)" onClick={() => ctl.toggleCase(el)}>aA</button>
      <Vs />
      <button className={'tgl' + (listKind(t.content) === 'bullet' ? ' on' : '')} disabled={legacy} title="Bulleted list" aria-label="Bulleted list" onClick={() => ctl.toggleList(el, 'bullet')}>•≡</button>
      <button className={'tgl' + (listKind(t.content) === 'number' ? ' on' : '')} disabled={legacy} title="Numbered list" aria-label="Numbered list" onClick={() => ctl.toggleList(el, 'number')}>1≡</button>
      <Vs />
      <span className="seg small" role="radiogroup" aria-label="Alignment">{['left', 'center', 'right', 'justify'].map((a) => <button key={a} className={(t.align || 'left') === a ? 'on' : ''} aria-label={`Align ${a}`} title={`Align ${a}`} onClick={() => ctl.set(el.id, { text: { align: a } }, `Aligned the ${el.name} ${a}`)}>{a === 'left' ? '⇤' : a === 'center' ? '☰' : a === 'right' ? '⇥' : '▤'}</button>)}</span>
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
      {!isLogo && <button className="btn small" onClick={() => ctl.openCrop(el)}>{el.meta?.crop ? 'Change crop' : 'Crop'}</button>}
      <Vs />
      <SizeFields el={el} ctl={ctl} />
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
      <Vs /><SizeFields el={el} ctl={ctl} />
      <Actions el={el} els={[el]} ctl={ctl} reset />
    </>
  );
}

export default function Toolbar({ scene, sel, kit, palette, fullPalette, surfaces = {}, ctl }) {
  const els = sel.map((id) => scene?.elements.find((e) => e.id === id)).filter(Boolean);
  const el = els[0];
  let body;
  if (!el) body = <><button className="btn small" onClick={ctl.addText} title="Add a text box (T)">＋ Text</button><label className="btn small" title="Add a picture from your computer">＋ Picture<input type="file" accept="image/*" onChange={(ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) ctl.addImage(f); }} /></label><Vs /><span className="hint">Click anything to change it. Double-click text to type. Drag a box to select several.</span><span className="grow" /><button className="linkbtn" onClick={ctl.showShortcuts}>Keyboard shortcuts</button></>;
  else if (els.length > 1) body = <><span className="hint strong">{els.length} items selected</span><button className="btn small" onClick={() => ctl.group(els.map((e) => e.id))} title="⌘G">Group</button><Actions els={els} ctl={ctl} /></>;
  else if (el.locked) body = <span className="lockbar"><span className="pill">🔒 Fixed by brand</span><span>{el.name} stays as the brand book sets it, so the creative stays on brand.</span><button className="linkbtn" onClick={() => ctl.setLock(el, false)}>Unlock</button></span>;
  else if (el.type === 'text') body = <TextBar el={el} kit={kit} palette={palette} fullPalette={fullPalette} ctl={ctl} />;
  else if (isCssShape(el)) body = <ShapeBar el={el} palette={palette} fullPalette={fullPalette} ctl={ctl} />;
  else body = <ImageBar el={el} kit={kit} surface={surfaces[el.id]?.surface} ctl={ctl} />;
  return <div className="ctx" role="toolbar" aria-label={el ? `${el.name} tools` : 'Tools'} onMouseDown={(e) => e.stopPropagation()}>{body}</div>;
}
