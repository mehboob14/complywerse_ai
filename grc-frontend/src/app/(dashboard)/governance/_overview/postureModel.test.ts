// node --test "src/app/(dashboard)/governance/_overview/postureModel.test.ts"
// The posture of the Overview: the head (score, the server's grade word, how the score moved), the section rows with what opens in place, and the rows of
// "By framework / By department" with the library address each one opens. The scorecard below is a trimmed copy of what the scratch tenant's
// /governance/dashboard/documents-overview sent on 2026-11-01; the group rows are what /governance/dashboard/posture sends (G6_be_overview_plan.md, section 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
  FIRST_PAGE, NEXT_PAGE, SECTION_PAGES, bandOf, deltaWords, factsOf, groupHref, groupNoun, groupRow, groupsMeta, nextOffset, onTimeText, postureHead, scoredWords, sectionName,
  sectionRows, showMoreLabel, trendAlt, type PostureApiRow,
} from './postureModel.ts';
import { SECTION_ORDER, type Scorecard } from './overviewModel.ts';
import { fromParams, NO_FRAMEWORK } from '../documents/_workspace/libraryModel.ts';
import { NO_DEPARTMENT } from '../documents/_workspace/library.ts';

const metric = (key: string, label: string, weight: number, score: number | null, numerator: number, denominator: number) => ({ key, label, weight, score, numerator, denominator, formula: `${label} formula` });
const CARD: Scorecard = {
  sections: {
    documents: {
      key: 'documents', label: 'Documents', weight: 0.18, score: 61.7,
      metrics: [metric('publishing_rate', 'Publishing rate', 0.35, 36.4, 24, 66), metric('gap_remediation', 'Gap remediation', 0.1, null, 0, 0)],
      counts: { total: 70, active: 66, published: 24, by_status: { published: 24, draft: 19, pending_review: 13, archived: 4, approved: 5, expired: 1, pending_approval: 2 }, expiring_30d: 0 },
    },
    reviews: {
      key: 'reviews', label: 'Reviews', weight: 0.14, score: 87.3, metrics: [metric('schedule_health', 'Schedule health', 0.5, 82.1, 5, 28)],
      counts: { scheduled_documents: 28, overdue: 5, due_30d: 6, due_60d: 9, due_90d: 10, completed_365d: 1 },
    },
    exceptions: { key: 'exceptions', label: 'Exceptions', weight: 0.09, score: 0, metrics: [], counts: { total: 174, pending_approval: 44 } },
    kpi: { key: 'kpi', label: 'KPI Report', weight: 0.06, score: null, metrics: [] },
  },
  performance: {
    score: 55.2, grade: 'fair',
    components: [{ key: 'documents', label: 'Documents', score: 61.7, weight: 0.18, target: 85 }],
    health_trend: [{ label: 'Oct', year: '2026', value: 58.4 }, { label: 'Nov', year: '2026', value: 55.2 }],
  },
};

test('the head: the server\'s grade word and its tone, the score, and how many sections were scored', () => {
  const h = postureHead(CARD);
  assert.equal(h.score, 55.2);
  assert.deepEqual(h.grade, { label: 'Fair', tone: 'warning' }, 'the word the server chose, and the tone that goes with that word (not the score band: 55 is a weak band but a fair grade)');
  assert.deepEqual([h.target, h.scored, h.sections], [85, 3, 4]);
});

test('the score moved: since last month, in words, with a sign and a decimal', () => {
  const h = postureHead(CARD);
  assert.deepEqual(h.delta, { value: -3.2, since: 'Oct', words: 'Down 3.2 points since Oct' });
  assert.equal(deltaWords(1, 'Sep'), 'Up 1.0 points since Sep');
  assert.equal(deltaWords(0, 'Sep'), 'Unchanged since Sep');
  assert.equal(deltaWords(-0.04, 'Sep'), 'Unchanged since Sep', 'a change that rounds to nothing is no change');
  assert.deepEqual(h.trend.map((p) => p.label), ['Oct', 'Nov']);
  assert.equal(trendAlt(h.trend), 'Performance score by month: Oct 58.4, Nov 55.2.');
});

test('one month of history is not a trend: no sparkline and no "since"; no history at all is the same', () => {
  const one = postureHead({ ...CARD, performance: { ...CARD.performance!, health_trend: [{ label: 'Nov', value: 55.2 }] } });
  assert.deepEqual([one.trend, one.delta], [[], null]);
  const none = postureHead({ ...CARD, performance: { ...CARD.performance!, health_trend: undefined } });
  assert.deepEqual([none.trend, none.delta], [[], null]);
});

