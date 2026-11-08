// node --test "src/app/(dashboard)/governance/regulatory-changes/_lib/detailAddress.test.ts"
// What a change's page keeps in its address: the filters round-trip, the Overview's and the register's links land on the right tab already filtered, and a value the page cannot be in is the default.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { changeHref } from '../_overview/overviewModel.ts';
import { DETAIL_SCHEMA, DETAIL_TABS, NO_OBLIGATION_PATCH, NO_TASK_FILTERS, obligationFiltersOf, obligationPatch, taskFiltersOf, taskFiltering, taskPatch, type DetailAddress } from './detailAddress.ts';

const read = (q: string) => readAddress(DETAIL_SCHEMA, q) as DetailAddress;

test('the obligations\' filters and the open obligation round-trip through the address', () => {
  const filters = { q: 'incident', compliance: 'not_assessed', type: 'reporting', control: 'review' as const, owner: 'none', check: true };
  const base = read('');
  const query = writeAddress(DETAIL_SCHEMA, 'tab=obligations', { ...base, ...obligationPatch(filters), obl: 12 });
  assert.match(query, /^tab=obligations/, 'the tab (the strip\'s) is left alone');
  const back = read(query);
  assert.deepEqual(obligationFiltersOf(back), filters);
  assert.equal(back.obl, 12);
  assert.deepEqual(obligationFiltersOf(read('')), { q: '', compliance: '', type: '', control: '', owner: '', check: false });
  assert.equal(writeAddress(DETAIL_SCHEMA, 'tab=obligations', { ...back, ...NO_OBLIGATION_PATCH, obl: 0 }), 'tab=obligations', 'cleared: nothing left but the tab');
});

test('the tasks\' filters round-trip, and "filtering" is true for any of them', () => {
  const filters = { q: 'policy', status: 'blocked', who: '7', late: true };
  const back = read(writeAddress(DETAIL_SCHEMA, '', { ...read(''), ...taskPatch(filters) }));
  assert.deepEqual(taskFiltersOf(back), filters);
  assert.equal(taskFiltering(filters), true);
  assert.equal(taskFiltering(NO_TASK_FILTERS), false);
  assert.equal(taskFiltering({ ...NO_TASK_FILTERS, q: '   ' }), false);
});

test('the links the Overview and the register build open the right tab already filtered', () => {
  assert.deepEqual(obligationFiltersOf(read(changeHref(4, 'obligations', { control: 'review' }).split('?')[1])), { q: '', compliance: '', type: '', control: 'review', owner: '', check: false });
  assert.equal(read(changeHref(4, 'obligations', { check: 1 }).split('?')[1]).check, true);
  assert.equal(read(changeHref(4, 'tasks', { late: 1 }).split('?')[1]).late, true);
  assert.equal(read(changeHref(4, 'obligations', { obl: 9 }).split('?')[1]).obl, 9);
  assert.equal(read('gaps=1').gaps, true);
  assert.deepEqual(DETAIL_TABS, ['overview', 'obligations', 'assessments', 'tasks']);
});

test('a value the page cannot be in is the default', () => {
  const odd = read('control=sometimes&obl=-4&check=maybe&late=');
  assert.equal(odd.control, '');
  assert.equal(odd.obl, 0);
  assert.equal(odd.check, false);
  assert.equal(odd.late, false);
});
