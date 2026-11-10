// node --test "src/app/(dashboard)/auditor-portal/internal-audit/_audits/auditsModel.test.ts"   (or the whole suite: npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sortRows } from '../../../../../components/ui/ds/tableModel.ts';
import { DEFAULT_SORT, INTERNAL_AUDIT_FORMAT, auditsOf, numbersOf, sortValue, workspaceHref, type ListRow } from './auditsModel.ts';

const row = (over: Partial<ListRow> = {}): ListRow => ({
  id: 1, name: 'Internal Audit 2026', assessment_type: 'gap_assessment', assessment_format: INTERNAL_AUDIT_FORMAT, category: 'Audit', source: null, file_name: 'ia.xlsx', status: 'in_progress', due_date: null,
  assessor: null, overall_score: null, total_items: 40, complied_count: 10, partially_complied_count: 5, not_complied_count: 8, in_progress_count: 12, na_count: 5, scope_model: null, phase: null, owner_id: null,
  owner_name: null, primary_asset_id: null, primary_asset_name: null, started_at: null, created_at: '2026-01-01T00:00:00', updated_at: null, ...over,
});

test('the format is the one the old Internal Audit address maps to, and an audit opens in the assessment workspace', () => {
  const forward = readFileSync(fileURLToPath(new URL('../../../assessments/_forward/forwardModel.ts', import.meta.url)), 'utf8');
  assert.match(forward, new RegExp(`internal_audit: '${INTERNAL_AUDIT_FORMAT}'`));
  assert.equal(workspaceHref(42), '/assessments/a/42');
});

test('the answer is the internal audits only, with the server\'s true total', () => {
  const got = auditsOf({ assessments: [row({ id: 1 }), row({ id: 2, assessment_format: 'asvs_checklist' }), row({ id: 3 })], total: 9 });
  assert.deepEqual(got.rows.map((r) => r.id), [1, 3]);
  assert.equal(got.total, 9, 'more than came back: the page says so');
  assert.deepEqual(auditsOf({ assessments: [row()] }), { rows: [row()], total: 1 });
  assert.deepEqual(auditsOf(undefined), { rows: [], total: 0 });
  assert.deepEqual(auditsOf({ assessments: undefined, total: 3 }), { rows: [], total: 3 });
  assert.equal(auditsOf({ assessments: [row(), row({ id: 2 })], total: 1 }).total, 2, 'a total smaller than what came back is not believed');
});

test('the numbers are the workbook\'s: an unknown total stays unknown, a missing count is 0', () => {
  assert.deepEqual(numbersOf(row()), { total: 40, notComplied: 8, partial: 5, inProgress: 12 });
  assert.deepEqual(numbersOf(row({ total_items: null, not_complied_count: null, partially_complied_count: null, in_progress_count: null })), { total: null, notComplied: 0, partial: 0, inProgress: 0 });
  assert.deepEqual(numbersOf(row({ total_items: 0 })).total, 0, '0 observations is a number, not "unknown"');
});

test('the list opens with the audit changed last first, and a column sorts with the empty ones last', () => {
  const rows = [row({ id: 1, name: 'B', updated_at: '2026-02-01T00:00:00', due_date: '2026-12-01T00:00:00' }), row({ id: 2, name: 'A', updated_at: '2026-03-01T00:00:00' }), row({ id: 3, name: 'C', updated_at: null, created_at: '2026-01-15T00:00:00', due_date: '2026-11-01T00:00:00' })];
  assert.deepEqual(sortRows(rows, DEFAULT_SORT, sortValue).map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(sortRows(rows, { key: 'name', dir: 'asc' }, sortValue).map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(sortRows(rows, { key: 'due', dir: 'asc' }, sortValue).map((r) => r.id), [3, 1, 2], 'no due date is last');
  assert.deepEqual(sortRows(rows, { key: 'due', dir: 'desc' }, sortValue).map((r) => r.id), [1, 3, 2], 'and last again the other way');
  assert.equal(sortValue(rows[0], 'nothing'), null);
});
