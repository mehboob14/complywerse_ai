// node --test "src/app/(dashboard)/governance/_overview/visualsModel.test.ts"
// What the Governance Overview's graphics draw: the six figures (each says loading, failed, refused or nothing recorded and never 0; a score moves by one decimal;
// a line needs two months), the series of every chart built from the answers the page holds (the months run to the current one with the quiet ones as real 0s,
// the windows of what lapses are differences of the server's cumulative counts, a number the server did not send is null and not 0), and the address each
// bar, slice and cell opens, which the library reads back as the same filter. The scorecard below is a trimmed copy of what the scratch tenant sent on 2026-11-11.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BANDS, GROUP_BARS, REVIEW_SERIES, archivedCount, cardState, classificationParts, exceptionParts, flowBars, flowIsEmpty, groupHeat, groupStacks, groupsDrawn, hasReviewBars,
  heroTiles, lapseIsEmpty, lapseRows, mappingRows, monthSeries, monthWindow, priorityRows, publishingScore, scoreDelta, sectionChart, statusRows, toneColor, typeSlices,
  type Answer, type HeroInputs,
} from './visualsModel.ts';
import { ATTENTION, counterFor, attentionTotal, type AttentionKey, type Counter, type Scorecard } from './overviewModel.ts';
import { groupHref, type PostureApiRow } from './postureModel.ts';
import { fromParams } from '../documents/_workspace/libraryModel.ts';
import { STATUS } from '../../../../components/overview/charts/palette.ts';

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

// ── the six figures ──────────────────────────────────────────────────────────
const sources = { scorecard: ok(CARD), summary: ok(SUMMARY), pending: ok({}), overdue: ok({}), expiring: ok({}), exceptions: ok({}) };
function inputs(over: Partial<HeroInputs> = {}): HeroInputs {
  const scorecard = over.scorecard ?? ok(CARD);
  const s = { ...sources, scorecard: { ...scorecard, data: scorecard.data } };
  const counters = Object.fromEntries(ATTENTION.map((def) => [def.key, counterFor(def, s as never)])) as Partial<Record<AttentionKey, Counter>>;
  return { scorecard, summary: ok(SUMMARY), trends: ok({ created: [{ month: '2026-10', count: 7 }], published: [{ month: '2026-10', count: 5 }, { month: '2026-11', count: 3 }] }), total: attentionTotal(s as never), counters, now: new Date('2026-11-11T00:00:00Z'), ...over };
}
const tile = (i: HeroInputs, key: string) => heroTiles(i).find((t) => t.key === key)!;

test('six figures in the order the page opens with them', () => {
  assert.deepEqual(heroTiles(inputs()).map((t) => t.key), ['score', 'attention', 'documents', 'reviews', 'coverage', 'published']);
});

test('the score: the server\'s own number and grade, its line over the months, and how it moved with one decimal (the kit\'s whole-number delta would say "Up 0")', () => {
  const t = tile(inputs(), 'score');
  assert.equal(t.state, 'ready');
  assert.equal(t.value, '67');
  assert.equal(t.note, 'Fair · target 85');
  assert.equal(t.tone, 'warning', 'the figure takes the colour of the grade');
  assert.equal(t.progress, 66.6);
  assert.deepEqual(t.spark?.values, [58.4, 66.7, 66.6]);
  assert.deepEqual(t.delta, { text: 'Down 0.1 points', direction: 'down', tone: 'bad', since: 'since Oct' });
  assert.equal(t.href, '#posture');
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
  assert.equal(tile(failed, 'documents').state, 'ready', 'the documents tile rests on the summary, which answered');
  const refused = inputs({ scorecard: { load: 'error', error: refusal } });
  assert.equal(tile(refused, 'score').state, 'denied');
  assert.equal(tile(refused, 'coverage').state, 'denied');
  assert.equal(tile(inputs({ trends: { load: 'error', error: failure } }), 'published').state, 'error');
});

test('what needs attention is the server\'s total, with how many of the eight areas have something', () => {
  const t = tile(inputs(), 'attention');
  assert.equal(t.value, '46');
  assert.equal(t.tone, 'warning');
  assert.equal(t.note, 'In 6 of 8 areas');
  assert.equal(t.href, '#attention');
  const none = tile(inputs({ scorecard: ok({ ...CARD, attention_queue: { ...CARD.attention_queue!, documents_awaiting_approval: 0, overdue_reviews: 0, expiring_documents_30d: 0, exceptions_attention: 0, overdue_attestations: 0, overdue_actions: 0, total: 0 } }) }), 'attention');
  assert.equal(none.value, '0');
  assert.equal(none.tone, 'success');
  assert.equal(none.note, 'Nothing needs attention');
});

