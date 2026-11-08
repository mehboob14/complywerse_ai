// node --test "src/app/(dashboard)/automation/assurance/_periods/periodsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auditPeriod } from '../../../../../lib/statuses/controls.ts';
import { SOA_FORMATS, canClose, canFreeze, draftErrors, hasErrors, isFrozen, orderedPeriods, pctWords, soaFileName, spanOf, statementWords, type Period } from './periodsModel.ts';

const p = (id: number, over: Partial<Period> = {}): Period => ({ id, name: `FY${id}`, period_start: '2026-01-01', period_end: '2026-12-31', status: 'open', has_soa_snapshot: false, ...over });

test('open and in-fieldwork periods come first, the latest end first, closed ones after them', () => {
  const list = [p(1, { status: 'closed', period_end: '2027-12-31' }), p(2, { period_end: '2025-12-31' }), p(3, { status: 'fieldwork', period_end: '2026-12-31' }), p(4, { period_end: '2026-12-31' })];
  assert.deepEqual(orderedPeriods(list).map((x) => x.id), [4, 3, 2, 1]);
  assert.deepEqual(orderedPeriods([]), []);
});

test('a closed period can be neither frozen nor closed again; every other one can', () => {
  for (const status of ['open', 'fieldwork']) { assert.equal(canFreeze(p(1, { status })), true); assert.equal(canClose(p(1, { status })), true); }
  assert.equal(canFreeze(p(1, { status: 'closed' })), false);
  assert.equal(canClose(p(1, { status: 'closed' })), false);
});

test('the statement of a period is frozen or not, said in words with the day', () => {
  assert.equal(isFrozen(p(1)), false);
  assert.equal(statementWords(p(1)), 'Statement not frozen yet');
  assert.equal(statementWords(p(1, { has_soa_snapshot: true, frozen_at: '2026-11-08T09:00:00' })), 'Statement frozen 8 Nov 2026');
  assert.equal(statementWords(p(1, { has_soa_snapshot: true })), 'Statement frozen');
});

test('a span keeps its calendar days and a missing date is a dash', () => {
  assert.equal(spanOf(p(1)), '1 Jan 2026 to 31 Dec 2026');
  assert.equal(spanOf(p(1, { period_end: null })), '1 Jan 2026 to —');
});

test('the create form says what is missing before it is sent', () => {
  assert.deepEqual(draftErrors({ name: '', start: '', end: '' }), { name: 'Give the period a name.', start: 'Choose the first day.', end: 'Choose the last day.' });
  assert.deepEqual(draftErrors({ name: 'FY2026 Type II', start: '2026-01-01', end: '2026-12-31' }), {});
  assert.equal(draftErrors({ name: 'x', start: '2026-02-01', end: '2026-01-01' }).end, 'The last day cannot be before the first.');
  assert.equal(draftErrors({ name: 'x', start: '2026-02-01', end: '2026-02-01' }).end, undefined, 'a one-day period is a period');
  assert.match(draftErrors({ name: 'x'.repeat(256), start: '2026-01-01', end: '2026-01-02' }).name ?? '', /under 255/);
  assert.equal(hasErrors({}), false);
  assert.equal(hasErrors({ name: 'a' }), true);
  assert.equal(draftErrors({ name: '   ', start: '2026-01-01', end: '2026-01-02' }).name, 'Give the period a name.');
});

test('the saved file says which statement it is and what it is', () => {
  assert.equal(soaFileName('json', null), 'soa-live.json');
  assert.equal(soaFileName('oscal', 7), 'soa-period-7.oscal.json');
  assert.equal(soaFileName('xlsx', 7, 'application/vnd.openxmlformats'), 'soa-period-7.xlsx');
  assert.equal(soaFileName('xlsx', null, 'text/csv'), 'soa-live.csv');
  assert.deepEqual(SOA_FORMATS.map((f) => f.value), ['xlsx', 'json', 'oscal']);
});

test('a share is a rounded percent or a dash, never NaN', () => {
  assert.equal(pctWords(72.4), '72%');
  assert.equal(pctWords(0), '0%');
  assert.equal(pctWords(null), '—');
  assert.equal(pctWords(Number.NaN), '—');
});

test('the words of a period status are registered', () => {
  for (const s of ['open', 'fieldwork', 'closed']) assert.ok(auditPeriod.has(s));
});
