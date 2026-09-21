import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFontName } from '../shared/fontname.js';

test('PostScript names become human family + style', () => {
  const cases = [
    ['SourceSans3-Bold', 'Source Sans 3', 'Bold'],
    ['SourceSans3-Regular', 'Source Sans 3', 'Regular'],
    ['SourceSerif4Italic', 'Source Serif 4', 'Italic'],
    ['SourceSerif4-BoldIt', 'Source Serif 4', 'Bold Italic'],
    ['SourceSansPro-Regular', 'Source Sans 3', 'Regular'],
    ['SourceSansVariable-Roman', 'Source Sans 3', 'Regular'],
    ['MyriadPro-Regular', 'Myriad Pro', 'Regular'],
    ['Arial-BoldItalicMT', 'Arial', 'Bold Italic'],
    ['ArialMT', 'Arial', 'Regular'],
    ['HelveticaNeueLTStd-Bd', 'Helvetica Neue', 'Bold'],
    ['HelveticaNeue-Light', 'Helvetica Neue', 'Light'],
    ['Helvetica-Bold', 'Helvetica', 'Bold'],
    ['TimesNewRomanPS-BoldMT', 'Times New Roman', 'Bold'],
    ['Gotham-Book', 'Gotham', 'Regular'],
    ['Montserrat-SemiBold', 'Montserrat', 'SemiBold'],
    ['Merriweather-BoldItalic', 'Merriweather', 'Bold Italic'],
    ['Lato-Black', 'Lato', 'Black'],
    ['ABCDEF+Poppins-Medium', 'Poppins', 'Medium'],
    ['DMSans-Regular', 'DM Sans', 'Regular'],
  ];
  for (const [ps, family, style] of cases) assert.deepEqual(parseFontName(ps), { family, style }, ps);
});

test('font flags fill in a style the name does not carry', () => {
  assert.deepEqual(parseFontName('Gotham', { bold: true, italic: true }), { family: 'Gotham', style: 'Bold Italic' });
  assert.deepEqual(parseFontName('', {}), { family: 'Helvetica', style: 'Regular' });
});
