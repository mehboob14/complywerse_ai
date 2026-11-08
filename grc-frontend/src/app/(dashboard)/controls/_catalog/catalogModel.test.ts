// node --test "src/app/(dashboard)/controls/_catalog/catalogModel.test.ts"
// The Control Catalog's numbers and queries: the posture formulas the page always had, the grade, what asks for attention, the stat strip, the list queries (the names the server reads), the test
// schedule and the words.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUtc } from '../../../../lib/serverTime.ts';
import {
  CADENCES, NO_LIST_FILTERS, attentionFilter, daysWords, deltaWords, frameworkQuery, gradeOf, groupQuery, internalQuery, isFiltered, kpisOf, listQuery, pageCount, pct, postureOf,
  procedureNote, residualTone, residualWord, scheduleOf, shownDomains, subtitleOf, type DomainStat, type WorkStats,
} from './catalogModel.ts';

const stats = (over: Partial<WorkStats> = {}): WorkStats => ({ controls: 200, assigned: 50, tested: 100, effective: 60, partially_effective: 20, ineffective: 10, evidence_pending: 4, overdue: 7, ...over });

test('percent rounds, and a zero divisor reads 0', () => {
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(2, 3), 67);
  assert.equal(pct(5, 0), 0);
});

test('posture: tested % over all controls, effective % over the tested ones, the rest are not tested', () => {
  const p = postureOf(stats());
  assert.equal(p.testedPct, 50);
  assert.equal(p.effPct, 60);
  assert.equal(p.notTested, 110);
  assert.equal(p.grade, 'fair');
  assert.deepEqual(p.attention.map((a) => [a.key, a.n]), [['overdue', 7], ['ineffective', 10], ['partial', 20], ['evidence', 4]]);
  assert.equal(p.attentionTotal, 41);
});

test('not tested never goes below zero, and a catalog with no controls reads zeros', () => {
  assert.equal(postureOf(stats({ controls: 10, effective: 8, partially_effective: 5, ineffective: 4 })).notTested, 0);
  const empty = postureOf(stats({ controls: 0, tested: 0, effective: 0, partially_effective: 0, ineffective: 0, evidence_pending: 0, overdue: 0 }));
  assert.deepEqual([empty.testedPct, empty.effPct, empty.notTested, empty.grade, empty.attentionTotal], [0, 0, 0, 'not_started', 0]);
});

test('the grade: nothing tested is Not started; effective 80 and over Strong; 60 and over Fair; below Needs work', () => {
  assert.equal(gradeOf(0, 100), 'not_started');
  assert.equal(gradeOf(10, 80), 'strong');
  assert.equal(gradeOf(10, 79), 'fair');
  assert.equal(gradeOf(10, 60), 'fair');
  assert.equal(gradeOf(10, 59), 'needs_work');
});

test('each attention row opens All controls with the filter that finds those controls', () => {
  assert.deepEqual(attentionFilter('overdue'), { due: 'overdue' });
  assert.deepEqual(attentionFilter('ineffective'), { effectiveness: 'ineffective' });
  assert.deepEqual(attentionFilter('partial'), { effectiveness: 'partially_effective' });
  assert.deepEqual(attentionFilter('evidence'), {});
});

test('the stat strip: six figures, true counts, a missing overdue reads none due', () => {
  const k = kpisOf({ ...stats(), by_source: { framework: 150, internal: 30, normalized: 20 } }, { since: '2026-11-01', tested: 5, effective: -2, assigned: 0, overdue: 3 });
  assert.deepEqual(k.map((x) => x.key), ['controls', 'assigned', 'tested', 'effective', 'overdue', 'evidence']);
  assert.equal(k[0].value, '200');
  assert.equal(k[0].hint, '150 framework · 30 internal · 20 unified');
  assert.equal(k[1].hint, '25%');
  assert.equal(k[2].value, '50%');
  assert.equal(k[2].hint, '100 of 200');
  assert.equal(k[3].value, '60%');
  assert.equal(k[4].tone, 'danger');
  const none = kpisOf(stats({ tested: 0, effective: 0, overdue: undefined, evidence_pending: 0 }));
  assert.equal(none[3].value, '—');
  assert.equal(none[3].hint, 'no tests yet');
  assert.equal(none[4].value, '0');
  assert.equal(none[4].hint, 'none due');
  assert.equal(none[5].tone, 'default');
});

