// node --test "src/app/(dashboard)/automation/soc2-controls/_explorer/controlsDomains.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { domainGroups } from './controlsDomains.ts';
import { withIds, type ControlRow } from './controlsModel.ts';

const row = (id: string, category: string, status: string, over: Partial<ControlRow> = {}): ControlRow => ({
  control_id: id, title: id, category, checks_count: 0, overall_status: status, ownership_status: 'unowned', ...over,
});

test('controls are grouped by domain with where they stand, and the domains that need a person come first', () => {
  const groups = domainGroups(withIds([
    row('A-1', 'Asset', 'passed'), row('A-2', 'Asset', 'passed', { ownership_status: 'ok' }), row('A-3', 'Asset', 'manual'),
    row('I-1', 'Identity', 'failed'), row('I-2', 'Identity', 'expired'),
    row('G-1', 'Governance', 'collection_failed'), row('G-2', 'Governance', 'unbound'),
    row('X-1', '', 'manual'),
    row('B-1', 'Backup', 'passed'),
  ]));
  assert.deepEqual(groups.map((g) => g.label), ['Identity', 'Governance', 'Asset', 'Backup', 'No domain'], 'failing first, then needs a look, then by name; no domain last');
  const asset = groups.find((g) => g.label === 'Asset')!;
  assert.equal(asset.total, 3);
  assert.deepEqual(asset.columns, { failing: 0, attention: 0, passing: 2, waiting: 0, manual: 1 });
  assert.equal(asset.unowned, 2);
  const identity = groups.find((g) => g.label === 'Identity')!;
  assert.deepEqual(identity.columns, { failing: 1, attention: 1, passing: 0, waiting: 0, manual: 0 });
  assert.equal(groups.find((g) => g.label === 'No domain')!.key, '_none');
});

test('the totals of the groups are the controls given', () => {
  const rows = withIds([row('A', 'X', 'passed'), row('B', 'Y', 'failed'), row('C', 'Y', 'failed')]);
  assert.equal(domainGroups(rows).reduce((n, g) => n + g.total, 0), rows.length);
  assert.deepEqual(domainGroups([]), []);
});
