// node --test "src/app/(dashboard)/tasks/_create/slaModel.test.ts"
// The SLA days New task fills in: the organization's target, then its per-priority table, then the shipped number; the defaults are the same numbers everywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { slaDaysFor } from './slaModel.ts';
import { TASK_SLA_DEFAULTS } from '../slaConfig.ts';

const fallback = { critical: 7, high: 30, medium: 90, low: 180, info: 365 };

test('the tenant\'s per-level target wins, then its per-priority table, then the shipped number', () => {
  assert.equal(slaDaysFor({ targets: { high: { days: 12 } }, by_priority: { high: 20 } }, 'high', fallback), 12);
  assert.equal(slaDaysFor({ targets: {}, by_priority: { high: 20 } }, 'high', fallback), 20);
  assert.equal(slaDaysFor({ targets: { high: { days: null } }, by_priority: { high: 20 } }, 'high', fallback), 20, 'a target with no days is no target');
  assert.equal(slaDaysFor({ targets: {}, by_priority: {} }, 'low', fallback), 180);
  assert.equal(slaDaysFor(undefined, 'info', fallback), 365);
  assert.equal(slaDaysFor({ by_priority: { critical: 0 } }, 'critical', fallback), 7, 'zero days is not a deadline');
});

test('the tenant\'s shipped table and the platform\'s shipped numbers are the same, so an organization that changed nothing sees no difference', () => {
  assert.deepEqual(TASK_SLA_DEFAULTS, fallback);
  const spec = readFileSync('../backend/grc/services/module_settings.py', 'utf8');
  assert.match(spec, /"sla": _audit_sla\(\{"critical": 7, "high": 30, "medium": 90, "low": 180, "info": 365\}\),\s+"fields": \[\],\s+\},\s+"builtins": \[\s+_builtin\("title", "Title", required=True, locked=True\),\s+_builtin\("description", "Description", "textarea"\),\s+_builtin\("source", "Source", "select", list_key="source"\)/);
});
