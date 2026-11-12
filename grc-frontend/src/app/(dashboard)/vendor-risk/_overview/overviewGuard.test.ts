// node --test "src/app/(dashboard)/vendor-risk/_overview/overviewGuard.test.ts"
// Source pins for Overview v2 on the Third-Party Vendor Risk page: no counter wall, Back returns to the same place, every card and tile opens its module, "My work" is three one-line rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = code(read('../page.tsx'));
const VISUALS = code(read('./visuals.tsx'));
const PARTS = code(read('./parts.tsx'));

test('the page has no counter band, and the Back rule is applied once every card has answered', () => {
  assert.doesNotMatch(PAGE, /CounterBand/);
  assert.doesNotMatch(PAGE, /Cockpit\b[^']*\bband\b/);
  assert.match(PAGE, /useReturnToPlace\(/);
  assert.match(PAGE, /useAddressState\(SCHEMA\)/);                       // scope and the findings split are in the address
  assert.match(PAGE, /findings: oneOf\(/);
});

test('every chart card opens its module (ChartCard href) and every list says "See all" when it is cut', () => {
  const cards = VISUALS.match(/<ChartCard\b[^>]*?>/g) ?? [];
  assert.equal(cards.length, 11);
  assert.ok(cards.every((c) => /\bhref=/.test(c) && /\bhrefLabel=/.test(c)), 'a card without an Open link');
  assert.equal((VISUALS.match(/<SeeAll\b/g) ?? []).length, 3);
  assert.doesNotMatch(VISUALS, /attention-counter|CounterBand|Needs attention</);   // the one attention figure is a tile (chartsModel.heroTiles), not a card or a chip row
});

test('My work is slim: three one-line rows, "See all", all caught up in one line, a failed source said with Retry', () => {
  assert.match(PARTS, /limit = 3/);
  assert.match(PARTS, /See all/);
  assert.match(PARTS, /All caught up/);
  assert.match(PARTS, /could not be loaded/);
  assert.doesNotMatch(PARTS, /Show more|WorkRow/);                         // no growing list, no two-line row
});