test('the documents are the ones that are not archived, with the server\'s Publishing share as the bar when the scorecard answered', () => {
  const t = tile(inputs(), 'documents');
  assert.equal(t.value, '57');
  assert.equal(t.note, '30 published · 11 in review');
  assert.equal(t.progress, 52.6);
  assert.equal(publishingScore(CARD), 52.6);
  assert.equal(tile(inputs({ scorecard: { load: 'error', error: failure } }), 'documents').progress, null, 'no scorecard, no bar (never a guess)');
});

test('overdue reviews: the counter\'s number, red while above 0, and the ones that fall due next', () => {
  const t = tile(inputs(), 'reviews');
  assert.equal(t.value, '12');
  assert.equal(t.tone, 'danger');
  assert.equal(t.note, '7 more due in 30 days');
  assert.equal(t.href, '/governance/documents?review=overdue');
});

test('coverage is the server\'s "Docs mapped" with its numbers and its formula; none mapped yet is no figure', () => {
  const t = tile(inputs(), 'coverage');
  assert.equal(t.value, '86%');
  assert.equal(t.note, '49 of 57 documents mapped');
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
});

// ── section scores ───────────────────────────────────────────────────────────
test('the section bars are weakest first, in their band\'s colour, and a section with nothing to score is named and not drawn', () => {
  const c = sectionChart(CARD);
  assert.deepEqual(c.bars.map((b) => [b.name, b.score, b.band]), [
    ['Committees', 17, 'Weak'], ['Approvals & Sign-off', 57, 'Weak'], ['Documents', 62, 'Fair'], ['Attestations', 64, 'Fair'], ['Reviews', 74, 'Fair'], ['Mappings', 86, 'Strong'], ['Key Risk Indicators', 100, 'Strong'],
  ]);
  assert.deepEqual(c.noData, ['KPI Report']);
  assert.equal(c.target, 85);
  assert.equal(c.bars[0].color, toneColor('danger'));
  assert.equal(c.bars[2].color, toneColor('warning'));
  assert.equal(c.bars[6].color, toneColor('success'));
  assert.deepEqual(BANDS.map((b) => b.color), [STATUS.good, STATUS.warn, STATUS.bad]);
  assert.equal(c.bars.every((b) => b.page.startsWith('/')), true);
});

test('no scorecard is no bars', () => {
  assert.deepEqual(sectionChart(undefined).bars, []);
});

// ── status and type ──────────────────────────────────────────────────────────
test('the status rows run along the approval flow with a step nobody is at saying 0, then the states outside it that some document is in', () => {
  const rows = statusRows(SUMMARY);
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [['draft', 8], ['pending_review', 5], ['pending_approval', 6], ['approved', 4], ['published', 30], ['expired', 2], ['archived', 3]]);
  assert.equal(rows[0].label, 'Draft');
  assert.equal(rows[1].label, 'In review');
  assert.equal(rows[4].color, toneColor('success'));
  assert.equal(rows[5].color, toneColor('danger'));
  assert.equal(statusRows({ by_status: {} }).length, 5, 'the five steps of the flow are always there');
  assert.ok(statusRows({ by_status: { on_hold: 2 } }).some((r) => r.key === 'on_hold'), 'a status nobody registered is still a row');
});

test('every status bar opens the library on that status, and the library reads it back', () => {
  for (const r of statusRows(SUMMARY)) assert.deepEqual(fromParams(new URLSearchParams(r.href!.split('?')[1])).filters.statuses, [r.key], r.key);
});

test('the types are the five biggest, the rest folded into Other, and a type opens the library on it', () => {
  const s = typeSlices(SUMMARY);
  assert.deepEqual(s.map((x) => [x.label, x.value]), [['Policy', 30], ['Standard', 12], ['Procedure', 10], ['Guideline', 5], ['Charter', 2], ['Other', 1]]);
  const many = typeSlices({ by_type: { a: 9, b: 8, c: 7, d: 6, e: 5, f: 4, g: 3 } });
  assert.equal(many.length, 6);
  assert.equal(many[5].label, 'Other');
  assert.equal(many[5].value, 7);
  assert.equal(many[5].href, undefined, 'a folded tail opens nothing');
  assert.equal(new URLSearchParams(s[0].href!.split('?')[1]).get('type'), 'policy');
  assert.deepEqual(typeSlices({ by_type: {} }), []);
  assert.equal(archivedCount(SUMMARY), 3);
  assert.equal(archivedCount(undefined), 0);
});

