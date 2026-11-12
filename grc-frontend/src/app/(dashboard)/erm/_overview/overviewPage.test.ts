// node --test "src/app/(dashboard)/erm/_overview/overviewPage.test.ts"
// Source pins for the Risk Management Overview (Overview v2): posture first and no attention wall (R1, R2), "My work" slim (R3), nothing long (R4), minimal text (R5), every graphic is a
// link (R6) and the page comes back to the same place (R7). The numbers are overviewModel.test.ts's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(`src/app/(dashboard)/erm/${p}`, 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const page = strip(read('page.tsx'));
const cards = strip(read('_overview/Cards.tsx'));
const tiles = strip(read('_overview/Tiles.tsx'));
const work = strip(read('_overview/MyWork.tsx'));
const all = [page, cards, tiles, work].join('\n');

test('R1 R2: the page leads with tiles and charts; there is no counters band, no attention list and no "Nothing counted" box', () => {
  assert.match(page, /<RiskTiles[\s\S]*<ChartGrid>/, 'tiles, then the chart grid');
  assert.doesNotMatch(all, /CounterBand|WorkListCard|Cockpit\b/, 'no chip wall, no long worklist');
  assert.doesNotMatch(all, /Needs attention|Nothing counted|Weakest sections/, 'no attention wall');
  assert.ok(page.indexOf('<MatrixCard') < page.indexOf('<MyWorkCard'), 'my work comes after the posture graphics');
});

test('R3: My work shows three one-line rows at most and the rest is one link away; with nothing it is one line', () => {
  assert.match(work, /items\.slice\(0, MY_WORK_ROWS\)/);
  assert.match(work, /See all \$\{formatCount\(items\.length\)\}/);
  assert.match(work, /All caught up/);
  assert.match(work, /truncate/, 'a row is one line');
  assert.doesNotMatch(work, /Show more[\s\S]*MyWorkCard/, 'the long list is in the sheet, not in the card');
});

test('R8: a refusal is said once and is never a retry: every tile and card has its own No access state, and My work says it once when every request was refused', () => {
  assert.match(work, /const noAccess = refused\.length === sources\.length/);
  assert.match(work, /statusOf\(s\.feed\.error\) !== 403/);
  assert.match(strip(read('_overview/parts.tsx')), /state: 'denied'/);
  assert.match(strip(read('_overview/parts.tsx')), /denied: true/);
});

test('R4: no list on the page has more than five rows: the donut folds into Other, the units are the top five with See all, the highest risks are five', () => {
  assert.match(cards, /DONUT_MAX = 5/);
  assert.match(cards, /UNITS_SHOWN = 5/);
  assert.match(cards, /const TOP = 5/);
  assert.match(cards, /See all \$\{units\.length\}/);
});

test('R6: every card opens its records (the section card has the sheet button instead), every tile is a link, every matrix cell opens the register at that cell', () => {
  const chartCards = cards.match(/<ChartCard\b[\s\S]*?>/g) ?? [];
  assert.equal(chartCards.length, 7);
  const without = chartCards.filter((c) => !/\bhref=/.test(c));
  assert.equal(without.length, 1, 'only the section card has no Open link');
  assert.match(without[0], /id="sections"/);
  assert.match(cards, /href=\{\(r, c\) => cellHref\(r, c, basis\)\}/);
  const kpis = tiles.match(/<KpiTile\b[\s\S]*?\/>/g) ?? [];
  assert.equal(kpis.length, 7, 'six tiles and the signals');
  kpis.forEach((k) => assert.match(k, /href=/));
  assert.match(cards, /<AreaTiles/);
});

test('R7: what changes the page is in its address and the page puts a returning person back where they were', () => {
  assert.match(page, /useAddressState\(SCHEMA\)/);
  assert.match(page, /basis: oneOf\(/);
  assert.match(page, /sheet: oneOf\(/);
  assert.match(page, /useReturnToPlace\(ready\)/);
  assert.match(page, /const ready = !\[overview, risks, reviews, appetite, actions, kris, krisReport, incidents\]\.some\(\(q\) => q\.isPending\)/);
});

test('every request keeps its query key (the Dashboard shares the module scorecard; the KRI register shares the KRI report)', () => {
  assert.match(page, /queryKey: \[\.\.\.SCORECARD_QUERY_KEYS\.erm\]/);
  assert.match(page, /queryKey: \['metric-report', 'kri'\]/);
  assert.match(page, /queryKey: \['erm-actions-overdue'\]/);
  assert.match(page, /queryKey: \['erm-kri-my-updates'\]/);
  assert.match(page, /queryKey: \['erm-incidents-all'\]/);
});

test('R5: no sentence under a card title; the words are labels, and a failed request is a state, never a figure', () => {
  assert.doesNotMatch(cards + tiles, /<p[^>]*>\s*[A-Z][a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+ [a-z]+[^<]*<\/p>/, 'no six-word sentence in a <p> of a card');
  assert.match(cards, /cardStatus\(/);
  assert.match(tiles, /tileStatus\(/);
});