test('nothing to score is "Nothing to score yet", never 0 and never a delta', () => {
  const h = postureHead({ sections: {}, performance: { score: null, grade: null, components: [] } });
  assert.deepEqual([h.score, h.grade, h.delta, h.target], [null, null, null, 85]);
  assert.equal(scoredWords(h), 'Nothing to score yet');
  assert.equal(postureHead(undefined).score, null);
  const noScore = postureHead({ ...CARD, performance: { ...CARD.performance!, score: null, grade: null } });
  assert.equal(noScore.delta, null, 'a missing score is not compared with last month');
});

test('the line under the ring says the target and how many sections were scored', () => {
  assert.equal(scoredWords(postureHead(CARD)), 'Target 85 · 3 of 4 sections scored');
  assert.equal(scoredWords({ score: 70, target: 85, scored: 10, sections: 10 }), 'Target 85 · 10 sections scored');
});

test('the bands are score-kit\'s: 80 and above strong, 60 and above fair, below weak, none is "No data"', () => {
  assert.deepEqual([80, 79.9, 60, 59.9, 0].map((s) => bandOf(s).label), ['Strong', 'Fair', 'Fair', 'Weak', 'Weak']);
  assert.deepEqual(bandOf(null), { tone: 'neutral', label: 'No data' });
  assert.deepEqual(bandOf(undefined), { tone: 'neutral', label: 'No data' });
});

test('the section rows come in the breakdown\'s order with their score, band, weight and page; no data is a dash, a zero stays a zero', () => {
  const rows = sectionRows(CARD);
  assert.deepEqual(rows.map((r) => r.key), ['documents', 'reviews', 'exceptions', 'kpi']);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual([byKey.documents.scoreText, byKey.documents.band.label, byKey.documents.weightPct, byKey.documents.page], ['62', 'Fair', 18, '/governance/documents']);
  assert.deepEqual([byKey.exceptions.score, byKey.exceptions.scoreText, byKey.exceptions.band.label], [0, '0', 'Weak']);
  assert.deepEqual([byKey.kpi.score, byKey.kpi.scoreText, byKey.kpi.band.label], [null, '—', 'No data']);
  assert.equal(sectionName(byKey.reviews), 'Reviews: 87, Strong');
  assert.equal(sectionName(byKey.kpi), 'KPI Report: no data');
  assert.deepEqual(sectionRows(undefined), []);
});

test('a row opens to its metrics with the server\'s formulas, "24 of 66" where it counts records, and "No data" for a metric with none', () => {
  const [documents] = sectionRows(CARD);
  assert.deepEqual(documents.metrics.map((m) => [m.label, m.weightPct, m.scoreText, m.detail, m.formula]), [
    ['Publishing rate', 35, '36%', '24 of 66', 'Publishing rate formula'],
    ['Gap remediation', 10, 'No data', null, 'Gap remediation formula'],
  ]);
});

test('a row opens to the section\'s own counts in the library\'s words; "In review" is the two states that wait for a person; a count the server did not send is left out', () => {
  const [documents, reviews] = sectionRows(CARD);
  assert.deepEqual(documents.facts, [
    { label: 'Published', value: '24' }, { label: 'Draft', value: '19' }, { label: 'In review', value: '15' }, { label: 'Approved', value: '5' }, { label: 'Expired', value: '1' }, { label: 'Archived', value: '4' },
  ]);
  assert.deepEqual(reviews.facts.map((f) => `${f.label} ${f.value}`), ['Scheduled 28', 'Overdue 5', 'Due in 30 days 6', 'Due in 60 days 9', 'Due in 90 days 10', 'Completed in 12 months 1']);
  assert.deepEqual(factsOf('exceptions', { total: 1200 }), [{ label: 'Total', value: '1,200' }], 'only the counts that were sent, with a thousands separator');
  assert.deepEqual(factsOf('documents', undefined), []);
  assert.deepEqual(factsOf('unknown_section', { a: 1 }), []);
});

