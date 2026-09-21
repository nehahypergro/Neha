import React from 'react';

const ROLE_COLORS = { background: '#5f5e5a', logo: '#0b4ea2', headline: '#1c1b19', subhead: '#3d3c39', offer: '#8a4b00', cta: '#e8541e', product: '#1a7f4b', disclaimer: '#5f5e5a', body: '#3d3c39', image: '#1a7f4b', shape: '#5f5e5a', decoration: '#5f5e5a' };

export default function Layers({ scene, sel, ctl }) {
  if (!scene) return <div className="panel-empty">Open a creative to see its layers.</div>;
  const leaves = scene.elements.filter((e) => e.type !== 'group').sort((a, b) => b.zIndex - a.zIndex);
  return (
    <div className="layers">
      {leaves.map((e) => (
        <div key={e.id} className={'layer' + (sel.includes(e.id) ? ' on' : '')} style={{ opacity: e.visible ? 1 : .45 }} onClick={(ev) => ctl.select(e.id, { add: ev.shiftKey })}>
          <span className="glyph">{e.type === 'text' ? 'T' : e.type === 'image' ? '▣' : '◆'}</span>
          <span className="lname">{e.locked ? '🔒 ' : ''}{e.name}</span>
          <span className="role" style={{ color: ROLE_COLORS[e.role] || '#5f5e5a' }}>{e.role || ''}</span>
          <button className="eye" aria-label={e.visible ? 'Hide' : 'Show'} onClick={(ev) => { ev.stopPropagation(); ctl.set(e.id, { visible: !e.visible }, `${e.visible ? 'Hid' : 'Showed'} ${e.name}`); }}>{e.visible ? '●' : '○'}</button>
        </div>
      ))}
    </div>
  );
}
