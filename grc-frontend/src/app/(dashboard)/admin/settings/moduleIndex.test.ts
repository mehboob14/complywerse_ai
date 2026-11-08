// node --test "src/app/(dashboard)/admin/settings/moduleIndex.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { moduleRows, partsText, SETTINGS_PLACE } from './moduleIndex.ts';

test('what can be set reads as a sentence in the order the Settings show it', () => {
  assert.equal(partsText(['statuses', 'sla', 'fields', 'lists']), 'Statuses, SLA, custom fields and dropdown lists');
  assert.equal(partsText(['lists', 'sla']), 'SLA and dropdown lists', 'in the Settings\' order, not the server\'s');
  assert.equal(partsText(['lists']), 'Dropdown lists');
  assert.equal(partsText(['statuses', 'mystery']), 'Statuses', 'a part nobody here knows is left out');
  assert.equal(partsText([]), 'Settings');
  assert.equal(partsText(undefined), 'Settings');
});

test('one row per module in the server\'s order; a module with a known place links to it, any other says where to look', () => {
  const rows = moduleRows([
    { key: 'tasks', label: 'Task Management', sections: ['sla', 'fields', 'lists'] },
    { key: 'exceptions', label: 'Policy exceptions', sections: ['lists'] },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['tasks', 'exceptions']);
  assert.deepEqual(rows[0], { key: 'tasks', label: 'Task Management', parts: 'SLA, custom fields and dropdown lists', where: 'Task Management, Settings tab', href: '/tasks?tab=settings' });
  assert.equal(rows[1].href, null);
  assert.equal(rows[1].where, "In the module's own Settings");
  assert.deepEqual(moduleRows([]), []);
});

test('every place is an address inside the app', () => {
  for (const [key, place] of Object.entries(SETTINGS_PLACE)) {
    assert.match(place.href, /^\/[a-z0-9-]+(\/[a-z0-9_-]+)*(\?[a-z=]+)?$/, key);
    assert.ok(place.where.length > 8, key);
  }
});
