import React, { useEffect, useRef, useState } from 'react';
import { assetUrl, isCssShape, hex } from '../lib/render.js';
import { FONT_CHOICES, STYLE_CHOICES } from '../lib/palette.js';
import { brandColorName } from '../lib/brand.js';
import { SURFACE_LABEL } from '../lib/logoSurface.js';

const ORDER = ['headline', 'subhead', 'offer', 'cta', 'body', 'disclaimer', 'logo', 'product', 'image', 'shape', 'decoration', 'background'];
const rank = (e) => { const r = ORDER.indexOf(e.role); return (r < 0 ? 50 : r) * 1e6 + e.bounds.y * 100 + e.bounds.x / 100; };
const bgFor = { light: '#ffffff', dark: '#004CBE', orange: '#FF9C00' };

export function Swatches({ value, palette, more, onChange, label }) {
  const [open, setOpen] = useState(false);
  const cur = hex(value).toUpperCase();
  const extra = (more || []).filter((c) => !palette.some((m) => m.hex === c.hex));
  const chip = (c) => <button key={c.hex} className={'swatch' + (c.hex === cur ? ' on' : '')} style={{ background: c.hex }} title={c.name !== c.hex ? `${c.name} · ${c.hex}` : c.hex} aria-label={`${label}: ${c.name}`} onClick={(e) => { e.stopPropagation(); onChange(c.hex); }} />;
  return (
    <div className="swatches-wrap" onClick={(e) => e.stopPropagation()}>
      <div className="swatches" role="group" aria-label={label}>
        {palette.map(chip)}
        <label className="swatch custom" title="Pick any colour"><input type="color" value={cur} aria-label={`${label}, custom`} onChange={(e) => onChange(e.target.value.toUpperCase())} />+</label>
        {extra.length > 0 && <button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'fewer colours' : 'more brand colours'}</button>}
      </div>
      {open && <div className="swatches">{extra.map(chip)}</div>}
    </div>
  );
}

function AutoTextarea({ value, onChange, onBlur, disabled, focusOnMount }) {
  const ref = useRef();
  useEffect(() => { const n = ref.current; if (n) { n.style.height = 'auto'; n.style.height = Math.min(180, n.scrollHeight) + 'px'; } }, [value]);
  useEffect(() => { if (focusOnMount && ref.current && !disabled) { const n = ref.current; n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <textarea ref={ref} rows={1} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} spellCheck={false} aria-label="Text" onClick={(e) => e.stopPropagation()} />;
}

function useRowRef(on) { const ref = useRef(); useEffect(() => { if (on && ref.current) ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [on]); return ref; }

function LockNote({ e, ctl }) {
  return <div className="locknote"><span>🔒 Fixed by brand</span><button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); ctl.setLock(e, false); }}>Unlock</button></div>;
}

export function LogoPicker({ kit, onPick, onClose, surface }) {
  const logos = surface ? [...kit.logos].sort((a, b) => (b.on === surface) - (a.on === surface)) : kit.logos;
  return (
    <div className="logo-picker" onClick={(e) => e.stopPropagation()}>
      <div className="field-label">Approved logos <button className="linkbtn" onClick={onClose}>close</button></div>
      {surface && <div className="hintsm">The logo sits on {SURFACE_LABEL[surface]} here, so these versions suit it best.</div>}
      <div className="logo-grid">{logos.map((l) => <button key={l.id} className={'logo-card' + (surface && l.on !== surface ? ' dim' : '')} onClick={() => onPick(l)} title={surface && l.on !== surface ? `${l.name} · made for ${SURFACE_LABEL[l.on]}` : l.name}><span className="logo-thumb" style={{ background: bgFor[l.on] || '#fff' }}><img src={kit.base + l.file} alt={l.name} /></span><span className="logo-name">{l.name}{surface && l.on === surface && <em className="fit-badge">suits this background</em>}</span></button>)}</div>
    </div>
  );
}

