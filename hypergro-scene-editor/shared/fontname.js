// PostScript font names → { family, style }. Illustrator writes names like "SourceSans3-Bold", "HelveticaNeueLTStd-Bd",
// "Arial-BoldItalicMT" or "SourceSerif4Italic"; the family we derive is what the browser, Google Fonts and the font
// library are asked for, so it has to be the human name ("Source Sans 3", "Helvetica Neue", "Arial").
const WEIGHTS = [
  [/^(extrablack|ultrablack)$/i, 'Black'], [/^(black|blk|heavy|hv)$/i, 'Black'],
  [/^(extrabold|xbold|ultrabold|ultra|xb|eb)$/i, 'ExtraBold'], [/^(semibold|demibold|demi|sb|sbd|medbold)$/i, 'SemiBold'],
  [/^(bold|bd|b)$/i, 'Bold'], [/^(medium|md|med)$/i, 'Medium'], [/^(light|lt|l)$/i, 'Light'],
  [/^(extralight|ultralight|xlight|el|xl)$/i, 'ExtraLight'], [/^(thin|hairline|th)$/i, 'Thin'],
];
const ITALIC = /^(italic|it|ital|oblique|obl|slanted|i)$/i;
const REGULAR = /^(regular|roman|book|normal|plain|rg|reg|r|text|std|w\d+)$/i;
const NOISE = /^(mt|ps|lt|std|pro|otf|ttf|web|display|text|caption|subhead|variable|var|vf|ttc)$/i; // dropped from the family only when trailing
const ALIASES = {
  'Source Sans': 'Source Sans 3', 'Source Sans Pro': 'Source Sans 3', 'Source Sans Variable': 'Source Sans 3', 'Source Sans3': 'Source Sans 3',
  'Source Serif': 'Source Serif 4', 'Source Serif Pro': 'Source Serif 4', 'Source Serif Variable': 'Source Serif 4', 'Source Serif4': 'Source Serif 4',
  'Source Code': 'Source Code Pro', 'Helvetica Neue LT': 'Helvetica Neue', 'Helvetica Neue LT Std': 'Helvetica Neue', 'Helvetica LT': 'Helvetica',
  'Times New Roman PS': 'Times New Roman', 'Times': 'Times New Roman', 'Arial Narrow': 'Arial Narrow', 'Courier New PS': 'Courier New', 'Myriad': 'Myriad Pro',
};

// Compound style words stay whole ("SemiBold", "ExtraLight", "BoldItalic" → Bold + Italic is fine to split; "Semi Bold" is not).
const camel = (s) => s.replace(/(Semi|Demi|Extra|Ultra|X)(Bold|Light|Black|Condensed)/g, '$1$2\u0001').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([0-9])([A-Za-z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/(Semi|Demi|Extra|Ultra|X) (Bold|Light|Black|Condensed)\u0001/g, '$1$2').replace(/\u0001/g, '');
const tokens = (s) => camel(s).split(/[\s_]+/).filter(Boolean);

/** Style words out of a list of tokens; returns { weight, italic, rest } where rest are tokens that were not style words. */
function readStyle(list) {
  let weight = null, italic = false; const rest = [];
  for (const t of list) {
    if (ITALIC.test(t)) { italic = true; continue; }
    if (REGULAR.test(t)) continue;
    const w = WEIGHTS.find(([re]) => re.test(t)); if (w) { weight = weight || w[1]; continue; }
    if (/^(condensed|cond|cn|narrow|compressed|extended|ext|wide)$/i.test(t)) continue; // width variants are not styles we can render; drop
    rest.push(t);
  }
  return { weight, italic, rest };
}

export function parseFontName(postScriptName, flags = {}) {
  let ps = String(postScriptName || '').replace(/^[A-Z]{6}\+/, '').trim();
  if (!ps) return { family: 'Helvetica', style: 'Regular' };
  const [base, ...suffix] = ps.split(/[-,]/);
  // Family: camel-case split; style words and foundry noise are only stripped from the END of the base
  // ("SourceSerif4Italic" → Source Serif 4 + Italic) so names like "Times New Roman" keep their words.
  const fam = tokens(base); const b = { weight: null, italic: false };
  const trailing = (t) => ITALIC.test(t) || NOISE.test(t) || /^(regular|book|normal|plain)$/i.test(t) || /^(condensed|cond|cn|narrow|compressed|extended|ext|wide)$/i.test(t) || WEIGHTS.some(([re]) => re.test(t));
  while (fam.length > 1 && trailing(fam[fam.length - 1])) { const t = fam.pop(); if (ITALIC.test(t)) b.italic = true; const w = WEIGHTS.find(([re]) => re.test(t)); if (w) b.weight = b.weight || w[1]; }
  let family = fam.join(' ').replace(/\s+/g, ' ').trim() || base;
  family = ALIASES[family] || family;
  const s = readStyle(suffix.flatMap(tokens));
  const weight = s.weight || b.weight || (flags.bold ? 'Bold' : null);
  const italic = s.italic || b.italic || !!flags.italic;
  const style = [weight, italic ? 'Italic' : null].filter(Boolean).join(' ') || 'Regular';
  return { family, style };
}