test('every section the scorecard can send has a page that exists in this app', () => {
  const root = new URL('../../', import.meta.url);                // src/app/(dashboard)/
  for (const key of SECTION_ORDER) {
    const page = SECTION_PAGES[key];
    assert.ok(page, `${key} has a page`);
    const folder = page.replace(/^\//, '');
    assert.ok(existsSync(new URL(`${folder}/page.tsx`, root)) || (page === '/governance/approvals' && existsSync(new URL('governance/approvals/page.tsx', root))), `${key}: ${page} is a page of this app`);
  }
});

// ── by framework / by department ─────────────────────────────────────────────
const ROW = (over: Partial<PostureApiRow> = {}): PostureApiRow => ({
  id: 1, name: 'Abu Dhabi Healthcare Information and Cyber Security Standard', documents: 8, current: 3, due: 1, overdue: 1, no_review_date: 0, on_time_pct: 80, due_30d: 1,
  needs_attention: 10, attention: { overdue_reviews: 1, awaiting_approval: 1, expiring_30d: 0, exceptions: 8 }, open_exceptions: 17, ...over,
});

test('a group opens the library on that group; the row with no group opens "none"; the overdue figure opens the overdue reviews of the group', () => {
  assert.equal(groupHref('framework', 7), '/governance/documents?fw=7');
  assert.equal(groupHref('department', 3), '/governance/documents?dept=3');
  assert.equal(groupHref('framework', null), '/governance/documents?fw=none');
  assert.equal(groupHref('department', null, 'overdue'), '/governance/documents?dept=none&review=overdue');
  assert.equal(groupHref('framework', 7, 'overdue'), '/governance/documents?fw=7&review=overdue');
});

test('the addresses are the library\'s own: it reads them back as the same framework, department and review filter', () => {
  const state = (href: string) => fromParams(new URLSearchParams(href.split('?')[1])).filters;
  assert.deepEqual(state(groupHref('framework', 7, 'overdue')).frameworks, ['7']);
  assert.deepEqual(state(groupHref('framework', 7, 'overdue')).review, ['overdue']);
  assert.deepEqual(state(groupHref('framework', null)).frameworks, [NO_FRAMEWORK]);
  assert.deepEqual(state(groupHref('department', 3)).departments, ['3']);
  assert.deepEqual(state(groupHref('department', null)).departments, [NO_DEPARTMENT]);
  assert.deepEqual(state(groupHref('department', 3)).frameworks, []);
});

test('a group row says the true figures with separators, and a group with no review date has no "on time" (a dash, not 0)', () => {
  const r = groupRow(ROW({ documents: 1240, open_exceptions: 1200, needs_attention: 1500 }), 'framework');
  assert.deepEqual([r.key, r.documents, r.onTime, r.overdueText, r.needsAttention, r.openExceptions], ['1', '1,240', '80%', '1', '1,500', '1,200']);
  assert.equal(r.line, 'Documents 1,240 · Attention 1,500 · Exceptions 1,200');
  assert.equal(r.href, '/governance/documents?fw=1');
  assert.equal(r.overdueHref, '/governance/documents?fw=1&review=overdue');
  const none = groupRow(ROW({ id: null, name: 'Not mapped to a framework', on_time_pct: null, overdue: 0 }), 'framework');
  assert.deepEqual([none.key, none.onTime, none.overdue], ['none', '—', 0]);
});

test('"on time" never reads 100% while a review is overdue, and a share is rounded down', () => {
  assert.equal(onTimeText(99.7), '99%');
  assert.equal(onTimeText(71.4), '71%');
  assert.equal(onTimeText(0), '0%');
  assert.equal(onTimeText(100), '100%');
  assert.equal(onTimeText(null), '—');
});

test('the card says how many groups and documents there are, in the right number', () => {
  assert.equal(groupsMeta({ by: 'framework', total: 36, documents_total: 66 }), '36 frameworks · 66 documents');
  assert.equal(groupsMeta({ by: 'department', total: 1, documents_total: 1 }), '1 department · 1 document');
  assert.equal(groupNoun('framework', 0), 'frameworks');
});

test('ten at a time, then "Show all N" asks for the rest in pages of the most the server gives; nothing is asked when everything is here', () => {
  assert.deepEqual([FIRST_PAGE, NEXT_PAGE], [10, 100]);
  assert.equal(showMoreLabel(10, 36), 'Show all 36');
  assert.equal(showMoreLabel(110, 250), 'Show 140 more');
  assert.equal(nextOffset(10, 36), 10);
  assert.equal(nextOffset(36, 36), null);
  assert.equal(nextOffset(0, 0), null);
});
