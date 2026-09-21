import React, { useEffect, useState } from 'react';
import { FONT_CHOICES } from '../lib/palette.js';

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="btn icon ghost" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function FontReplaceSheet({ family, onClose, onPick, suggest, onUpload }) {
  const [to, setTo] = useState(suggest && suggest !== family ? suggest : 'Inter');
  return (
    <Modal title={`Replace font “${family}”`} onClose={onClose}>
      {onUpload && <div className="upload-font"><b>Have the font file?</b> Ask your designer for the {family} file (.ttf or .otf) and add it here. It is stored for every creative from then on.<label className="btn small">Upload {family}<input type="file" accept=".ttf,.otf,.ttc,font/ttf,font/otf" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onUpload(f); }} /></label></div>}
      <p className="hint">Or switch every piece of text in {family} to a font you have. You can undo it in one step.</p>
      <div className="font-list">{[...new Set([suggest, ...FONT_CHOICES])].filter((f) => f && f !== family).map((f) => <button key={f} className={'font-opt' + (to === f ? ' on' : '')} style={{ fontFamily: `"${f}", sans-serif` }} onClick={() => setTo(f)}>{f}</button>)}</div>
      <div className="modal-foot"><div className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn accent" onClick={() => onPick(to)}>Replace with {to}</button></div>
    </Modal>
  );
}

/** The words read from the original render for a legacy-font line: shown in a Unicode face for checking before they replace the line. */
export function ReadWordsSheet({ el, script, status, text, confidence, notes, error, font, onClose, onApply, onRetry }) {
  const [value, setValue] = useState(text || '');
  useEffect(() => { setValue(text || ''); }, [text]);
  return (
    <Modal title={`Read the words · ${el.name}`} onClose={onClose}>
      {status === 'reading' && <p className="hint">Reading the {script} text from the original design…</p>}
      {status === 'error' && <><p className="hint">Could not read it: {error}</p><div className="modal-foot"><span className="spacer" /><button className="btn" onClick={onRetry}>Try again</button></div></>}
      {status === 'done' && (
        <>
          <p className="hint">This is what the assistant read from the original. Check it against the creative, fix anything it got wrong, then keep it. {confidence !== 'high' ? `The assistant was ${confidence === 'low' ? 'not very' : 'fairly'} sure.` : ''}{notes ? ` ${notes}` : ''}</p>
          <textarea className="words" value={value} rows={4} onChange={(e) => setValue(e.target.value)} style={{ fontFamily: font ? `"${font}", sans-serif` : undefined, fontSize: 20, lineHeight: 1.5, width: '100%' }} />
          <p className="hintsm">Once kept, the line becomes normal {script} text: it can be edited, translated and set in {font || 'a Unicode font'}. The original legacy font is no longer used for it. You can undo this.</p>
          <div className="modal-foot"><span className="spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn accent" disabled={!value.trim()} onClick={() => onApply(value.trim())}>Keep these words</button></div>
        </>
      )}
    </Modal>
  );
}

/** One-time name prompt so the record says who changed what. */
export function NameSheet({ value, onSave, onClose }) {
  const [n, setN] = useState(value || '');
  return (
    <Modal title="Who is editing?" onClose={onClose}>
      <p className="hint">So the record shows who changed what. It is kept on this computer only.</p>
      <input autoFocus value={n} placeholder="Your name" onChange={(e) => setN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && n.trim()) onSave(n.trim()); }} style={{ width: '100%', height: 38, padding: '0 10px' }} />
      <div className="modal-foot"><span className="spacer" /><button className="btn" onClick={onClose}>Not now</button><button className="btn accent" disabled={!n.trim()} onClick={() => onSave(n.trim())}>Save</button></div>
    </Modal>
  );
}
