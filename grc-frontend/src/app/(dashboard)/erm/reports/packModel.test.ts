// node --test "src/app/(dashboard)/erm/reports/packModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changedCommentary, formatCell, groupByCommittee, packActions, type CommitteePack } from './packModel.ts';

const pack = (id: number, committee: string | null, meeting_date: string | null, built_at = '2026-11-01') =>
  ({ id, committee_name: committee, meeting_date, built_at }) as CommitteePack;

test('the actions on a pack follow its status and who may act', () => {
  assert.deepEqual(packActions({ status: 'draft', can_freeze: false }, true), ['edit', 'ready']);
  assert.deepEqual(packActions({ status: 'ready', can_freeze: false }, true), ['edit'], 'the preparer: someone else approves');
  assert.deepEqual(packActions({ status: 'ready', can_freeze: true }, true), ['edit', 'freeze']);
  assert.deepEqual(packActions({ status: 'draft', can_freeze: false }, false), [], 'a reader');
  assert.deepEqual(packActions({ status: 'frozen', can_freeze: false }, true), ['export'], 'a frozen pack is read-only');
});

test('packs are grouped by committee, named ones first, newest meeting first in each', () => {
  const groups = groupByCommittee([pack(1, 'Board Risk Committee', '2026-09-01'), pack(2, null, null),
    pack(3, 'Audit Committee', '2026-10-01'), pack(4, 'Board Risk Committee', '2026-12-01'), pack(5, 'Board Risk Committee', null, '2026-11-05')]);
  assert.deepEqual(groups.map((g) => [g.committee, g.packs.map((p) => p.id)]), [
    ['Audit Committee', [3]], ['Board Risk Committee', [4, 5, 1]], ['No committee', [2]],
  ]);
  assert.deepEqual(groupByCommittee([]), []);
});

test('a loss figure keeps two decimals, a score stays as it is and a blank is a dash', () => {
  assert.equal(formatCell(1500, true), '1,500.00');
  assert.equal(formatCell(16, false), '16');
  assert.equal(formatCell(null, false), '—');
  assert.equal(formatCell('Outside appetite', false), 'Outside appetite');
});

test('only the commentary that changed is sent', () => {
  assert.deepEqual(changedCommentary({ losses: 'A', reviews: 'B' }, { losses: 'A', reviews: 'B2', appetite: '' }), { reviews: 'B2' });
  assert.deepEqual(changedCommentary({ losses: 'A' }, { appetite: 'New' }), { appetite: 'New' });
});
