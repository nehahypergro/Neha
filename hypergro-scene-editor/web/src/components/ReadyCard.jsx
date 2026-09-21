import React from 'react';

// Turns the checker's findings into plain sentences with one-click fixes. Informational notes stay out of the way.
function friendly(i) {
  const [kind] = i.id.split(':'); const name = i.title.match(/“([^”]+)”/)?.[1];
  switch (kind) {
    case 'overflow': return { text: `“${name}” doesn’t fit its space.`, fix: 'Shrink to fit' };
    case 'logo': return { text: 'The logo is very small.', fix: 'Select it' };
    case 'logosurface': return { text: i.title, fix: 'Use the right version' };
    case 'asset': return { text: `An image is missing for “${name}”.`, fix: 'Select it' };
    case 'font': return { text: `${i.title.replace(/^Font /, '').replace(/ isn’t available.*$/, '')} isn’t installed here, so text may look different.`, fix: i.action?.label || 'Replace font' };
    case 'brandcolor': return { text: `“${name}” isn’t a Federal Bank colour.`, fix: i.action?.label || 'Use a brand colour' };
    case 'brandfont': return { text: `“${name}” isn’t in a brand font.`, fix: i.action?.label || 'Use the brand font' };
    default: return null;
  }
}
export const friendlyIssues = (issues) => issues.map((i) => ({ i, f: friendly(i) })).filter((r) => r.f);

export default function ReadyCard({ issues, scene, ctl }) {
  if (!scene) return null;
  const rows = friendlyIssues(issues);
  if (!rows.length) return <section className="ready ok"><div className="ready-title">✓ Ready to publish</div><div className="ready-sub">Everything fits and it’s on brand.</div></section>;
  const shown = rows.slice(0, 3);
  return (
    <section className="ready">
      <div className="ready-title">Ready to publish? {rows.length} thing{rows.length > 1 ? 's' : ''} to look at</div>
      <ul>
        {shown.map(({ i, f }) => (
          <li key={i.id}>
            <span className="ready-text">{f.text}</span>
            {i.action && <button className="btn small" onClick={() => ctl.runIssueAction(i)}>{f.fix}</button>}
            {i.elementId && i.action?.type !== 'select' && <button className="linkbtn" onClick={() => ctl.select(i.elementId)}>Show me</button>}
          </li>
        ))}
      </ul>
      {rows.length > 3 && <div className="hintsm">and {rows.length - 3} more once these are done</div>}
    </section>
  );
}
