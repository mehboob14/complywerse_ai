// node --test "src/app/(dashboard)/governance/_overview/visualsModel.test.ts"
// What the Governance Overview's graphics draw: the five figures (each says loading, failed, refused or nothing recorded and never 0; a score moves by one decimal;
// a line needs two months; the ones the server cannot narrow to a department say they are the whole organisation), the series of every card built from the answers
// the page holds (the months run to the current one with the quiet ones as real 0s, the expiry windows are differences of the server's cumulative counts, a number
// the server did not send is left out and not 0), and the address each bar, slice and cell opens, which the library reads back as the same filter. The scorecard
// below is a trimmed copy of what the scratch tenant sent on 2026-11-11.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUP_BARS, WHOLE_ORGANISATION, cardState, exceptionParts, expiringIsEmpty, expiringRows, groupHeat, groupsDrawn,
  heroTiles, monthSeries, monthWindow, scoreDelta, sectionTarget, sectionTiles, toneColor, wholeOrganisation,
  type Answer, type HeroInputs,
} from './visualsModel.ts';
import type { Scorecard } from './overviewModel.ts';
import { type PostureApiRow } from './postureModel.ts';
import { fromParams } from '../documents/_workspace/libraryModel.ts';
import { WHOLE } from './docs/_fixture.ts';
import type { Overview } from './docs/_model.ts';

const metric = (key: string, label: string, weight: number, score: number | null, numerator: number, denominator: number) => ({ key, label, weight, score, numerator, denominator, formula: `${label} formula` });
const CARD: Scorecard = {
  sections: {
    documents: {
      key: 'documents', label: 'Documents', weight: 0.18, score: 62.1,
      metrics: [metric('publishing_rate', 'Publishing', 0.2, 52.6, 30, 57)],
      counts: { total: 60, active: 57, published: 30, by_status: { published: 30, pending_review: 5, archived: 3, draft: 8, approved: 4, expired: 2, pending_approval: 6 } },
    },
    mappings: {
      key: 'mappings', label: 'Mappings', weight: 0.18, score: 86,
      metrics: [metric('document_coverage', 'Docs mapped', 0.35, 86, 49, 57)],
      counts: { controls: { links: 0, documents: 0 }, risks: { links: 0, documents: 0 }, frameworks: { links: 0, documents: 52 }, assets: { links: 0, documents: 0 }, documents_mapped: 49 },
    },
    approvals: { key: 'approvals', label: 'Approvals & Sign-off', weight: 0.14, score: 56.9, metrics: [], counts: { pending_steps: 17, overdue_steps: 6, approved_90d: 14, rejected_90d: 6 } },
    reviews: { key: 'reviews', label: 'Reviews', weight: 0.14, score: 73.8, metrics: [], counts: { scheduled_documents: 32, overdue: 12, due_30d: 7, due_60d: 13, due_90d: 16 } },
    attestations: { key: 'attestations', label: 'Attestations', weight: 0.09, score: 63.8, metrics: [], counts: { requests_12m: 44, completed: 33, open: 11, overdue: 8 } },
    committees: { key: 'committees', label: 'Committees', weight: 0.09, score: 16.7, metrics: [], counts: { open_actions: 9, overdue_actions: 3, actions_completed: 0 } },
    kris: { key: 'kris', label: 'Key Risk Indicators', weight: 0.09, score: 100, metrics: [], counts: {} },
    kpi: { key: 'kpi', label: 'KPI Report', weight: 0.06, score: null, metrics: [] },
  },
  attention_queue: { documents_awaiting_approval: 11, overdue_reviews: 12, expiring_documents_30d: 6, exceptions_attention: 6, open_gaps: 0, overdue_attestations: 8, overdue_actions: 3, red_kris: 0, total: 46 },
  performance: {
    score: 66.6, grade: 'fair', components: [{ key: 'documents', label: 'Documents', score: 62.1, weight: 0.18, target: 85 }],
    health_trend: [{ label: 'Jun', year: '2026', value: 58.4 }, { label: 'Oct', year: '2026', value: 66.7 }, { label: 'Nov', year: '2026', value: 66.6 }],
  },
};
const SUMMARY = { total_documents: 60, by_type: { policy: 30, standard: 12, procedure: 10, guideline: 5, charter: 2, other: 1 }, by_status: CARD.sections!.documents.counts!.by_status as Record<string, number>, by_classification: { internal: 30, confidential: 15, public: 10, restricted: 5 } };
const ok = <T>(data: T): Answer<T> => ({ load: 'ready', data });
const refusal = { response: { status: 403 } };
const failure = { response: { status: 500 } };

