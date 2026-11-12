// node --test "src/app/(dashboard)/governance/_overview/sections.test.ts"
// The guard against repetition on the one Governance Overview: what each view shows is the list in sections.ts, and no measure is on a view twice (a tile is never a slice of
// a chart beside it; a graphic and the table of the same measure are on different views, as GRAPHIC_AND_TABLE says). The list is held to the sources, so a card added to
// the page without a line there (or a line for a card that is not there) fails here. The old At a glance address is a server redirect, and no overview imports the counters band.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BOARD_SECTIONS, DEPARTMENT_SECTIONS, GRAPHIC_AND_TABLE, SUMMARY_CARDS, SUMMARY_TILES, firstRepeat, measuresOf,
} from './sections.ts';
import { heroTiles } from './visualsModel.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const loading = { load: 'loading' as const };

test('no measure is drawn twice on the Summary, on the Departments view or on the Board', () => {
  assert.equal(firstRepeat(measuresOf(SUMMARY_TILES, SUMMARY_CARDS)), null);
  assert.equal(firstRepeat(measuresOf({}, DEPARTMENT_SECTIONS)), null);
  assert.equal(firstRepeat(measuresOf({}, BOARD_SECTIONS)), null);
  assert.equal(firstRepeat(['a', 'b', 'a']), 'a', 'the check itself finds a repeat');
});

test('what two views both show is the graphic on one and the table on the other, and nothing else', () => {
  const summary = measuresOf(SUMMARY_TILES, SUMMARY_CARDS);
  const departments = measuresOf({}, DEPARTMENT_SECTIONS);
  const board = measuresOf({}, BOARD_SECTIONS);
  const shared = (a: string[], b: string[]) => a.filter((m) => b.includes(m));
  assert.deepEqual(shared(summary, departments), [], 'the Summary and the Departments view share no measure id: the graphic of the departments and their table are two ids');
  assert.deepEqual(shared(summary, board).concat(shared(departments, board)), [], 'the Board shows the documents themselves, no count of them');
  for (const [graphic, table] of Object.values(GRAPHIC_AND_TABLE)) {
    assert.ok(summary.includes(graphic), `${graphic}: the graphic is on the Summary`);
    assert.ok(departments.includes(table), `${table}: the table is on the Departments view`);
  }
});

test('the figures of the Summary are the tiles of the page, in its order, and every card of the Summary is in the list (and every line of the list is a card)', () => {
  const keys = heroTiles({ scorecard: loading, doc: loading, trends: loading, scoped: false, now: new Date('2026-11-12T00:00:00Z') }).map((t) => t.key);
  assert.deepEqual(Object.keys(SUMMARY_TILES), keys);
  const charts = read('./Charts.tsx');
  const summaryView = read('./SummaryView.tsx');
  const drawn = Array.from(code(charts).matchAll(/<ChartCard\s+id="([^"]+)"/g), (m) => m[1]);
  const listed = SUMMARY_CARDS.map((s) => s.id).filter((id) => id !== 'work');
  assert.deepEqual(drawn.slice().sort(), listed.slice().sort(), 'the ChartCards of Charts.tsx are the cards of the list');
  const order = Array.from(code(summaryView).matchAll(/<Cell span=\{\d+\}><(\w+)/g), (m) => m[1]);
  assert.equal(order.length, SUMMARY_CARDS.length, 'one cell for each card');
  assert.equal(order[order.length - 1], 'MyWorkCard', 'the person\'s own work comes last (Overview rule R3)');
  assert.ok(SUMMARY_CARDS[SUMMARY_CARDS.length - 1].id === 'work');
  for (const card of ['SectionScoresCard', 'StatusCard', 'TypeCard', 'ReviewsCard', 'WaitingCard', 'DepartmentsCard', 'ThroughputCard', 'ExpiringCard', 'ExceptionsCard']) {
    assert.ok(order.includes(card), card);
  }
});

test('the departments and the board are the cards of their lists', () => {
  assert.ok(code(read('./docs/_DepartmentTable.tsx')).includes('id="departments"'));
  assert.ok(code(read('./GroupCharts.tsx')).includes('id="attention-map"'));
  assert.ok(code(read('./DepartmentsView.tsx')).includes('id="frameworks"'));
  assert.ok(code(read('./BoardView.tsx')).includes('id="board"'));
  assert.deepEqual(DEPARTMENT_SECTIONS.map((s) => s.id), ['departments', 'attention-map', 'frameworks']);
  assert.deepEqual(BOARD_SECTIONS.map((s) => s.id), ['board']);
});

test('there is no needs-attention wall: no counters band, no list card of what needs attention, and the one tile opens the board', () => {
  for (const name of ['./SummaryView.tsx', './Charts.tsx', './Hero.tsx', './DepartmentsView.tsx', './BoardView.tsx', '../page.tsx']) {
    assert.doesNotMatch(code(read(name)), /CounterBand|WorkListCard|counterFor|attentionTotal/, `${name}: no counters band, no long worklist`);
  }
  const hero = read('./visualsModel.ts');
  assert.match(hero, /href: viewHref\(d\.scope\.value, 'board'\)/, 'the tile opens the board, which lists the documents');
  assert.equal(heroTiles({ scorecard: loading, doc: loading, trends: loading, scoped: false, now: new Date() }).filter((t) => t.key === 'attention').length, 1, 'one tile');
});

test('the Summary has no table and no list longer than five rows: the long lists are the Departments view\'s and the library\'s', () => {
  for (const name of ['./SummaryView.tsx', './Charts.tsx', './Hero.tsx']) assert.doesNotMatch(code(read(name)), /RegisterTable|<table\b|GroupRows|MatrixCard/, `${name}: no table on the Summary`);
  assert.match(read('./Charts.tsx'), /export const DEPARTMENT_BARS = 5;/);
  assert.match(read('./SummaryView.tsx'), /<MyWorkCard work=\{work\}/, 'My work is the slim card (three rows, "See all")');
});

test('the old At a glance address is a server redirect to the Overview that keeps its department, grouping and columns', () => {
  const page = read('../documents/overview/page.tsx');
  assert.match(page, /import \{ redirect \} from 'next\/navigation';/);
  assert.match(page, /import \{ legacyQuery \} from '\.\.\/\.\.\/_overview\/docs\/_views';/);
  assert.match(page, /redirect\(`\/governance\$\{legacyQuery\(searchParams\)\}`\);/);
  assert.doesNotMatch(page, /'use client'|useEffect|PageHeader/, 'a redirect, not a page that draws and then moves');
});
