// node --test "src/components/overview/charts/chartsKit.test.ts"
// Source-text pins for the chart kit of the Overview pages (components/overview/charts): it holds to the design-system kit's rules (no platform-remapped utility,
// no text under 12px, no bare <p>/<td>/<th>/<h2>/<h3>), it knows no module and asks for nothing itself, every chart has a text alternative (a Picture's table or a
// real list), and no chart draws a number the table does not (a recharts chart always sits in a Picture). The colours are the palette's, in one file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { findViolations } from '../../ui/ds/kitRules.ts';
import { SERIES } from './palette.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const SOURCES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((file) => ({ file, text: readFileSync(`${DIR}${file}`, 'utf8') }));
const TSX = SOURCES.filter((s) => s.file.endsWith('.tsx'));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');

test('the folder is what the pins read', () => {
  assert.deepEqual(SOURCES.map((s) => s.file).sort(), [
    'AreaTiles.tsx', 'BarList.tsx', 'ChartCard.tsx', 'ChartGrid.tsx', 'DonutChart.tsx', 'Heatmap.tsx', 'KpiTile.tsx', 'Picture.tsx', 'ScoreRing.tsx', 'SegmentBar.tsx', 'Sparkline.tsx',
    'StackedBars.tsx', 'TrendChart.tsx', 'areaModel.ts', 'chartModel.ts', 'index.ts', 'palette.ts',
  ].sort());
});

test('no platform-remapped utility, no text under 12px, no hex in a class, no legacy governance scope', () => {
  for (const { file, text } of TSX) {
    assert.doesNotMatch(code(text), /governance-light/, `${file}: the legacy scope`);
    const found = findViolations(text);
    assert.deepEqual(found, [], `${file}: ${found.map((v) => `${v.rule}@${v.line}`).join(', ')}`);
  }
});

