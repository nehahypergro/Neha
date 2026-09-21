import React, { useMemo, useState } from 'react';
import { Modal } from './Sheets.jsx';

const GRADE = { ready: ['Ready to edit', 'ok'], partly: ['Partly editable', 'warn'], limited: ['Limited', 'bad'] };

/** What an upload lets a marketer edit, in plain words, and a ready-made request for the designer when it falls short. */
export default function FileCheck({ readiness, name, onClose, onStart }) {
  const [copied, setCopied] = useState(false); const [askOpen, setAskOpen] = useState(false);
  const [title, cls] = GRADE[readiness?.grade] || GRADE.limited;
  const items = readiness?.items || []; const problems = items.filter((i) => !i.ok); const fine = items.filter((i) => i.ok);
  const shown = [...problems, ...fine].slice(0, 3); const rest = items.length - shown.length;
  const request = useMemo(() => {
    const lines = [`Hi,`, ``, `Could you send a version of “${name}” that we can edit ourselves? When we open it in the creative editor:`, ...problems.map((p) => `• ${p.text}`), ``, `What we need in the Illustrator file:`,
      `• Save with “Create PDF Compatible File” ticked`, `• Keep all text as live text (please don’t outline it)`, `• Keep the logo, the button, its label and the small print as separate objects, not merged into the photo`,
      ...(readiness?.fontsNotOnFile?.length ? [`• Send the font files (.ttf or .otf) for: ${readiness.fontsNotOnFile.join(', ')}`] : []),
      ...(readiness?.legacy ? [`• If the regional-language lines are typed in a legacy font, please retype them in a Unicode font`] : []), ``, `Thanks!`];
    return lines.join('\n');
  }, [name, problems, readiness]);
  const copy = async () => { try { await navigator.clipboard.writeText(request); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  const mailto = `mailto:?subject=${encodeURIComponent(`Editable file for “${name}”`)}&body=${encodeURIComponent(request)}`;
  return (
    <Modal title="File check" onClose={onClose}>
      <div className={'grade ' + cls}><b>{title}</b><span>{readiness?.grade === 'ready' ? 'Everything in this file can be changed here.' : readiness?.grade === 'partly' ? 'Most of it can be changed here; a few things need the designer.' : 'Only some of this file can be changed here.'}</span></div>
      <ul className="check-list">{shown.map((i, k) => <li key={k} className={i.ok ? 'ok' : 'bad'}><span className="mark">{i.ok ? '✓' : '!'}</span>{i.text}</li>)}</ul>
      {rest > 0 && <p className="hintsm">and {rest} more thing{rest > 1 ? 's are' : ' is'} fine.</p>}
      {problems.length > 0 && !askOpen && <button className="btn small" onClick={() => setAskOpen(true)}>Ask the designer for a ready file</button>}
      {askOpen && (
        <div className="ask-designer">
          <div className="field-label">Ask the designer</div>
          <p className="hintsm">This note lists exactly what to change. Copy it into WhatsApp, or open it in email.</p>
          <textarea readOnly value={request} rows={8} />
          <div className="row-btns"><button className="btn small" onClick={copy}>{copied ? 'Copied ✓' : 'Copy the note'}</button><a className="btn small" href={mailto}>Open in email</a></div>
        </div>
      )}
      <div className="modal-foot"><span className="spacer" /><button className="btn accent" onClick={onStart}>Start editing</button></div>
    </Modal>
  );
}