test('classification is an ordered scale in one hue that darkens, in the order public to restricted', () => {
  const p = classificationParts(SUMMARY);
  assert.deepEqual(p.map((x) => [x.label, x.value]), [['Public', 10], ['Internal', 30], ['Confidential', 15], ['Restricted', 5]]);
  assert.equal(new Set(p.map((x) => x.color)).size, 4);
  assert.equal(new URLSearchParams(p[3].href.split('?')[1]).get('cls'), 'restricted');
  assert.deepEqual(classificationParts({ by_classification: {} }), []);
});

test('the mappings are documents linked to each kind of record out of the documents that are not archived; no mapping counts is no answer', () => {
  const m = mappingRows(CARD)!;
  assert.equal(m.of, 57);
  assert.deepEqual(m.rows.map((r) => [r.label, r.value, r.text]), [['Frameworks', 52, '52 of 57'], ['Controls', 0, '0 of 57'], ['Risks', 0, '0 of 57'], ['Assets', 0, '0 of 57']]);
  assert.equal(mappingRows(undefined), null);
  assert.deepEqual(mappingRows({ sections: { documents: { key: 'documents', label: 'Documents', weight: 1, score: null, metrics: [], counts: { active: 0 } }, mappings: { key: 'mappings', label: 'Mappings', weight: 1, score: null, metrics: [], counts: {} } } })?.rows, []);
});

// ── what lapses when ─────────────────────────────────────────────────────────
test('the windows are the differences of the server\'s cumulative counts, past due is what has lapsed already, and a number the server did not send is null', () => {
  const rows = lapseRows(CARD, { by_timeframe: { '30_days': 6, '60_days': 8, '90_days': 17 } }, SUMMARY);
  assert.deepEqual(rows, [
    { label: 'Past due', reviews: 12, expiring: 2 },
    { label: '30 days', reviews: 7, expiring: 6 },
    { label: '60 days', reviews: 6, expiring: 2 },
    { label: '90 days', reviews: 3, expiring: 9 },
  ]);
  const half = lapseRows(undefined, { by_timeframe: { '30_days': 1, '60_days': 1, '90_days': 3 } }, undefined);
  assert.deepEqual(half.map((r) => r.reviews), [null, null, null, null]);
  assert.deepEqual(half.map((r) => r.expiring), [null, 1, 0, 2]);
  assert.equal(lapseIsEmpty(half), false);
  assert.equal(lapseIsEmpty(lapseRows({ ...CARD, sections: { ...CARD.sections!, reviews: { ...CARD.sections!.reviews, counts: { overdue: 0, due_30d: 0, due_60d: 0, due_90d: 0 } } } }, { by_timeframe: { '30_days': 0, '60_days': 0, '90_days': 0 } }, { by_status: {} })), true);
  assert.equal(lapseIsEmpty(lapseRows(undefined, undefined, undefined)), false, 'no answer is not an empty calendar');
});

// ── exceptions ───────────────────────────────────────────────────────────────
test('exceptions run along their route and then how they ended, each in its status colour; priorities most serious first; nothing at 0', () => {
  const parts = exceptionParts({ approved: 7, revoked: 1, expired: 1, pending_approval: 3, rejected: 1, draft: 2, withdrawn: 0 });
  assert.deepEqual(parts.map((p) => [p.key, p.value]), [['draft', 2], ['pending_approval', 3], ['approved', 7], ['rejected', 1], ['revoked', 1], ['expired', 1]]);
  assert.equal(parts[2].color, toneColor('success'));
  assert.equal(parts[3].color, toneColor('danger'));
  assert.deepEqual(priorityRows({ high: 5, medium: 4, critical: 2, low: 4 }, '#x').map((r) => [r.label, r.value]), [['Critical', 2], ['High', 5], ['Medium', 4], ['Low', 4]]);
  assert.deepEqual(exceptionParts(undefined), []);
});

