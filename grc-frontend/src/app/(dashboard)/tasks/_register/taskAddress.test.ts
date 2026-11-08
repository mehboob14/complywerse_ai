// node --test "src/app/(dashboard)/tasks/_register/taskAddress.test.ts"
// The register's address (taskAddress.ts): every link the old board produced still lands on the same filters, the sort and view keep their old words, a junk value is the default, and a
// state written back reads the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { DEFAULT_SORT, NO_FILTERS } from './taskFacets.ts';
import { REGISTER_SCHEMA, filtersPatch, openPatch, pageOf, type RegisterAddress } from './taskAddress.ts';

const page = (search: string) => pageOf(readAddress(REGISTER_SCHEMA, search) as RegisterAddress);

test('the plain address is the default register: everything, newest first, the list, page 1 of 50', () => {
  const p = page('');
  assert.deepEqual(p.filters, NO_FILTERS);
  assert.deepEqual([p.sort, p.view, p.group, p.page, p.size, p.openId], [DEFAULT_SORT, 'list', 'none', 1, 50, null]);
});

test('every link the old board wrote lands on the same filters', () => {
  const old = page('?q=vpn&source=Audit&priority=High&status=In%20Progress&category=Review&owner=7&sort=due_date:asc&page=3&size=25&view=kanban');
  assert.equal(old.filters.search, 'vpn');
  assert.deepEqual([old.filters.source, old.filters.priority, old.filters.status, old.filters.category, old.filters.owner], [['Audit'], ['High'], ['In Progress'], ['Review'], ['7']]);
  assert.deepEqual(old.sort, { key: 'due_date', dir: 'asc' });
  assert.deepEqual([old.page, old.size, old.view], [3, 25, 'board']);
  assert.equal(page('?view=table').view, 'list');
  assert.equal(page('?view=board').view, 'board');
  assert.equal(page('?view=sideways').view, 'list');
  assert.equal(page('?mine=1').filters.quick, 'mine', 'the flag the old address declared is the Mine view');
  assert.equal(page('?mine=1&quick=overdue').filters.quick, 'overdue', 'a quick view of its own wins');
});

test('junk is the default: an unknown sort, a page size the pager does not offer, a quick view nobody has', () => {
  const p = page('?sort=password:asc&size=7&page=zero&quick=everything&group=colour&open=-4');
  assert.deepEqual([p.sort, p.size, p.page, p.filters.quick, p.group, p.openId], [DEFAULT_SORT, 50, 1, null, 'none', null]);
  assert.equal(page('?size=100').size, 100);
  assert.equal(page('?size=75').size, 50, 'a size between the pager\'s is the default');
});

test('lists carry several values and a state written back reads the same', () => {
  const p = page('?status=Open,Under%20Review&owner=3,none&due=overdue&approval=pending&by=1&repeats=repeats&linked=linked&kind=document&sla=breached&reviewer=none&quick=approve&group=owner&open=12');
  assert.deepEqual(p.filters.status, ['Open', 'Under Review']);
  assert.deepEqual(p.filters.owner, ['3', 'none']);
  assert.deepEqual([p.filters.creator, p.filters.reviewer, p.filters.sla, p.filters.kind, p.filters.due, p.filters.approval], [['1'], ['none'], ['breached'], ['document'], ['overdue'], ['pending']]);
  assert.deepEqual([p.group, p.openId, p.filters.quick], ['owner', 12, 'approve']);
  const raw = readAddress(REGISTER_SCHEMA, '?tab=board&status=Open&view=kanban') as RegisterAddress;
  const next = writeAddress(REGISTER_SCHEMA, '?tab=board&status=Open&view=kanban', { ...raw, ...filtersPatch({ ...NO_FILTERS, status: ['Completed'] }), ...openPatch(9) } as never);
  assert.equal(new URLSearchParams(next).get('tab'), 'board', 'the page\'s own params are left alone');
  assert.deepEqual([new URLSearchParams(next).get('status'), new URLSearchParams(next).get('view'), new URLSearchParams(next).get('open')], ['Completed', 'board', '9']);
});

test('a change of filters goes back to page 1 and drops the old mine flag; closing the details clears open', () => {
  const raw = readAddress(REGISTER_SCHEMA, '?mine=1&page=4') as RegisterAddress;
  const patch = filtersPatch({ ...NO_FILTERS, quick: 'overdue' });
  assert.deepEqual([patch.page, patch.mine, patch.quick], [1, false, 'overdue']);
  assert.equal(writeAddress(REGISTER_SCHEMA, '?mine=1&page=4', { ...raw, ...patch } as never), 'quick=overdue');
  assert.equal(openPatch(null).open, 0);
  assert.equal(writeAddress(REGISTER_SCHEMA, '?open=5', { ...(readAddress(REGISTER_SCHEMA, '?open=5') as RegisterAddress), ...openPatch(null) } as never), '');
});
