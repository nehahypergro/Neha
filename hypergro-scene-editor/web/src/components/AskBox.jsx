import React, { useEffect, useRef } from 'react';

export default function AskBox({ exchanges, busy, draft, setDraft, examples, undoLen, online, ctl }) {
  const listRef = useRef();
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 1e9; }, [exchanges, busy]);
  const send = (t) => { if (t.trim() && !busy && online) ctl.runChat(t.trim()); };
  const recent = exchanges.slice(-3);
  return (
    <section className="ask">
      <div className="ask-title">✦ Ask for a change</div>
      {!online && <div className="ask-offline">The assistant is off right now. You can still change anything by clicking it on the creative.</div>}
      <div className="ask-row">
        <input value={draft} placeholder="e.g. Change the offer to 10% and make the button blue" aria-label="Ask for a change" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(draft); }} disabled={busy || !online} />
        <button className="btn accent" onClick={() => send(draft)} disabled={busy || !online || !draft.trim()}>{busy ? '…' : 'Go'}</button>
      </div>
      <div className="examples">{examples.map((x) => <button key={x} className="chip" onClick={() => send(x)} disabled={busy || !online}>{x}</button>)}</div>
      {(recent.length > 0 || busy) && (
        <div ref={listRef} className="replies">
          {recent.map((x, i) => (
            <div key={x.at || i} className="reply">
              <div className="reply-q">“{x.q}”</div>
              {x.status === 'busy' ? (
                <div className="reply-a working">
                  <span>Working on it · usually 10 to 20 s</span>
                  <span className="progress2" aria-hidden="true"><i className="on" /><i /></span>
                  <span className="hintsm">Sent · waiting for the reply</span>
                </div>
              ) : (
                <div className="reply-a">
                  {x.a}
                  {x.changed?.length > 0 && <span className="reply-items"> Changed: {x.changed.join(', ')}.</span>}
                  {x.undoDepth != null && (x.undoDepth === undoLen ? <button className="linkbtn" onClick={ctl.undo}>Undo</button> : <span className="hintsm"> {x.undoDepth > undoLen ? 'undone' : ''}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
