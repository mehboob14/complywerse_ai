// node --test "src/app/(dashboard)/tasks/taskTabs.test.ts"
// The tabs of Task Management (taskTabs.ts): My work is the default and has the plain address, every old tab name still opens the tab that holds its content, an old board link (no ?tab=,
// a register parameter) opens All tasks, and a link into All tasks is written the way the register reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress } from '../../../lib/addressState.ts';
import { resolveTab, withTab } from '../../../lib/tabsModel.ts';
import { REGISTER_SCHEMA, pageOf, type RegisterAddress } from './_register/taskAddress.ts';
import { REGISTER_PARAMS, TAB_ALIASES, TAB_LABELS, TASK_TABS, defaultTab, tasksHref } from './taskTabs.ts';

const open = (search: string): string => resolveTab(search, 'tab', TASK_TABS, TAB_ALIASES, defaultTab(search));

test('four tabs in the order the person works: My work, All tasks, Reports, Settings', () => {
  assert.deepEqual(TASK_TABS.map((k) => TAB_LABELS[k]), ['My work', 'All tasks', 'Reports', 'Settings']);
});

test('the plain address is My work; the tab names the address knows open their tab, any case', () => {
  assert.equal(open(''), 'work');
  assert.equal(open('?tab=all'), 'all');
  assert.equal(open('?tab=Reports'), 'reports');
  assert.equal(open('?tab=settings'), 'settings');
  assert.equal(open('?tab=nonsense'), 'work', 'a tab nobody has is the default');
});

test('every name the old strip used still opens the tab that holds its content (board -> All tasks, my-tasks and mine -> My work, sla -> Settings, report -> Reports)', () => {
  assert.equal(open('?tab=board'), 'all');
  assert.equal(open('?tab=my-tasks'), 'work');
  assert.equal(open('?tab=mine'), 'work');
  assert.equal(open('?tab=sla'), 'settings');
  assert.equal(open('?tab=report'), 'reports');
  assert.equal(open('?tab=reports'), 'reports');
  for (const target of Object.values(TAB_ALIASES)) assert.ok(TASK_TABS.indexOf(target) >= 0, `${target} is a tab`);
});

test('an old board link with no ?tab= opens All tasks on the same filters (the board used to be the first tab); a tab named in the address wins', () => {
  for (const link of ['?status=In%20Progress&priority=High&sort=due_date:asc&view=kanban', '?mine=1', '?owner=1&size=25&page=2', '?q=vpn', '?quick=overdue', '?view=board', '?open=12', '?group=owner']) {
    assert.equal(open(link), 'all', link);
  }
  const old = pageOf(readAddress(REGISTER_SCHEMA, '?owner=1&size=25&page=2') as RegisterAddress);
  assert.deepEqual([old.filters.owner, old.size, old.page], [['1'], 25, 2], 'and the register reads those filters as it always did');
  assert.equal(open('?tab=work&status=Open'), 'work', 'a tab in the address wins over the register parameters left in it');
  assert.equal(open('?tab=my-tasks&mine=1'), 'work');
  assert.equal(open('?tab=reports&status=Open'), 'reports');
  assert.equal(open('?from=notification'), 'work', 'a parameter that is not the register\'s is no board link');
});

test('every parameter of the register decides, and only those', () => {
  for (const name of REGISTER_PARAMS) assert.equal(defaultTab(`?${name}=1`), 'all', name);
  assert.ok(['q', 'status', 'priority', 'due', 'quick', 'sort', 'page', 'size', 'view', 'group', 'open', 'mine'].every((n) => REGISTER_PARAMS.indexOf(n) >= 0));
  assert.equal(REGISTER_PARAMS.indexOf('tab'), -1, 'the tab itself is not a register parameter');
});

test('picking a tab writes the address the kit writes: the default tab has the plain address, the others ?tab=, the other parameters stay', () => {
  assert.equal(withTab('', 'tab', 'work', defaultTab('')), '');
  assert.equal(withTab('', 'tab', 'all', defaultTab('')), 'tab=all');
  assert.equal(withTab('tab=all&status=Open', 'tab', 'work', defaultTab('tab=all&status=Open')), 'tab=work&status=Open', 'My work is explicit while the board\'s parameters are in the address');
  assert.equal(withTab('status=Open', 'tab', 'all', defaultTab('status=Open')), 'status=Open', 'an old board link needs no tab to be All tasks');
});

test('a link into All tasks is written the way the register reads it', () => {
  assert.equal(tasksHref('work'), '/tasks');
  assert.equal(tasksHref('reports'), '/tasks?tab=reports');
  assert.equal(tasksHref('all', { quick: 'mine', due: ['overdue'] }), '/tasks?tab=all&quick=mine&due=overdue');
  const link = tasksHref('all', { quick: 'mine', due: ['today', 'week'], owner: [] });
  assert.equal(link, '/tasks?tab=all&quick=mine&due=today%2Cweek', 'a list is one comma-separated value; an empty one is left out');
  const page = pageOf(readAddress(REGISTER_SCHEMA, link.slice(link.indexOf('?'))) as RegisterAddress);
  assert.deepEqual([page.filters.quick, page.filters.due], ['mine', ['today', 'week']]);
});