// ── requests and actions ─────────────────────────────────────────────────────
test('the three things people are asked to do are each done, waiting and overdue, and the waiting never counts the overdue twice', () => {
  const bars = flowBars(CARD);
  assert.deepEqual(bars.map((b) => b.key), ['approvals', 'attestations', 'actions']);
  const v = (b: (typeof bars)[number]) => b.parts.map((p) => [p.key, p.value]);
  assert.deepEqual(v(bars[0]), [['done', 20], ['waiting', 11], ['overdue', 6]]);
  assert.deepEqual(v(bars[1]), [['done', 33], ['waiting', 3], ['overdue', 8]]);
  assert.deepEqual(v(bars[2]), [['done', 0], ['waiting', 6], ['overdue', 3]]);
  assert.deepEqual(bars.map((b) => b.total), [37, 44, 9]);
  assert.deepEqual(bars[0].parts.map((p) => p.color), [STATUS.good, STATUS.pending, STATUS.bad]);
  assert.equal(flowIsEmpty(bars), false);
});

test('a bar whose numbers the scorecard did not send is left out, and nothing asked yet is empty', () => {
  assert.deepEqual(flowBars({ sections: { approvals: CARD.sections!.approvals } }).map((b) => b.key), ['approvals']);
  assert.deepEqual(flowBars(undefined), []);
  const zero: Scorecard = { sections: { approvals: { ...CARD.sections!.approvals, counts: { pending_steps: 0, overdue_steps: 0 } } } };
  assert.equal(flowIsEmpty(flowBars(zero)), true);
});

// ── the groups ───────────────────────────────────────────────────────────────
const row = (id: number | null, name: string, over: Partial<PostureApiRow> = {}): PostureApiRow => ({
  id, name, documents: 10, current: 3, due: 2, overdue: 4, no_review_date: 1, on_time_pct: 55, due_30d: 2, needs_attention: 9,
  attention: { overdue_reviews: 4, awaiting_approval: 2, expiring_30d: 1, exceptions: 0 }, open_exceptions: 1, ...over,
});

test('review health is one stack a group, in the order the server sends (weakest first), each document in one state only, and the bar opens the group in the library', () => {
  const rows = [row(12, 'ISO/IEC 27001:2022'), row(null, 'Not mapped to a framework', { current: 0, due: 0, overdue: 0, no_review_date: 0 })];
  const s = groupStacks(rows, 'framework');
  assert.deepEqual(s[0].cells, { current: 3, due: 2, overdue: 4, none: 1 });
  assert.equal(s[0].href, groupHref('framework', 12));
  assert.equal(s[1].href, groupHref('framework', null));
  assert.deepEqual(REVIEW_SERIES.map((x) => x.color), [STATUS.good, STATUS.warn, STATUS.bad, STATUS.neutral]);
  assert.deepEqual(REVIEW_SERIES.map((x) => x.label), ['Up to date', 'Due in 30 days', 'Overdue', 'No review date'], 'the library\'s own words');
  assert.equal(hasReviewBars(s), true);
  assert.equal(hasReviewBars(s.slice(1)), false, 'groups of drafts only draw nothing, and the card says so instead of an empty chart');
  const many = Array.from({ length: 30 }, (_, i) => row(i, `F${i}`));
  assert.equal(groupStacks(many, 'framework').length, GROUP_BARS);
  assert.equal(groupsDrawn(8, 36, 'frameworks'), 'Weakest 8 of 36 frameworks');
  assert.equal(groupsDrawn(5, 5, 'departments'), '5 departments');
});

test('where attention sits has a cell for each of the four kinds, a link only where the library can list exactly those documents, and the library reads the link back', () => {
  const h = groupHeat([row(12, 'ISO/IEC 27001:2022'), row(null, 'Not mapped to a framework')], 'framework');
  assert.deepEqual(h.cols, ['Overdue', 'Approval', 'Expiring', 'Exceptions']);
  assert.deepEqual(h.cells[0], [4, 2, 1, 0]);
  assert.equal(h.hrefs[0][3], undefined, 'exceptions have no list');
  const f = (href: string) => fromParams(new URLSearchParams(href.split('?')[1])).filters;
  assert.deepEqual(f(h.hrefs[0][0]!).frameworks, ['12']);
  assert.deepEqual(f(h.hrefs[0][0]!).review, ['overdue']);
  assert.deepEqual(f(h.hrefs[0][1]!).statuses, ['pending_review', 'pending_approval']);
  assert.equal(f(h.hrefs[0][2]!).expiring, true);
  assert.ok(h.hrefs[1][0]!.includes('fw=none'), 'the row with no framework is "none"');
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
