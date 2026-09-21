import React, { useState } from 'react';

const ago = (t) => { const d = Date.now() - t; if (!t || d < 0) return ''; const m = Math.round(d / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const STEPS = [['upload', 'Uploading'], ['extract', 'Reading the file'], ['classify', 'Understanding the layout'], ['understand', 'Checking fonts and logos'], ['store', 'Saving the images'], ['done', 'Opening']];
const GRADE = { partly: ['Partly editable', 'warn'], limited: ['Limited', 'bad'] };

function Card({ a, ctl, big }) {
  const [menu, setMenu] = useState(false); const [renaming, setRenaming] = useState(false); const [name, setName] = useState(a.name);
  const g = a.readiness ? GRADE[a.readiness.grade] : null;
  return (
    <div className={'tile card' + (big ? ' big' : '')}>
      <button className="card-main" onClick={() => ctl.openArtwork(a)}>
        <span className="thumb">{a.thumb ? <img src={a.thumb + '?t=' + Math.round(a.updatedAt / 1000)} alt="" /> : <span className="thumb-empty">{Math.round(a.width)}×{Math.round(a.height)}</span>}</span>
        {!renaming && <span className="card-name">{a.name}</span>}
        <span className="card-sub">{a.autosave ? 'Edited ' : 'Uploaded '}{ago(a.updatedAt)}{a.versions ? ` · ${a.versions} ${a.versions === 1 ? 'copy' : 'copies'}` : ''}</span>
        {g && <span className={'badge ' + g[1]}>{g[0]}</span>}
      </button>
      {renaming && <div className="card-rename" onClick={(e) => e.stopPropagation()}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { ctl.renameArtwork(a, name); setRenaming(false); } if (e.key === 'Escape') setRenaming(false); }} /><button className="btn small accent" onClick={() => { ctl.renameArtwork(a, name); setRenaming(false); }}>Save</button></div>}
      {a.variants?.length > 0 && <div className="card-langs">{a.variants.map((v) => <button key={v.id} className="chip" onClick={() => ctl.openVariant(v)}>{v.language}</button>)}</div>}
      <div className="card-menu menu-wrap">
        <button className="tb" aria-label="More" onClick={() => setMenu(!menu)}>⋯</button>
        {menu && <><div className="menu-backdrop" onMouseDown={() => setMenu(false)} /><div className="menu">
          <button role="menuitem" onClick={() => { setMenu(false); setName(a.name); setRenaming(true); }}><b>Rename</b></button>
          <button role="menuitem" onClick={() => { setMenu(false); ctl.duplicateArtwork(a); }}><b>Start a new one like this</b><span className="hintsm">A fresh copy, same layout</span></button>
          <button role="menuitem" onClick={() => { setMenu(false); ctl.archiveArtwork(a); }}><b>Remove from this list</b><span className="hintsm">Kept on the server, hidden here</span></button>
          {a.replaces?.length > 0 && <div className="menu-note hintsm">Replaced {a.replaces.length === 1 ? 'an earlier upload' : `${a.replaces.length} earlier uploads`} of the same file</div>}
        </div></>}
      </div>
    </div>
  );
}

function UploadTile({ job, ctl }) {
  const idx = job ? Math.max(0, STEPS.findIndex(([k]) => k === job.step)) : -1;
  const secs = job?.startedAt ? Math.round((Date.now() - job.startedAt) / 1000) : 0;
  return (
    <label className={'tile upload' + (job ? ' busy' : '')}>
      <input type="file" accept=".ai,.pdf,application/pdf,application/illustrator" onChange={ctl.pickAi} disabled={!!job} />
      {!job ? (<><span className="tile-plus">+</span><span className="tile-title">Upload Illustrator file</span><span className="tile-sub">.ai from your designer · uploading the same file again replaces the earlier one</span></>) : (
        <>
          <span className="tile-title">Preparing your creative</span>
          <ol className="steps">{STEPS.slice(1).map(([k, label], i) => <li key={k} className={i + 1 < idx ? 'done' : i + 1 === idx ? 'now' : ''}>{label}</li>)}</ol>
          <span className="tile-sub">{secs >= 10 ? `${secs} s · ` : ''}You can keep browsing, it will open when it’s ready.</span>
        </>
      )}
    </label>
  );
}