// ── the months ───────────────────────────────────────────────────────────────
test('the window is the last six calendar months ending in the one it is now, across a year end', () => {
  assert.deepEqual(monthWindow(new Date('2026-11-11T10:00:00Z')), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(monthWindow(new Date('2026-02-01T00:00:00Z')), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthWindow(new Date('2026-12-31T23:59:59Z'), 3), ['2026-10', '2026-11', '2026-12'], 'the server reckons months in UTC');
});

test('a month the server left out is a true 0 and the line runs to the month that is now', () => {
  const rows = monthSeries({ created: [{ month: '2026-08', count: 7 }, { month: '2026-10', count: 4 }], published: [{ month: '2026-09', count: 2 }, { month: '2026-10', count: 1 }] }, new Date('2026-11-11T00:00:00Z'));
  assert.deepEqual(rows.map((r) => [r.month, r.created, r.published]), [
    ['2026-06', 0, 0], ['2026-07', 0, 0], ['2026-08', 7, 0], ['2026-09', 0, 2], ['2026-10', 4, 1], ['2026-11', 0, 0],
  ]);
  assert.equal(rows[0].label, 'Jun 26');
  assert.equal(monthSeries(undefined, new Date('2026-11-11T00:00:00Z')).length, 6, 'no answer: six months of 0, which the card never draws (it says "no data")');
});

// ── the five figures ─────────────────────────────────────────────────────────
/** A scope of 57 documents, 3 archived, 9 of them with something wrong. */
const DOC: Overview = {
  ...WHOLE,
  totals: { ...WHOLE.totals, documents: 57, archived: 3 },
  issues: { no_owner: 2, expired: 1, exception_applied: 0, stuck: 3, on_hold: 1, late_acknowledgements: 4, late_approvals: 2, documents: 9 },
  links: { ...WHOLE.links, 'totals.documents': { dept: '11' } },
};
function inputs(over: Partial<HeroInputs> = {}): HeroInputs {
  return { scorecard: ok(CARD), doc: ok(DOC), trends: ok({ created: [{ month: '2026-10', count: 7 }], published: [{ month: '2026-10', count: 5 }, { month: '2026-11', count: 3 }] }), scoped: false, now: new Date('2026-11-11T00:00:00Z'), ...over };
}
const tile = (i: HeroInputs, key: string) => heroTiles(i).find((t) => t.key === key)!;

test('five figures in the order the Summary opens with them: no tile is a slice of a chart below it', () => {
  assert.deepEqual(heroTiles(inputs()).map((t) => t.key), ['score', 'documents', 'coverage', 'attention', 'published']);
});

test('the score: the server own number and grade, its line over the months, and how it moved with one decimal (the kit whole-number delta would say "Up 0")', () => {
  const t = tile(inputs(), 'score');
  assert.equal(t.state, 'ready');
  assert.equal(t.value, '67');
  assert.equal(t.note, 'Fair · target 85');
  assert.equal(t.tone, 'warning', 'the figure takes the colour of the grade');
  assert.equal(t.progress, 66.6);
  assert.deepEqual(t.spark?.values, [58.4, 66.7, 66.6]);
  assert.deepEqual(t.delta, { text: 'Down 0.1 points', direction: 'down', tone: 'bad', since: 'since Oct' });
  assert.equal(t.href, '#section-scores');
});

test('a change of a point is singular, no change is no change, and one month of history is no line and no change', () => {
  const card = (trend: Array<{ label: string; value: number }>, score: number): Scorecard => ({ ...CARD, performance: { ...CARD.performance!, score, health_trend: trend } });
  assert.deepEqual(scoreDelta(card([{ label: 'Oct', value: 60 }, { label: 'Nov', value: 61 }], 61)), { text: 'Up 1.0 point', direction: 'up', tone: 'good', since: 'since Oct' });
  assert.deepEqual(scoreDelta(card([{ label: 'Oct', value: 61 }, { label: 'Nov', value: 61 }], 61)), { text: 'No change', direction: 'flat', tone: 'neutral', since: 'since Oct' });
  const one = tile(inputs({ scorecard: ok(card([{ label: 'Nov', value: 61 }], 61)) }), 'score');
  assert.equal(one.spark, null);
  assert.equal(one.delta, null);
});

test('a score nobody can compute is "nothing recorded", not 0', () => {
  const t = tile(inputs({ scorecard: ok({ ...CARD, performance: { score: null, grade: null, components: [], health_trend: [] } }) }), 'score');
  assert.equal(t.state, 'none');
  assert.equal(t.value, null);
});

test('loading, failed and refused are three different states of a tile, and a failure names what to ask again', () => {
  const loading = inputs({ scorecard: { load: 'loading' } });
  for (const key of ['score', 'coverage']) assert.equal(tile(loading, key).state, 'loading', key);
  const failed = inputs({ scorecard: { load: 'error', error: failure } });
  assert.equal(tile(failed, 'score').state, 'error');
  assert.deepEqual(tile(failed, 'score').retry, ['scorecard']);
  assert.equal(tile(failed, 'documents').state, 'ready', 'the documents tile rests on the document figures, which answered');
  assert.equal(tile(failed, 'attention').state, 'ready');
  const refused = inputs({ scorecard: { load: 'error', error: refusal } });
  assert.equal(tile(refused, 'score').state, 'denied');
  assert.equal(tile(refused, 'coverage').state, 'denied');
  assert.equal(tile(inputs({ trends: { load: 'error', error: failure } }), 'published').state, 'error');
  const noDocs = inputs({ doc: { load: 'error', error: failure } });
  for (const key of ['documents', 'attention']) {
    assert.equal(tile(noDocs, key).state, 'error', key);
    assert.deepEqual(tile(noDocs, key).retry, ['doc'], key);
    assert.equal(tile(noDocs, key).value, null, `${key}: never a 0`);
  }
  assert.equal(tile(inputs({ doc: { load: 'error', error: refusal } }), 'documents').state, 'denied');
  assert.equal(tile(inputs({ doc: { load: 'loading' } }), 'attention').state, 'loading');
});

test('the documents are the ones that are not archived, with the archived ones said apart, and open the library on the scope', () => {
  const t = tile(inputs(), 'documents');
  assert.equal(t.value, '57');
  assert.equal(t.note, '3 archived');
  assert.equal(t.href, '/governance/documents?dept=11');
  assert.equal(tile(inputs({ doc: ok({ ...DOC, totals: { ...DOC.totals, archived: 0 }, links: {} }) }), 'documents').note, undefined);
  assert.equal(tile(inputs({ doc: ok({ ...DOC, links: {} }) }), 'documents').href, '/governance/documents', 'a scope the server gave no address opens the whole library');
});

test('the one needs-attention tile counts the documents once, opens the board of the scope, and has a thin bar of what is urgent and what is to follow up', () => {
  const t = tile(inputs(), 'attention');
  assert.equal(t.value, '9');
  assert.equal(t.tone, 'warning');
  assert.equal(t.href, '/governance?view=board');
  assert.equal(t.note, '46% urgent', 'one word for the colour of the bar: its share that is urgent');
  assert.deepEqual(t.severity?.map((p) => [p.key, p.value]), [['urgent', 6], ['follow', 7]], 'stuck 3, late approvals 2, expired 1 are urgent; on hold 1, late acknowledgements 4, no owner 2 are to follow up');
  const inDept = tile(inputs({ doc: ok({ ...DOC, scope: { ...DOC.scope, value: '11' } }) }), 'attention');
  assert.equal(inDept.href, '/governance?dept=11&view=board');
  const none = tile(inputs({ doc: ok({ ...DOC, issues: { ...DOC.issues, documents: 0, stuck: 0, no_owner: 0, expired: 0, on_hold: 0, late_acknowledgements: 0, late_approvals: 0 } }) }), 'attention');
  assert.equal(none.value, '0');
  assert.equal(none.tone, 'success');
  assert.equal(none.severity, null, 'a bar of nothing is no bar');
  assert.equal(none.note, 'Nothing is stuck or late');
});

test('coverage is the server "Docs mapped" with its numbers and its formula; none mapped yet is no figure', () => {
  const t = tile(inputs(), 'coverage');
  assert.equal(t.value, '86%');
  assert.equal(t.note, '49 of 57 mapped');
  assert.equal(t.info, 'Docs mapped formula');
  const empty = { ...CARD, sections: { ...CARD.sections!, mappings: { ...CARD.sections!.mappings, metrics: [metric('document_coverage', 'Docs mapped', 0.35, null, 0, 0)] } } };
  assert.equal(tile(inputs({ scorecard: ok(empty) }), 'coverage').state, 'none');
});

test('published: the sum over the six months with its line, and the share published of what was created', () => {
  const t = tile(inputs(), 'published');
  assert.equal(t.value, '8');
  assert.equal(t.label, 'Published, 6 months');
  assert.equal(t.note, '7 created · 114% published', 'published can outrun created in a window: documents created earlier are published later');
  assert.deepEqual(t.spark?.values, [0, 0, 0, 0, 5, 3]);
  assert.equal(tile(inputs({ trends: ok({ created: [], published: [] }) }), 'published').spark, null, 'six months of nothing is no line');
  assert.equal(t.href, '/governance/documents?status=published');
});

test('with a department picked, the score, the coverage and the published figure say they are the whole organisation; the document figures do not', () => {
  const scoped = inputs({ scoped: true });
  for (const key of ['score', 'coverage', 'published']) {
    assert.ok(tile(scoped, key).note?.endsWith(WHOLE_ORGANISATION), `${key}: the tile says it`);
    assert.ok(tile(scoped, key).info?.includes('whatever department is picked'), `${key}: and so does its (i)`);
    assert.ok(!tile(inputs(), key).note?.includes(WHOLE_ORGANISATION), `${key}: not when no department is picked`);
  }
  for (const key of ['documents', 'attention']) assert.ok(!(tile(scoped, key).note ?? '').includes(WHOLE_ORGANISATION), key);
  assert.deepEqual(wholeOrganisation(false, 'Facts.'), { info: 'Facts.' });
  assert.equal(wholeOrganisation(true, 'Facts.').meta, WHOLE_ORGANISATION);
});

// ── section scores ───────────────────────────────────────────────────────────
test('the section tiles are in the breakdown order, in their band tone, a section with nothing to score is "not scored" and not a 0, and each opens its page', () => {
  const t = sectionTiles(CARD);
  assert.deepEqual(t.map((x) => [x.label, x.value, x.tone]), [
    ['Documents', 62.1, 'warn'], ['Mappings', 86, 'good'], ['Approvals & Sign-off', 56.9, 'bad'], ['Reviews', 73.8, 'warn'], ['Attestations', 63.8, 'warn'],
    ['Committees', 16.7, 'bad'], ['Key Risk Indicators', 100, 'good'], ['KPI Report', null, 'neutral'],
  ]);
  assert.equal(t.every((x) => x.href?.startsWith('/')), true);
  assert.equal(sectionTarget(CARD), 85);
  assert.deepEqual(sectionTiles(undefined), []);
});

// ── what expires when ───────────────────────────────────────────────────────
test('the expiry windows are the differences of the server cumulative counts, only the first opens the library, and a number the server did not send is left out', () => {
  const rows = expiringRows({ by_timeframe: { '30_days': 6, '60_days': 8, '90_days': 17 } });
  assert.deepEqual(rows.map((r) => [r.label, r.value, r.href]), [['Within 30 days', 6, '/governance/documents?expiry=30d'], ['31 to 60 days', 2, undefined], ['61 to 90 days', 9, undefined]]);
  assert.deepEqual(expiringRows({ by_timeframe: { '30_days': 1, '60_days': 1 } }).map((r) => [r.key, r.value]), [['30', 1], ['60', 0]]);
  assert.deepEqual(expiringRows(undefined), []);
  assert.equal(expiringIsEmpty(expiringRows({ by_timeframe: { '30_days': 0, '60_days': 0, '90_days': 0 } })), true);
  assert.equal(expiringIsEmpty(expiringRows(undefined)), false, 'no answer is not an empty calendar');
  const f = fromParams(new URLSearchParams(rows[0].href!.split('?')[1])).filters;
  assert.equal(f.expiring, true, 'the library reads the address back');
});

// ── exceptions ───────────────────────────────────────────────────────────────
test('exceptions run along their route and then how they ended, each in its status colour; nothing at 0', () => {
  const parts = exceptionParts({ approved: 7, revoked: 1, expired: 1, pending_approval: 3, rejected: 1, draft: 2, withdrawn: 0 });
  assert.deepEqual(parts.map((p) => [p.key, p.value]), [['draft', 2], ['pending_approval', 3], ['approved', 7], ['rejected', 1], ['revoked', 1], ['expired', 1]]);
  assert.equal(parts[2].color, toneColor('success'));
  assert.equal(parts[3].color, toneColor('danger'));
  assert.deepEqual(exceptionParts(undefined), []);
});

// ── the groups ───────────────────────────────────────────────────────────────
const row = (id: number | null, name: string, over: Partial<PostureApiRow> = {}): PostureApiRow => ({
  id, name, documents: 10, current: 3, due: 2, overdue: 4, no_review_date: 1, on_time_pct: 55, due_30d: 2, needs_attention: 9,
  attention: { overdue_reviews: 4, awaiting_approval: 2, expiring_30d: 1, exceptions: 0 }, open_exceptions: 1, ...over,
});

test('where attention sits has a cell for each of the three kinds the framework table does not show, a link only where the library can list exactly those documents, and the library reads the link back', () => {
  const h = groupHeat([row(12, 'ISO/IEC 27001:2022'), row(null, 'Not mapped to a framework')], 'framework');
  assert.deepEqual(h.cols, ['Approval', 'Expiring', 'Exceptions'], 'the overdue reviews are the Overdue column of the table beside it: drawn once');
  assert.deepEqual(h.cells[0], [2, 1, 0]);
  assert.equal(h.hrefs[0][2], undefined, 'exceptions have no list');
  const f = (href: string) => fromParams(new URLSearchParams(href.split('?')[1])).filters;
  assert.deepEqual(f(h.hrefs[0][0]!).frameworks, ['12']);
  assert.deepEqual(f(h.hrefs[0][0]!).statuses, ['pending_review', 'pending_approval']);
  assert.equal(f(h.hrefs[0][1]!).expiring, true);
  assert.ok(h.hrefs[1][0]!.includes('fw=none'), 'the row with no framework is "none"');
  assert.equal(groupsDrawn(8, 36, 'frameworks'), 'Weakest 8 of 36 frameworks');
  assert.equal(groupsDrawn(5, 5, 'departments'), '5 departments');
  assert.equal(GROUP_BARS, 8);
});

test('a long name is clipped, and two groups of one name stay two rows', () => {
  const h = groupHeat([row(1, 'A very long framework name that would crush the table beside it'), row(2, 'Twin'), row(3, 'Twin')], 'framework', 8, 20);
  assert.equal(h.rows[0].length, 20);
  assert.ok(h.rows[0].endsWith('…'));
  assert.deepEqual(h.rows.slice(1), ['Twin', 'Twin (3)']);
});

// ── a card that rests on several requests ────────────────────────────────────
test('a card is loading while any request loads, refused if any was refused, failed if any failed, else ready', () => {
  assert.equal(cardState(ok(1), { load: 'loading' }), 'loading');
  assert.equal(cardState({ load: 'error', error: failure }, { load: 'error', error: refusal }), 'denied');
  assert.equal(cardState(ok(1), { load: 'error', error: failure }), 'error');
  assert.equal(cardState(ok(1), ok(2)), 'ready');
  assert.equal(cardState({ load: 'loading' }, { load: 'error', error: failure }), 'loading', 'wait for the others before saying what failed');
});
