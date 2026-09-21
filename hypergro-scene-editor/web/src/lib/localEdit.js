// Offline fallback: parse a plain-English request into the same tool calls Claude would make.
const COLORS = { red: '#C8102E', blue: '#0B4EA2', green: '#1A7F4B', black: '#1C1B19', white: '#FFFFFF', orange: '#E8541E', navy: '#0A2A5C', yellow: '#FFD166', grey: '#6B6A66', gray: '#6B6A66', purple: '#5B2A86', pink: '#E0489B' };
const ROLE_WORDS = { headline: 'headline', title: 'headline', subhead: 'subhead', subtitle: 'subhead', cta: 'cta', button: 'cta', logo: 'logo', offer: 'offer', price: 'offer', disclaimer: 'disclaimer', 'fine print': 'disclaimer', background: 'background', product: 'product', image: 'product', photo: 'product' };

/** @returns {{scene: object|null, reply: string}} */
export function localEdit(S, scene, text, selId) {
  const t = text.toLowerCase();
  const role = Object.keys(ROLE_WORDS).find((w) => t.includes(w));
  const target = role ? ROLE_WORDS[role] : selId || 'headline';
  const el = S.resolve(scene, target)[0];
  if (!el) return { scene: null, reply: `Offline mode: I could not find "${target}". Select an element or name one (headline, CTA, logo, offer, disclaimer).` };
  const call = (name, args) => { const out = S.runTool(scene, name, args); return { scene: out.scene, reply: out.result + ' (offline mode)' }; };
  if (/\bhide\b|remove/.test(t)) return call('set_visibility', { target: el.id, visible: false });
  if (/\bshow\b|unhide/.test(t)) return call('set_visibility', { target: el.id, visible: true });
  if (el.text && /bigger|larger|increase/.test(t)) return call('set_text', { target: el.id, fontSize: Math.round(el.text.fontSize * 1.2) });
  if (el.text && /smaller|reduce|shrink/.test(t)) return call('set_text', { target: el.id, fontSize: Math.round(el.text.fontSize / 1.2) });
  if (el.text && /\b(center|centre|left|right)[- ]?align|align (it |the \w+ )?(center|centre|left|right)/.test(t)) return call('set_text', { target: el.id, align: /center|centre/.test(t) ? 'center' : /right/.test(t) ? 'right' : 'left' });
  const hexc = t.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/); const named = Object.keys(COLORS).find((k) => new RegExp('\\b' + k + '\\b').test(t));
  if (hexc || named) return call('set_fill', { target, color: hexc ? hexc[0].toUpperCase() : COLORS[named] });
  const q = text.match(/["“](.+?)["”]/); if (q && el.text) return call('set_text', { target: el.id, content: q[1] });
  const pos = t.match(/\b(top|bottom)[- ]?(left|right|center|centre)?\b|\b(left|right)\b/);
  if (/move|put|place/.test(t) && pos) {
    const W = scene.document.width, H = scene.document.height, b = el.bounds, m = 40;
    const x = /left/.test(pos[0]) ? m : /right/.test(pos[0]) ? W - b.width - m : /center|centre/.test(pos[0]) ? (W - b.width) / 2 : b.x;
    const y = /top/.test(pos[0]) ? m : /bottom/.test(pos[0]) ? H - b.height - m : b.y;
    return call('move_element', { target: el.id, x, y });
  }
  return { scene: null, reply: 'Offline mode (no Anthropic key on the server). I understand: "make the CTA blue", "headline bigger", "hide the disclaimer", "move the logo to the top right", "center the headline", or new copy in quotes.' };
}