function TextRow({ e, on, palette, fullPalette, kit, focusKey, ctl }) {
  const ref = useRowRef(on);
  const brandFams = kit ? [[kit.fonts.headline.family, `${kit.fonts.headline.family} · headlines`], [kit.fonts.body.family, `${kit.fonts.body.family} · body copy`]] : [];
  const fonts = [...brandFams, ...FONT_CHOICES.filter((f) => !brandFams.some(([b]) => b === f)).map((f) => [f, f])];
  if (e.text.fontFamily && !fonts.some(([f]) => f === e.text.fontFamily)) fonts.push([e.text.fontFamily, e.text.fontFamily]);
  const styles = STYLE_CHOICES.includes(e.text.fontStyle) ? STYLE_CHOICES : [e.text.fontStyle, ...STYLE_CHOICES];
  const legacy = e.text.encoding === 'legacy';
  return (
    <div ref={ref} className={'frow' + (on ? ' on' : '') + (e.visible ? '' : ' hidden')} onClick={() => { if (!on) ctl.selectFromForm(e.id); }} role={on ? undefined : 'button'} tabIndex={on ? -1 : 0} onKeyDown={(ev) => { if (!on && ev.key === 'Enter') ctl.selectFromForm(e.id); }}>
      <div className="frow-head"><span className="frow-name">{e.name}</span>{!e.visible && <button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); ctl.set(e.id, { visible: true }, `Showed ${e.name}`); }}>hidden · show</button>}</div>
      {!on && <div className="frow-preview" style={{ color: e.locked ? 'var(--muted)' : undefined }}>{e.text.content.replace(/\s+/g, ' ') || <em>empty</em>}</div>}
      {on && e.locked && <><div className="frow-preview">{e.text.content}</div><LockNote e={e} ctl={ctl} /></>}
      {on && !e.locked && (
        <>
          {legacy && <div className="locknote legacy"><span>Typed in a legacy {e.meta?.legacyScript || 'Indic'} font ({e.text.fontFamily}). The words show correctly on the creative but can’t be rewritten here; ask the designer to retype them.</span></div>}
          <AutoTextarea key={focusKey} value={e.text.content} onChange={(v) => ctl.fieldEdit(e.id, v)} onBlur={ctl.fieldEnd} focusOnMount={focusKey != null} disabled={legacy} />
          <div className="frow-tools" onClick={(ev) => ev.stopPropagation()}>
            <select value={e.text.fontFamily || ''} aria-label="Font" disabled={legacy} onChange={(ev) => ctl.set(e.id, { text: { fontFamily: ev.target.value } }, `Changed ${e.name} font`)}>{fonts.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select>
            <select value={e.text.fontStyle || 'Regular'} aria-label="Style" disabled={legacy} onChange={(ev) => ctl.set(e.id, { text: { fontStyle: ev.target.value } }, `Changed ${e.name} style`)}>{styles.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <span className="stepper" aria-label="Size"><button onClick={() => ctl.set(e.id, { text: { fontSize: Math.max(6, Math.round(e.text.fontSize) - 2) } }, `Made ${e.name} smaller`)}>−</button><span>{Math.round(e.text.fontSize)}</span><button onClick={() => ctl.set(e.id, { text: { fontSize: Math.round(e.text.fontSize) + 2 } }, `Made ${e.name} bigger`)}>+</button></span>
            <span className="seg small" role="radiogroup" aria-label="Alignment">{['left', 'center', 'right'].map((a) => <button key={a} className={e.text.align === a ? 'on' : ''} aria-label={`Align ${a}`} onClick={() => ctl.set(e.id, { text: { align: a } }, `Aligned ${e.name} ${a}`)}>{a === 'left' ? '⇤' : a === 'center' ? '☰' : '⇥'}</button>)}</span>
          </div>
          <Swatches label="Text colour" value={e.fill} palette={palette} more={fullPalette} onChange={(c) => ctl.set(e.id, { fill: c }, `Recoloured ${e.name}`)} />
          <div className="frow-foot"><button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); ctl.set(e.id, { visible: false }, `Hid ${e.name}`); }}>Hide</button><button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); ctl.resetElement(e.id); }}>Reset</button></div>
        </>
      )}
    </div>
  );
}

