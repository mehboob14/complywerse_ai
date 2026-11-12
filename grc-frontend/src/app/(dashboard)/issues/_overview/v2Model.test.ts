// node --test "src/app/(dashboard)/issues/_overview/v2Model.test.ts"
// Overview v2 of the Issue & Incident page: what its address keeps, where the graphics open (every address one the registers read), the share a tile's bar draws, and the slim "My work" card.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { issueDef } from '../../../../lib/issues/issueDef.ts';
import { actionDef } from '../../../../lib/issues/actionDef.ts';
import { buildSchema } from '../../../../components/records/registerModel.ts';
import { ADDRESS, LINKS, TRENDS, WORK_ROWS, ageHref, shareOf, shortDue, slimWork, workHead, rowName } from './v2Model.ts';
import type { WorkItem } from './overviewModel.ts';

const NOW = new Date('2026-11-12T12:00:00');

test('the address keeps the trend view, the full work list and the score sheet; the defaults have the plain address', () => {
  assert.deepEqual(readAddress(ADDRESS, ''), { trend: 'flow', work: false, score: false });
  assert.deepEqual(readAddress(ADDRESS, '?trend=backlog&work=1&score=1'), { trend: 'backlog', work: true, score: true });
  assert.deepEqual(readAddress(ADDRESS, '?trend=junk&work=maybe'), { trend: 'flow', work: false, score: false }, 'an address can never put the page in a state it cannot be in');
  assert.equal(writeAddress(ADDRESS, '', { trend: 'flow', work: false, score: false }), '');
  assert.equal(writeAddress(ADDRESS, '?x=1', { trend: 'backlog', work: true, score: false }), 'x=1&trend=backlog&work=1');
  assert.deepEqual([...TRENDS], ['flow', 'backlog']);
});

test('every address a graphic opens is one the register reads: the chip exists, the facet exists, the sort is one of its sorts', () => {
  const issues = buildSchema(issueDef(1));
  const actions = buildSchema(actionDef(1));
  const query = (href: string) => new URLSearchParams(href.split('?')[1]);
  for (const href of [LINKS.open, LINKS.closed, LINKS.owners, ageHref('critical'), ageHref('none')]) {
    assert.ok(href.startsWith('/issues/register'), href);
    const state = readAddress(issues, query(href).toString());
    const q = query(href);
    if (q.has('quick')) assert.equal(state.quick, q.get('quick'), `${href}: the quick chip is one the register has`);
    if (q.has('state')) assert.deepEqual(state.state, [q.get('state')], href);
    if (q.has('severity')) assert.deepEqual(state.severity, [q.get('severity')], href);
    if (q.has('sort')) { const [key, dir] = (q.get('sort') as string).split(':'); assert.deepEqual(state.sort, { key, dir }, `${href}: the sort is one the register has`); }
  }
  assert.equal(readAddress(actions, query(LINKS.lateActions).toString()).quick, 'late');
  assert.equal(LINKS.openIncidents, '/erm/incidents?quick=open');
  assert.equal(ageHref('critical'), '/issues/register?quick=open&severity=critical&sort=created:asc');
});

test('a share for a bar: a whole percent, never made of nothing', () => {
  assert.equal(shareOf(48, 68), 71);
  assert.equal(shareOf(0, 10), 0);
  assert.equal(shareOf(5, 0), null, 'nothing open is not 0%');
  assert.equal(shareOf(null, 10), null);
  assert.equal(shareOf(12, 10), 100, 'clamped');
});

const item = (o: Partial<WorkItem> = {}): WorkItem => ({ key: `k${Math.random()}`, kind: 'issue', title: 'T', context: '', href: '/issues/1', due: null, calendar: false, overdue: false, act: { type: 'link', label: 'Open', href: '/issues/1' }, rank: 3, ...o });

test('a due date in one line: the word is always there', () => {
  assert.deepEqual(shortDue(item({ due: '2026-10-23T00:00:00', overdue: true }), NOW), { text: 'Overdue 20d', tone: 'danger' });
  assert.equal(shortDue(item({ due: '2026-11-14T00:00:00', calendar: true }), NOW)?.text, 'Due in 2d');
  assert.equal(shortDue(item({ due: '2026-11-12T00:00:00', calendar: true }), NOW)?.text, 'Due today');
  assert.equal(shortDue(item(), NOW), null, 'no date, no pill');
  assert.equal(shortDue(item({ overdue: true }), NOW)?.tone, 'danger', 'overdue with no date still says so');
});

test('the slim card: three rows, the true count and how many are late, "See all" only when there is more', () => {
  const items = [item({ overdue: true }), item({ overdue: true }), item(), item(), item()];
  const s = slimWork(items, NOW);
  assert.equal(WORK_ROWS, 3);
  assert.equal(s.rows.length, 3);
  assert.deepEqual(s.head, { count: 5, overdue: 2 });
  assert.equal(s.cut, true);
  assert.equal(slimWork(items.slice(0, 3), NOW).cut, false);
  assert.deepEqual(workHead([]), { count: 0, overdue: 0 });
  assert.equal(rowName('Fire exit', { text: 'Overdue 3d' }), 'Fire exit, overdue 3d');
  assert.equal(rowName('Fire exit', null), 'Fire exit');
});
