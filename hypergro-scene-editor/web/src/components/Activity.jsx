import React, { useState } from 'react';

const ago = (t) => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); return h < 24 ? `${h} h ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const lower = (label) => (label ? label.charAt(0).toLowerCase() + label.slice(1) : 'made a change');
const sentence = (label, by) => (!label ? 'A change' : /^Assistant/.test(label) ? label : `${by || 'You'} ${lower(label)}`);

/** Who did what, when: this session's changes (undoable) and the full record kept with the creative. */
export default function Activity({ undo, redo, past = [], versions, user, onUser, forceOpen = false, ctl }) {
  const [openState, setOpen] = useState(false); const open = forceOpen || openState; const [editName, setEditName] = useState(false); const [draft, setDraft] = useState(user || '');
  const recent = undo.slice(-8).reverse(); const earlier = [...past].reverse().slice(0, 40);
  return (
    <section className="activity">
      <button className="activity-head" onClick={() => setOpen(!open)} aria-expanded={open} disabled={forceOpen}>
        <span>{forceOpen ? 'Activity' : open ? '▾ Activity' : '▸ Activity'}</span><span className="hintsm">{undo.length + past.length ? `${undo.length + past.length} change${undo.length + past.length > 1 ? 's' : ''}` : 'no changes yet'}{versions.length ? ` · ${versions.length} ${versions.length === 1 ? 'copy' : 'copies'}` : ''}</span>
      </button>
      {open && (
        <div className="activity-body">
          {user && !editName ? <div className="who">Recording as <b>{user}</b> · <button className="linkbtn" onClick={() => { setDraft(user); setEditName(true); }}>change</button></div>
            : <label className="who">So the record shows who changed it: <input autoFocus={editName} value={draft} placeholder="your name" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onUser(draft.trim()); setEditName(false); } }} /><button className="btn small" disabled={!draft.trim()} onClick={() => { onUser(draft.trim()); setEditName(false); }}>Save</button></label>}
          <div className="row-btns"><button className="btn small" onClick={ctl.undo} disabled={!undo.length}>Undo last</button><button className="btn small" onClick={ctl.redo} disabled={!redo.length}>Redo</button></div>
          <ul className="act-list">
            {recent.map((h, i) => <li key={i}><span>{sentence(h.label, 'You')}</span><span className="hintsm">{ago(h.at)}</span></li>)}
            {!recent.length && <li className="hintsm">{earlier.length ? 'No changes yet this time.' : 'Changes you make will be listed here.'}</li>}
          </ul>
          {earlier.length > 0 && <><div className="field-label">Record <span className="hintsm">kept with the creative</span></div><ul className="act-list">{earlier.map((h, i) => <li key={'p' + i}><span>{sentence(h.label, h.by && h.by !== user ? h.by : h.by ? 'You' : 'Someone')}</span><span className="hintsm">{ago(h.at)}</span></li>)}</ul></>}
          {versions.length > 0 && (
            <>
              <div className="field-label">Copies</div>
              <ul className="copies">
                {versions.map((v) => (
                  <li key={v.vid}>
                    <div className="v-head"><span className="v-name">{v.name}</span><span className="hintsm">{v.by ? `${v.by} · ` : ''}{ago(v.createdAt)}</span></div>
                    <div className="v-actions"><button className="linkbtn" onClick={() => ctl.restoreVersion(v)}>Open this copy</button></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
