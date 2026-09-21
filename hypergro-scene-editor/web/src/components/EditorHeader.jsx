import React, { useState } from 'react';
import Activity from './Activity.jsx';

const FORMAT_LABEL = { jpg: 'Download JPG', pdf: 'Download print file', ai: 'Download .ai', png: 'Download PNG', svg: 'Download SVG' };
const PHASE_LABEL = { fonts: 'fonts', images: 'images', writing: 'writing the file', rendering: 'rendering' };
export default function EditorHeader({ kit, name, saveState, exporting, exportTick = 0, lastFormat = 'jpg', langProgress = {}, designer, canUndo, canRedo, undo, redo, past = [], versions, user, onUser, contentsOpen, hasCheck, variants = [], language, ctl }) {
  const secs = exporting ? Math.round((Date.now() - exporting.startedAt) / 1000) : 0; void exportTick;
  const busyLabel = exporting ? `Preparing ${exporting.format === 'pdf' ? 'print file' : exporting.format === 'ai' ? '.ai file' : exporting.format.toUpperCase()}… ${PHASE_LABEL[exporting.phase] || ''}${secs >= 3 ? ` · ${secs} s` : ''}` : null;
  const [menu, setMenu] = useState(null); const [copyName, setCopyName] = useState(''); const [newName, setNewName] = useState('');
  const save = saveState.status === 'saving' ? 'Saving…' : saveState.status === 'unsaved' ? 'Saving soon…' : saveState.status === 'error' ? 'Not saved · check your connection' : saveState.status === 'local' ? 'Saved on this computer' : '☁ Auto-saved';
  const close = () => setMenu(null);
  const pop = (key, body, cls = '') => menu === key && <><div className="menu-backdrop" onMouseDown={close} /><div className={'menu ' + cls}>{body}</div></>;
  return (
    <header className="ehead">
      <button className="back" onClick={ctl.goHome} title="Back to My creatives">‹ My creatives</button>
      <div className="vsep" />
      <button className="tb" onClick={ctl.undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">↶</button>
      <button className="tb" onClick={ctl.redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
      <div className="ehead-title menu-wrap">
        <button className="creative-name" title="Rename" onClick={() => { setNewName(name); setMenu(menu === 'rename' ? null : 'rename'); }}>{name}{language && !name.toLowerCase().includes(language.toLowerCase()) ? <span className="lang-tag">{language}</span> : null} <span className="hintsm">✎</span></button>
        <span className="savestate">{save}</span>
        {pop('rename', <>
          <div className="field-label">Name this creative</div>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { ctl.rename(newName); close(); } if (e.key === 'Escape') close(); }} />
          <div className="row-btns"><button className="btn ghost small" onClick={close}>Cancel</button><button className="btn accent small" onClick={() => { ctl.rename(newName); close(); }}>Save</button></div>
        </>, 'pop centre')}
      </div>
      <div className="ehead-right">
        <button className={'btn ghost' + (contentsOpen ? ' on' : '')} onClick={ctl.toggleContents} aria-pressed={contentsOpen} title="A list of everything on this creative">☰ Contents</button>
        <span className="menu-wrap">
          <button className="btn ghost" onClick={() => setMenu(menu === 'act' ? null : 'act')} aria-expanded={menu === 'act'}>🕒 Activity{undo.length + past.length ? ` · ${undo.length + past.length}` : ''}</button>
          {pop('act', <Activity undo={undo} redo={redo} past={past} versions={versions} user={user} onUser={onUser} ctl={ctl} forceOpen />, 'plain')}
        </span>
        <span className="menu-wrap">
          <button className="btn ghost" onClick={() => setMenu(menu === 'lang' ? null : 'lang')} aria-expanded={menu === 'lang'}>🌐 Languages{variants.length ? ` · ${variants.length}` : ''}</button>
          {pop('lang', <LanguageMenu variants={variants} language={language} progress={langProgress} ctl={ctl} close={close} />, 'plain')}
        </span>
        <span className="menu-wrap">
          <button className="btn" onClick={() => setMenu(menu === 'copy' ? null : 'copy')}>Save a copy</button>
          {pop('copy', <>
            <div className="field-label">Name this copy</div>
            <input autoFocus value={copyName} placeholder="e.g. Diwali price" onChange={(e) => setCopyName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { ctl.saveVersion(copyName.trim() || 'Copy'); setCopyName(''); close(); } if (e.key === 'Escape') close(); }} />
            <div className="row-btns"><button className="btn ghost small" onClick={close}>Cancel</button><button className="btn accent small" onClick={() => { ctl.saveVersion(copyName.trim() || 'Copy'); setCopyName(''); close(); }}>Save</button></div>
          </>, 'pop')}
        </span>
        <span className="menu-wrap">
          <span className="split">
            <button className="btn accent round main" onClick={() => ctl.exportAs(lastFormat)} disabled={!!exporting} aria-live="polite">{busyLabel || FORMAT_LABEL[lastFormat] || 'Download'}</button>
            <button className="btn accent round caret" onClick={() => setMenu(menu === 'dl' ? null : 'dl')} disabled={!!exporting} aria-label="Other formats">▾</button>
          </span>
          {pop('dl', <>
            <button role="menuitem" onClick={() => { close(); ctl.exportAs('jpg'); }}><b>Image for social</b><span className="hintsm">JPG · posts, WhatsApp, email</span></button>
            <button role="menuitem" onClick={() => { close(); ctl.exportAs('pdf'); }}><b>Print file</b><span className="hintsm">PDF · press-ready vectors</span></button>
            <button role="menuitem" onClick={() => { close(); ctl.exportAs('ai'); }}><b>Editable file for your designer</b><span className="hintsm">.ai · opens in Illustrator</span></button>
          </>)}
        </span>
        <span className="menu-wrap">
          <button className="tb" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="More" title="More">⋯</button>
          {pop('more', <>
            {hasCheck && <button role="menuitem" onClick={() => { close(); ctl.openFileCheck(); }}><b>File check</b><span className="hintsm">What this file lets you change</span></button>}
            <button role="menuitem" onClick={() => { close(); ctl.startNewLikeThis(); }}><b>Start a new one like this</b><span className="hintsm">A fresh copy on the home page</span></button>
            <button role="menuitem" onClick={() => { close(); setNewName(name); setMenu('rename'); }}><b>Rename</b></button>
            {kit && <a role="menuitem" className="menuitem" href={kit.base + 'brand-book.pdf'} target="_blank" rel="noreferrer"><b>Brand guidelines ↗</b></a>}
            {designer && <>
              <div className="sep" />
              <button role="menuitem" onClick={() => { close(); ctl.exportAs('png'); }}>Download PNG</button>
              <button role="menuitem" onClick={() => { close(); ctl.exportAs('svg'); }}>Download SVG</button>
              <button role="menuitem" onClick={() => { close(); ctl.exportSceneJson(); }}>Download scene.json</button>
              <button role="menuitem" onClick={() => { close(); ctl.toggleLayers(); }}>Toggle layers panel</button>
            </>}
          </>)}
        </span>
      </div>
    </header>
  );
}

