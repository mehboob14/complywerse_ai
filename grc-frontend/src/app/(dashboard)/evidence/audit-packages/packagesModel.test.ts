// node --test "src/app/(dashboard)/evidence/audit-packages/packagesModel.test.ts"
// The rules of the Audit packages tab: counts and filters, the steps a package is in a state to take (the server's own rules, said before the person asks), the order of the files and how
// one moves a place (a swap: setting one number left two files at the same number), and what the New package form sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_FORM, NO_PACKAGE_FILTER, createPayload, downloadName, filterPackages, inOrder, periodText, problems, stepsOf, swapPlan, tabCounts, type PackageItem, type PackageRow,
} from './packagesModel.ts';

let n = 0;
const pkg = (over: Partial<PackageRow> = {}): PackageRow => {
  n += 1;
  return {
    id: n, name: `Package ${n}`, description: null, framework_id: null, framework_name: null, audit_period_start: null, audit_period_end: null, status: 'draft', created_by: 1, creator_name: 'Ayesha Khan',
    created_at: '2026-11-01T10:00:00', finalized_at: null, exported_at: null, retention_until: null, is_legal_hold: false, evidence_count: 2, ...over,
  };
};
const item = (id: number, sequence: number): PackageItem => ({ id, evidence_id: id * 10, sequence, notes: null, added_at: null, evidence: null });

test('counts by status tab, and what a filter keeps: the status, legal hold only when asked, every word of the search in the name, framework or creator', () => {
  const rows = [pkg({ name: 'FY26 SBP audit', framework_name: 'SBP' }), pkg({ status: 'finalized', is_legal_hold: true }), pkg({ status: 'exported', framework_name: 'ISO 27001' }), pkg({ status: 'archived' })];
  assert.deepEqual(tabCounts(rows), { all: 4, draft: 1, finalized: 1, exported: 1 });
  assert.equal(filterPackages(rows, NO_PACKAGE_FILTER).length, 4);
  assert.deepEqual(filterPackages(rows, { ...NO_PACKAGE_FILTER, status: 'finalized' }).map((r) => r.id), [rows[1].id]);
  assert.deepEqual(filterPackages(rows, { ...NO_PACKAGE_FILTER, hold: true }).map((r) => r.id), [rows[1].id]);
  assert.deepEqual(filterPackages(rows, { ...NO_PACKAGE_FILTER, q: 'sbp audit' }).map((r) => r.id), [rows[0].id]);
  assert.deepEqual(filterPackages(rows, { ...NO_PACKAGE_FILTER, q: 'iso khan' }).map((r) => r.id), [rows[2].id], 'a word may be in the framework and another in the creator');
});

test('the period reads as dates the platform way, and says Not set where the person can set it', () => {
  assert.equal(periodText(null, null), 'Not set');
  assert.equal(periodText('2026-01-01T00:00:00', '2026-12-31T00:00:00'), '1 Jan 2026 to 31 Dec 2026');
  assert.equal(periodText('2026-01-01', null), 'From 1 Jan 2026');
  assert.equal(periodText(null, '2026-12-31'), 'Until 31 Dec 2026');
});

test('the steps a package is in a state to take: only a draft is edited; finalize needs a file; export and download follow the status; legal hold stops a delete', () => {
  assert.deepEqual(stepsOf(pkg({ status: 'draft', evidence_count: 3 })), {
    editable: true, finalize: { allowed: true, why: null }, exportable: false, downloadable: false, remove: { allowed: true, why: null },
  });
  assert.deepEqual(stepsOf(pkg({ status: 'draft', evidence_count: 0 })).finalize, { allowed: false, why: 'Add evidence before finalizing this package.' });
  const finalized = stepsOf(pkg({ status: 'finalized' }));
  assert.equal(finalized.editable, false);
  assert.equal(finalized.exportable, true);
  assert.equal(finalized.downloadable, false);
  assert.deepEqual(finalized.remove, { allowed: false, why: 'Only a draft package can be deleted.' });
  const exported = stepsOf(pkg({ status: 'exported' }));
  assert.equal(exported.exportable, true, 'an exported package may be exported again');
  assert.equal(exported.downloadable, true);
  assert.deepEqual(stepsOf(pkg({ status: 'draft', is_legal_hold: true })).remove, { allowed: false, why: 'This package is on legal hold.' });
});

test('a file moves one place by trading numbers with its neighbour (two writes); at either end there is nothing to do; two files at one number still move', () => {
  const items = [item(1, 1), item(2, 2), item(3, 3)];
  assert.deepEqual(swapPlan(items, 1, -1), [{ itemId: 2, newSequence: 1 }, { itemId: 1, newSequence: 2 }]);
  assert.deepEqual(swapPlan(items, 1, 1), [{ itemId: 2, newSequence: 3 }, { itemId: 3, newSequence: 2 }]);
  assert.equal(swapPlan(items, 0, -1), null);
  assert.equal(swapPlan(items, 2, 1), null);
  assert.equal(swapPlan(items, 9, 1), null);
  assert.deepEqual(inOrder([item(5, 3), item(4, 1), item(6, 1)]).map((i) => i.id), [4, 6, 5], 'ties by id');
  // older data with two files at number 2: moving the first of them down puts it after, and the pair no longer ties
  const tied = [item(1, 1), item(2, 2), item(3, 2)];
  const [moved, other] = swapPlan(tied, 1, 1) as Array<{ itemId: number; newSequence: number }>;
  assert.equal(moved.itemId, 2);
  assert.notEqual(moved.newSequence, other.newSequence);
  assert.ok(moved.newSequence > other.newSequence, 'the moved file now comes after its neighbour');
});

test('the form: a name is required and fits the column, a period cannot end before it starts; it sends what it always sent', () => {
  assert.deepEqual(problems(EMPTY_FORM), { name: 'Enter a name.' });
  assert.deepEqual(problems({ ...EMPTY_FORM, name: 'x'.repeat(256) }), { name: 'Use 255 characters or fewer.' });
  assert.deepEqual(problems({ ...EMPTY_FORM, name: 'FY26', audit_period_start: '2026-12-01', audit_period_end: '2026-01-01' }), { period: 'The period cannot end before it starts.' });
  assert.deepEqual(problems({ ...EMPTY_FORM, name: 'FY26', audit_period_start: '2026-01-01', audit_period_end: '2026-01-01' }), {});
  assert.deepEqual(createPayload({ ...EMPTY_FORM, name: ' FY26 ' }), { name: 'FY26', description: null });
  assert.deepEqual(createPayload({ name: 'FY26', description: ' for SBP ', framework_id: '7', audit_period_start: '2026-01-01', audit_period_end: '2026-12-31' }), {
    name: 'FY26', description: 'for SBP', framework_id: 7, audit_period_start: '2026-01-01', audit_period_end: '2026-12-31',
  });
});

test('the downloaded file is named for the package and carries nothing odd', () => {
  assert.equal(downloadName({ id: 4, name: 'FY26 / SBP audit: "final"' }), 'audit-package-4-FY26-SBP-audit-final.zip');
  assert.equal(downloadName({ id: 4, name: '***' }), 'audit-package-4-export.zip');
});