test('a change since the last snapshot says up or down, and whether that is good', () => {
  assert.deepEqual(deltaWords(5, true), { text: 'up 5', good: true });
  assert.deepEqual(deltaWords(3, false), { text: 'up 3', good: false });
  assert.deepEqual(deltaWords(-2, false), { text: 'down 2', good: true });
  assert.equal(deltaWords(0, true), null);
  assert.equal(deltaWords(undefined, true), null);
});

test('the domain filter is a case-insensitive contains', () => {
  const d = (domain: string) => ({ domain, controls: 1 } as DomainStat);
  assert.deepEqual(shownDomains([d('Identity and access'), d('Asset management'), d('Unclassified')], ' ACCESS ').map((x) => x.domain), ['Identity and access']);
  assert.equal(shownDomains([d('A'), d('B')], '').length, 2);
  assert.equal(shownDomains([d('A')], 'zzz').length, 0);
});

test('the All controls query uses the names the server reads, only the ones set, and skip / limit from the page', () => {
  assert.equal(listQuery(NO_LIST_FILTERS, 1, 50), 'skip=0&limit=50');
  assert.equal(
    listQuery({ source: 'framework', q: ' mfa ', framework: '12', domain: 'Identity and access', progress: 'in_progress', effectiveness: 'ineffective', due: 'overdue' }, 3, 25),
    'source=framework&q=mfa&framework_id=12&canonical_domain=Identity+and+access&status=in_progress&effectiveness=ineffective&due=overdue&skip=50&limit=25',
  );
  assert.equal(listQuery(NO_LIST_FILTERS, 0, 50), 'skip=0&limit=50', 'page 0 is page 1');
});

test('the group, framework and internal queries are paged (the old fixed 500 / 600 limits are gone)', () => {
  assert.equal(groupQuery('Risk', { type: 'framework', framework_id: 7 }, 2, 50), 'canonical_domain=Risk&framework_id=7&skip=50&limit=50');
  assert.equal(groupQuery('Risk', { type: 'normalized', framework_id: null }, 1, 50), 'canonical_domain=Risk&source=normalized&skip=0&limit=50');
  assert.equal(frameworkQuery(7, 3, 25), 'framework_id=7&skip=50&limit=25');
  assert.equal(internalQuery(1, 50), 'source=internal&skip=0&limit=50');
});

test('filters count as set when any is, and pages are never below one', () => {
  assert.equal(isFiltered(NO_LIST_FILTERS), false);
  assert.equal(isFiltered({ ...NO_LIST_FILTERS, due: 'overdue' }), true);
  assert.equal(isFiltered({ ...NO_LIST_FILTERS, q: '  ' }), false);
  assert.equal(pageCount(0, 50), 1);
  assert.equal(pageCount(101, 50), 3);
});

test('the test schedule: past is overdue, a date ahead is scheduled, no date is none; days are rounded as before', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  assert.deepEqual(scheduleOf(null, now, parseUtc), { state: 'none', days: null });
  assert.deepEqual(scheduleOf('2026-11-05T12:00:00', now, parseUtc), { state: 'overdue', days: -3 });
  assert.deepEqual(scheduleOf('2026-11-13T12:00:00', now, parseUtc), { state: 'scheduled', days: 5 });
  assert.equal(daysWords(-3), '3 days ago');
  assert.equal(daysWords(1), 'in 1 day');
  assert.equal(daysWords(0), 'today');
});

test('the cadences are the ones the server schedules from', () => {
  assert.deepEqual(CADENCES.map((c) => c.value), ['', 'monthly', 'quarterly', 'semi_annually', 'annually']);
});

test('residual risk keeps the Catalog\'s own cut: 15 and over high, 8 and over medium, else low, none is not scored', () => {
  assert.deepEqual([residualTone(15), residualTone(14), residualTone(8), residualTone(7), residualTone(null)], ['danger', 'warning', 'warning', 'success', 'neutral']);
  assert.deepEqual([residualWord(20), residualWord(10), residualWord(2), residualWord(undefined)], ['High', 'Medium', 'Low', 'Not scored']);
});

test('small words', () => {
  assert.equal(procedureNote('quarterly', 25), 'quarterly · sample of 25');
  assert.equal(procedureNote(null, null), '');
  assert.equal(procedureNote('semi_annually', 0), 'semi annually');
  assert.equal(subtitleOf({ code: 'AC-2', framework_name: 'NIST 800-53' }), 'AC-2 · NIST 800-53');
  assert.equal(subtitleOf({}), '');
});