export const LANGUAGES = ['Hindi', 'Malayalam', 'Tamil', 'Telugu', 'Kannada', 'Bengali', 'Gujarati', 'Marathi', 'Punjabi', 'Odia', 'Assamese', 'English'];

function LanguageMenu({ variants, language, progress = {}, ctl, close }) {
  const [picked, setPicked] = useState([]);
  const have = new Set(variants.map((v) => v.language)); const inFlight = Object.entries(progress);
  const busy = inFlight.some(([, s]) => s === 'pending' || s === 'working');
  const go = () => { ctl.makeLanguages(picked); setPicked([]); };
  return (
    <div className="langmenu">
      <div className="field-label">Languages</div>
      {language && <div className="hintsm">This is the {language} version.</div>}
      {inFlight.length > 0 && <ul className="lang-progress">{inFlight.map(([l, s]) => <li key={l} className={s}><span className="mark">{s === 'done' ? '✓' : s === 'error' ? '!' : s === 'working' ? <i className="spin" /> : '·'}</span><span>{l}</span>{s === 'working' && <span className="hintsm">translating…</span>}{s === 'error' && <button className="linkbtn" onClick={() => ctl.makeLanguages([l])}>Try again</button>}</li>)}</ul>}
      {variants.length > 0 && <ul className="variants">{variants.map((v) => <li key={v.id}><span className="thumb-sm">{v.thumb ? <img src={v.thumb} alt="" /> : null}</span><span className="v-name">{v.language}</span><button className="linkbtn" onClick={() => { close(); ctl.openVariant(v); }}>Open</button></li>)}</ul>}
      <div className="field-label">Make this creative in</div>
      <div className="langgrid">{LANGUAGES.filter((l) => !have.has(l) && l !== language && !progress[l]).map((l) => <label key={l} className="check"><input type="checkbox" checked={picked.includes(l)} onChange={(e) => setPicked(e.target.checked ? [...picked, l] : picked.filter((x) => x !== l))} /> {l}</label>)}</div>
      <p className="hintsm">Each language becomes its own creative with the right font, translated by the assistant, about 10 s each. You can close this and carry on; they appear here as they finish. Read every line before you use it.</p>
      <div className="row-btns"><button className="btn accent small" disabled={!picked.length} onClick={go}>{`Make ${picked.length || ''} version${picked.length === 1 ? '' : 's'}`}</button>{busy && <span className="hintsm">working…</span>}</div>
    </div>
  );
}
