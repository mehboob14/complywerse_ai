// node --test "src/components/overview/charts/areaModel.test.ts"
// AreaTiles' rules (small multiples): a tile is a score of 0 to 100 and its status colour with the colour's word, a null score is "Not scored" (never a 0 and never
// a "good" ring), the list is cut at `max` with the true total kept, the legend names only the colours drawn, and the links and the card's "Open" link have names
// that say where they go.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AREA_MAX, AREA_WORDS, areaTilesHeight, legendOf, moreText, tileOf, tilesOf, type AreaTileItem } from './areaModel.ts';
import { openLinkName, partLinkName } from './chartModel.ts';

const item = (key: string, value: number | null, tone: AreaTileItem['tone'] = 'good', extra: Partial<AreaTileItem> = {}): AreaTileItem => ({ key, label: key.toUpperCase(), value, tone, ...extra });

test('a tile is the rounded score, its fill, its colour and the colour\'s word, and a name that says what it holds', () => {
  const t = tileOf(item('gov', 71.6, 'warn', { href: '/governance', note: '3 overdue' }));
  assert.deepEqual([t.figure, t.fill, t.tone, t.word], ['72', 71.6, 'warn', 'Watch']);
  assert.equal(t.title, 'GOV: 72 out of 100, Watch · 3 overdue');
  assert.equal(t.linkName, 'Open GOV: 72 out of 100, Watch · 3 overdue', 'the visible label and figure are inside the name');
  assert.equal(t.href, '/governance');
});

test('a score that is not recorded is a grey "Not scored", whatever tone the page gave it: never a 0, never a good ring', () => {
  for (const v of [null, Number.NaN, undefined as unknown as null]) {
    const t = tileOf(item('x', v, 'good'));
    assert.deepEqual([t.figure, t.fill, t.tone, t.word], ['—', 0, 'neutral', 'Not scored']);
    assert.equal(t.figureName, 'not scored');
  }
  assert.equal(tileOf(item('zero', 0, 'bad')).figure, '0', 'a real 0 is a 0');
  assert.equal(tileOf(item('zero', 0, 'bad')).scored, true, 'a 0 is scored: its empty ring still carries its colour as a dot');
  assert.equal(tileOf(item('none', null, 'bad')).scored, false);
  assert.equal(tileOf(item('zero', 0, 'bad')).tone, 'bad');
});

test('the fill is clamped to 0-100 and the page\'s own display words win over the rounded number', () => {
  assert.equal(tileOf(item('a', 140)).fill, 100);
  assert.equal(tileOf(item('a', -5)).fill, 0);
  const t = tileOf(item('a', 80, 'good', { display: '8 of 10' }));
  assert.deepEqual([t.figure, t.figureName], ['8 of 10', '8 of 10']);
});

test('a page may give its measure better words than On track / Watch / Off track', () => {
  const t = tileOf(item('a', 90, 'good'), { good: 'Compliant', bad: 'Gaps' });
  assert.equal(t.word, 'Compliant');
  assert.equal(tileOf(item('a', 30, 'warn'), { good: 'Compliant' }).word, AREA_WORDS.warn);
  assert.equal(tileOf(item('a', null, 'good'), { neutral: 'No score yet' }).word, 'No score yet');
});

test('the grid is cut at max (default 12) and keeps the true total for "See all N"', () => {
  const items = Array.from({ length: 17 }, (_, i) => item(`a${i}`, i * 5));
  const cut = tilesOf(items);
  assert.equal(AREA_MAX, 12);
  assert.deepEqual([cut.shown.length, cut.total, cut.hidden], [12, 17, 5]);
  assert.equal(moreText(cut.total, cut.hidden), 'See all 17');
  assert.equal(moreText(cut.total, cut.hidden, 'All 17 areas'), 'All 17 areas');
  const whole = tilesOf(items.slice(0, 5), 12);
  assert.deepEqual([whole.shown.length, whole.hidden], [5, 0]);
  assert.equal(moreText(5, 0), '', 'nothing hidden, no link');
  assert.equal(tilesOf(items, 0).shown.length, 1, 'a max below 1 still shows one tile');
});

test('the legend names only the colours drawn, in the fixed order good, warn, bad, not scored', () => {
  const { shown } = tilesOf([item('a', 10, 'bad'), item('b', null), item('c', 90, 'good'), item('d', 20, 'bad')]);
  assert.deepEqual(legendOf(shown).map((l) => l.tone), ['good', 'bad', 'neutral']);
  assert.deepEqual(legendOf(shown).map((l) => l.word), ['On track', 'Off track', 'Not scored']);
  assert.deepEqual(legendOf([]), []);
});

test('a skeleton for the grid is as tall as the grid: 52px a tile, 8px between rows', () => {
  assert.equal(areaTilesHeight(4, 4), 52);
  assert.equal(areaTilesHeight(12, 4), 3 * 52 + 2 * 8);
  assert.equal(areaTilesHeight(13, 4), 4 * 52 + 3 * 8);
  assert.equal(areaTilesHeight(0), 52, 'at least one row');
});

test('a card\'s "Open" link and a graphic\'s links are named for where they go, and the visible word is inside the name', () => {
  assert.equal(openLinkName('Risks by category'), 'Open risks by category');
  assert.equal(openLinkName('Risks by category', 'the risk register'), 'Open the risk register');
  assert.equal(openLinkName('Risks by category', 'Open the risk register, 12 high risks'), 'Open the risk register, 12 high risks');
  assert.equal(openLinkName('Opened items', 'items opened this week'), 'Open items opened this week', '"Opened" is not the word "Open"');
  assert.equal(partLinkName('High', '12', 'risks'), 'Open High: 12 risks');
  assert.equal(partLinkName('High', '12'), 'Open High: 12');
});