export default function Home({ kit, artworks, job, samples, fonts = [], ctl }) {
  const [q, setQ] = useState('');
  const [, tick] = useState(0); React.useEffect(() => { if (!job) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [job]);
  const filtered = q.trim() ? artworks.filter((a) => (a.name + ' ' + (a.variants || []).map((v) => v.language).join(' ')).toLowerCase().includes(q.trim().toLowerCase())) : artworks;
  const recent = q.trim() ? [] : artworks.slice(0, 4); const rest = q.trim() ? filtered : artworks.slice(4);
  return (
    <div className="home">
      <div className="home-inner">
        <h1 className="home-title">My creatives</h1>
        <p className="home-sub">Upload an Illustrator file and change the words, prices, images, colours or language yourself, without going back to design. Everything you change is saved automatically.</p>
        <div className="grid recent">
          <UploadTile job={job} ctl={ctl} />
          {recent.map((a) => <Card key={a.id} a={a} ctl={ctl} big />)}
          {!artworks.length && (
            <>
              <button className="tile card demo" onClick={ctl.openDemo}><span className="thumb demo-thumb"><span>Sample</span></span><span className="card-name">Try it on a sample</span><span className="card-sub">A Federal Bank ad you can play with</span></button>
              {samples.length > 0 && <button className="tile card demo" onClick={() => ctl.ingestSample(samples[0])} disabled={!!job}><span className="thumb demo-thumb alt"><span>.ai</span></span><span className="card-name">Sample Illustrator file</span><span className="card-sub">Runs a real .ai through the upload flow</span></button>}
            </>
          )}
        </div>
        {(rest.length > 0 || q) && (
          <>
            <div className="home-tools"><span className="section-title">All creatives</span><input className="search" value={q} placeholder="Search creatives" onChange={(e) => setQ(e.target.value)} aria-label="Search creatives" />{q && <button className="linkbtn" onClick={() => setQ('')}>clear</button>}<span className="hintsm">{q ? `${filtered.length} of ${artworks.length}` : `${rest.length} more`}</span></div>
            <div className="grid">{rest.map((a) => <Card key={a.id} a={a} ctl={ctl} />)}{q && !filtered.length && <p className="hint">Nothing matches “{q}”.</p>}</div>
          </>
        )}
        <section className="fontlib">
          <div className="fontlib-head"><span className="fontlib-title">Fonts on file</span><span className="hintsm">{fonts.length ? `${fonts.length} font${fonts.length > 1 ? 's' : ''} · used on screen and in every download` : 'None yet'}</span><span className="spacer" /><label className="btn small">Add a font file<input type="file" accept=".ttf,.otf,.ttc,font/ttf,font/otf" multiple onChange={async (e) => { const files = [...e.target.files]; e.target.value = ''; for (const f of files) await ctl.uploadFont(f); }} /></label></div>
          {fonts.length > 0 && <ul className="fontlist">{fonts.map((f) => <li key={f.file}><span className="font-sample" style={{ fontFamily: `"${f.family}"`, fontWeight: f.weight || 400, fontStyle: f.italic ? 'italic' : 'normal' }}>Aa</span><span className="font-name">{f.family}{f.style && f.style !== 'Regular' ? ` · ${f.style}` : ''}</span><span className="hintsm">{f.subset ? 'partial · from an uploaded file' : f.legacy ? `legacy ${f.legacyScript || 'Indic'} font` : f.scripts?.filter((s) => s !== 'latin').length ? f.scripts.filter((s) => s !== 'latin').join(', ') : 'Latin'}</span></li>)}</ul>}
          <p className="hintsm">Fonts your designers use in the .ai files. “Partial” fonts were pulled out of an uploaded file: the words already in the creative render exactly, but letters that were not in the file may fall back until the full font is added.</p>
        </section>
        {kit && <p className="home-foot">On-brand by default: {kit.name} colours, {kit.fonts.headline.family} headlines and {kit.fonts.body.family} copy.</p>}
      </div>
    </div>
  );
}