test('no bare <p>, <td>, <th>, <h2> or <h3>: each names its text size (the platform CSS gives a bare one 11.5px)', () => {
  const SIZE = /(?<![\w:-])!?text-(?:ds-(?:title|section|body|label)|\[\d)/;
  for (const { file, text } of TSX) {
    const src = code(text);
    const tag = /<(p|td|th|h2|h3)(\s[^>]*?)?>/g;
    let m: RegExpExecArray | null;
    while ((m = tag.exec(src)) !== null) {
      const open = src.slice(m.index, m.index + 500).split('>')[0] + '>';
      assert.match(open, SIZE, `${file}:${src.slice(0, m.index).split('\n').length} <${m[1]}> has no text size: ${open.slice(0, 90)}`);
    }
  }
});

test('the kit knows no module and asks for nothing itself', () => {
  for (const { file, text } of SOURCES) {
    assert.doesNotMatch(code(text), /useQuery|useInfiniteQuery|apiClient|axios|fetch\(|\/governance|\/issues|\/vendor-risk|\/auditor-portal/, file);
  }
});

test('every recharts chart sits in a Picture (a table for a screen reader, no keyboard trap)', () => {
  for (const { file, text } of TSX) {
    const src = code(text);
    if (!/from 'recharts'/.test(src)) continue;
    if (file === 'DonutChart.tsx') {                                         // the ring is aria-hidden and its list beside it is the text
      assert.match(src, /aria-hidden="true"/);
      assert.match(src, /<ul aria-label=\{label\}/);
      assert.match(src, /chartFocusOff\(\)/);
      continue;
    }
    assert.match(src, /<Picture /, `${file}: not in a Picture`);
    assert.match(src, /\{\.\.\.focusOff\}/, `${file}: recharts' keyboard layer is not turned off`);
  }
});

test('a chart is hidden from assistive technology only where its numbers are in text', () => {
  const picture = code(SOURCES.find((s) => s.file === 'Picture.tsx')!.text);
  assert.match(picture, /aria-hidden="true"/);
  assert.match(picture, /<div className="sr-only">[\s\S]*<Table caption=\{label\}>/);
  const bars = code(SOURCES.find((s) => s.file === 'BarList.tsx')!.text);
  assert.doesNotMatch(bars.replace(/<span aria-hidden[\s\S]*?<\/span>\s*<\/span>/, ''), /aria-hidden/, 'BarList: only the track is a picture; the name and the figure are text');
});

test('states: a card says loading, failed, no access and empty apart from the chart, and a failed request is never an empty chart', () => {
  const card = code(SOURCES.find((s) => s.file === 'ChartCard.tsx')!.text);
  for (const s of ['loading', 'error', 'denied', 'empty', 'ready']) assert.match(card, new RegExp(`state === '${s}'`), s);
  assert.match(card, /<ErrorState compact/);
  assert.match(card, /role="status" aria-busy="true"/);
});

test('the colours are the palette\'s: no hex outside palette.ts, and the eight hues are the documented ones in their fixed order', () => {
  for (const { file, text } of SOURCES) {
    if (file === 'palette.ts') continue;
    const hexes = code(text).match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    // the white of a dot's ring and the ink of a heat cell are the surface and the strong ink: written where they are used
    assert.deepEqual(hexes.filter((h) => !['#ffffff', '#1f2933'].includes(h.toLowerCase())), [], `${file}: a colour that is not in the palette`);
  }
  assert.deepEqual([...SERIES], ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']);
});

test('ChartCard has an "Open" link in its title row, named for where it goes, and is not itself a link; ScoreRing and KpiTile take a link too', () => {
  const card = code(SOURCES.find((s) => s.file === 'ChartCard.tsx')!.text);
  assert.match(card, /href\?: string;/);
  assert.match(card, /hrefLabel\?: string;/);
  assert.match(card, /<Link href=\{href\} aria-label=\{openLinkName\(title, hrefLabel\)\}/);
  assert.match(card, /<section id=\{id\}/, 'the card is a section, not a link: its chart parts are links of their own');
  const ring = code(SOURCES.find((s) => s.file === 'ScoreRing.tsx')!.text);
  assert.match(ring, /href\?: string;/);
  assert.match(ring, /aria-label=\{`\$\{text\}\. \$\{openLinkName\(caption, hrefLabel\)\}`\}/, 'the link of the ring says the score and where it goes');
  const tile = code(SOURCES.find((s) => s.file === 'KpiTile.tsx')!.text);
  assert.match(tile, /after:absolute after:inset-0/, 'the whole tile is the target of its link');
});

test('every link a chart makes has a name that says where it goes (Open <label>: <figure>)', () => {
  for (const file of ['BarList.tsx', 'DonutChart.tsx', 'SegmentBar.tsx', 'StackedBars.tsx']) {
    assert.match(code(SOURCES.find((s) => s.file === file)!.text), /aria-label=\{partLinkName\(/, file);
  }
  assert.match(code(SOURCES.find((s) => s.file === 'Heatmap.tsx')!.text), /aria-label=\{`Open \$\{name\}`\}/);
});

test('a bar of StackedBars is clickable, and the keyboard has the same links in a list that shows when one has focus (the picture is no tab stop)', () => {
  const bars = code(SOURCES.find((s) => s.file === 'StackedBars.tsx')!.text);
  assert.match(bars, /onClick=\{go\}/);
  assert.match(bars, /\[&:not\(:focus-within\)\]:sr-only/);
  assert.match(bars, /categories\.some\(\(c\) => c\.href\)/);
});

test('AreaTiles follows the kit rules: a list of tiles, a link when it has an address, a colour never alone (its word is in the name, the title and the legend), a phone has two columns', () => {
  const tiles = code(SOURCES.find((s) => s.file === 'AreaTiles.tsx')!.text);
  assert.match(tiles, /<ul aria-label=\{label\}/);
  assert.match(tiles, /grid-cols-2/);
  assert.match(tiles, /<Link href=\{t\.href\} title=\{t\.title\} aria-label=\{t\.linkName\}/);
  assert.match(tiles, /\{`, \$\{t\.word\}`\}/, 'a tile that is no link still says its status word to a screen reader');
  assert.match(tiles, /legendOf\(shown\)/);
  assert.match(tiles, /moreText/, 'a cut grid ends in "See all N"');
  assert.match(tiles, /STATUS\[tone\]/, 'the colour of the ring is the status palette');
  assert.doesNotMatch(tiles, /useQuery|fetch\(/);
});