function ImageRow({ e, on, assets, kit, surface, ctl }) {
  const [pick, setPick] = useState(false); const ref = useRowRef(on);
  const url = assetUrl(e, assets); const isLogo = e.role === 'logo' || !!e.meta?.logo;
  return (
    <div ref={ref} className={'frow' + (on ? ' on' : '') + (e.visible ? '' : ' hidden')} onClick={() => { if (!on) ctl.select(e.id); }} role={on ? undefined : 'button'} tabIndex={on ? -1 : 0}>
      <div className="frow-head"><span className="frow-name">{e.name}</span>{!e.visible && <button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); ctl.set(e.id, { visible: true }, `Showed ${e.name}`); }}>hidden · show</button>}</div>
      <div className="frow-image">
        <span className="thumb-sm" style={{ background: isLogo ? '#004CBE' : undefined }}>{url ? <img src={url} alt="" /> : <span className="hintsm">missing</span>}</span>
        {e.locked ? <LockNote e={e} ctl={ctl} /> : (
          <span className="row-btns">
            {isLogo && kit && <button className="btn small" onClick={(ev) => { ev.stopPropagation(); ctl.select(e.id); setPick(!pick); }}>Swap logo</button>}
            <label className="btn small" onClick={(ev) => ev.stopPropagation()}>Replace image<input type="file" accept="image/*" onChange={(ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) ctl.replaceImage(e.id, f); }} /></label>
            {on && <button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); ctl.set(e.id, { visible: false }, `Hid ${e.name}`); }}>Hide</button>}
          </span>
        )}
      </div>
      {pick && kit && <LogoPicker kit={kit} surface={surface} onClose={() => setPick(false)} onPick={(l) => { setPick(false); ctl.replaceLogo(l, e.id); }} />}
    </div>
  );
}

function ColourRow({ e, on, palette, fullPalette, kit, ctl }) {
  const ref = useRowRef(on);
  return (
    <div ref={ref} className={'frow' + (on ? ' on' : '') + (e.visible ? '' : ' hidden')} onClick={() => { if (!on) ctl.select(e.id); }} role={on ? undefined : 'button'} tabIndex={on ? -1 : 0}>
      <div className="frow-head"><span className="frow-name">{e.name}</span>{!e.visible && <button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); ctl.set(e.id, { visible: true }, `Showed ${e.name}`); }}>hidden · show</button>}</div>
      {e.locked ? <div className="frow-preview"><span className="dot" style={{ background: e.fill }} /> {brandColorName(kit, e.fill) || e.fill}<LockNote e={e} ctl={ctl} /></div>
        : <Swatches label={`${e.name} colour`} value={e.fill} palette={palette} more={fullPalette} onChange={(c) => ctl.set(e.id, { fill: c, renderMode: 'css' }, `Recoloured ${e.name}`)} />}
    </div>
  );
}

export default function Form({ scene, assets, sel, palette, fullPalette, kit, focusKey, surfaces = {}, ctl }) {
  const [addLogo, setAddLogo] = useState(false); const [addSurface, setAddSurface] = useState(null);
  const openAdd = () => { if (!addLogo) { setAddSurface(null); ctl.surfaceAtDefault?.().then((s) => setAddSurface(s?.surface || null)).catch(() => {}); } setAddLogo(!addLogo); };
  if (!scene) return null;
  const items = scene.elements.filter((e) => e.type !== 'group' && !(e.role === 'background' && !isCssShape(e))).sort((a, b) => rank(a) - rank(b));
  const texts = items.filter((e) => e.type === 'text'), images = items.filter((e) => e.type !== 'text' && !isCssShape(e)), colours = items.filter((e) => e.type !== 'text' && isCssShape(e) && e.fill);
  return (
    <section className="form">
      <div className="form-title">What’s on this creative</div>
      {texts.length > 0 && <><div className="group-title">Text</div>{texts.map((e) => <TextRow key={e.id} e={e} on={sel.includes(e.id)} palette={palette} fullPalette={fullPalette} kit={kit} focusKey={sel.includes(e.id) ? focusKey : null} ctl={ctl} />)}</>}
      <div className="group-title">Images & logo</div>
      {images.map((e) => <ImageRow key={e.id} e={e} on={sel.includes(e.id)} assets={assets} kit={kit} surface={surfaces[e.id]?.surface} ctl={ctl} />)}
      {kit && <div className="frow add" onClick={openAdd}><span className="frow-name">+ Add a logo</span>{addLogo && <LogoPicker kit={kit} surface={addSurface} onClose={() => setAddLogo(false)} onPick={(l) => { setAddLogo(false); ctl.insertLogo(l); }} />}</div>}
      {colours.length > 0 && <><div className="group-title">Colours</div>{colours.map((e) => <ColourRow key={e.id} e={e} on={sel.includes(e.id)} palette={palette} fullPalette={fullPalette} kit={kit} ctl={ctl} />)}</>}
    </section>
  );
}
