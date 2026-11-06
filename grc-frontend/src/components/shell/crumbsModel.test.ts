// node --test src/components/shell/crumbsModel.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { navAccessFromMe, navigation, visibleNav } from '../layout/navAccess.ts';
import { litFor } from './railModel.ts';
import { crumbsFor, foldTrail, moduleSwitcher, phoneBlock, type Crumb, type CrumbInput } from './crumbsModel.ts';

const me = (permissions: string[], extra: Record<string, unknown> = {}) => ({
  authenticated: true,
  user: { permissions, allowed_modules: Array.from(new Set(permissions.map((p) => p.split(':')[0]))), is_admin: false, ...extra },
  tenant: { features: ['audit_register'] },
});
const admin = me([], { permissions: ['*:*:*'], allowed_modules: [], is_admin: true });
const reviewer = me(['dashboard:overview:view']);

function trail(who: unknown, pathname: string, extra: Partial<CrumbInput> = {}) {
  const access = navAccessFromMe(who);
  const nav = visibleNav(navigation, access);
  return crumbsFor({ pathname, nav, access, ...extra });
}
const labels = (t: ReturnType<typeof trail>) => t.crumbs.map((c) => c.label + (c.menu ? `▾${c.menu}` : '') + (c.current ? '*' : ''));

test('a page with its own heading keeps the levels above it and not its name (the old "name not twice" rule); the current crumb is last and unlinked', () => {
  const t = trail(admin, '/governance/kpi-report');
  assert.deepEqual(labels(t), ['Governance▾module', 'KPI Report*']);
  assert.equal(t.hideCurrent, true);
  assert.equal(t.crumbs[0].href, '/governance', 'the module opens on its first page');
  assert.equal(t.crumbs[1].href, undefined);
});

test('a page without its own heading shows its whole trail, the name included', () => {
  const t = trail(admin, '/governance/documents/12');
  assert.deepEqual(labels(t), ['Governance▾module', 'Documents', 'Document*']);
  assert.equal(t.hideCurrent, false);
  assert.equal(t.crumbs[1].href, '/governance/documents');
});

test('a committee page names the committee and offers the other committees; a meeting page adds the committee and the meeting, each with its list', () => {
  assert.deepEqual(labels(trail(admin, '/governance/committees/3')), ['Governance▾module', 'Committees', 'Committee▾committee*']);
  const withName = trail(admin, '/governance/committees/3', { records: { committee: { id: 3, name: 'Audit Committee' } } });
  assert.deepEqual(labels(withName), ['Governance▾module', 'Committees', 'Audit Committee▾committee*']);
  assert.equal(withName.hideCurrent, false, 'the switcher keeps the last crumb');
  const meeting = trail(admin, '/governance/committees/meetings/9', { records: { committee: { id: 3, name: 'Audit Committee' }, meeting: { id: 9, number: '3-004', committeeId: 3 } } });
  assert.deepEqual(labels(meeting), ['Governance▾module', 'Committees', 'Audit Committee▾committee', 'Meeting 3-004▾meeting*']);
  assert.equal(meeting.crumbs[2].href, '/governance/committees/3');
  assert.equal(meeting.hideCurrent, false);
  const loading = trail(admin, '/governance/committees/meetings/9');
  assert.deepEqual(labels(loading), ['Governance▾module', 'Committees', 'Meeting*'], 'before the page knows its record: the registry\'s names, no switcher that has nothing to list');
  assert.equal(loading.hideCurrent, true);
});

test('where the page was opened from comes first when it is a page the person may open; anything else is ignored', () => {
  const from = '/needs-my-action?section=ack';
  const t = trail(reviewer, '/governance/documents/5', { from });
  assert.deepEqual(labels(t), ['Needs my action', 'Document*']);
  assert.equal(t.crumbs[0].href, from, 'the way back keeps the view it came from');
  for (const bad of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '/not/a/page', '/governance/documents/5', '/admin', '']) {
    assert.ok(!labels(trail(reviewer, '/governance/documents/5', { from: bad })).includes('Needs my action'), bad || '(empty)');
  }
  assert.deepEqual(labels(trail(admin, '/governance/kpi-report', { from: '/governance/kpi-report' })), ['Governance▾module', 'KPI Report*'], 'a page opened from itself has no origin');
});

test('a level the person has no door to is named and never linked (a reviewer on a document without the library)', () => {
  const t = trail(reviewer, '/governance/documents/5');
  assert.deepEqual(labels(t), ['Governance', 'Documents', 'Document*']);
  assert.ok(t.crumbs.every((c) => c.href === undefined), 'no link leads to a page they cannot open');
  assert.equal(t.crumbs[0].menu, undefined, 'and no switcher lists pages they do not have');
});

test('a top-level page of a module with one page has no module crumb to switch; unknown paths have no trail', () => {
  const tasks = trail(admin, '/tasks');
  assert.deepEqual(labels(tasks), ['Task Management*']);
  assert.equal(tasks.hideCurrent, true);
  assert.deepEqual(trail(admin, '/nowhere').crumbs, []);
  assert.deepEqual(trail(admin, null as unknown as string).crumbs, []);
  assert.equal(trail(admin, '/nowhere').hideCurrent, false);
});

test('the module switcher lists the module\'s pages on this person\'s menu and marks the lit one', () => {
  const access = navAccessFromMe(admin);
  const nav = visibleNav(navigation, access);
  const list = moduleSwitcher(nav, litFor(nav, '/governance/committees/4'));
  assert.deepEqual(list.map((l) => l.label), ['Overview', 'Documents', 'Committees', 'KRIs', 'KPI Report', 'Projects']);
  assert.deepEqual(list.filter((l) => l.current).map((l) => l.label), ['Committees']);
  assert.deepEqual(moduleSwitcher(nav, undefined), []);
  assert.deepEqual(moduleSwitcher(nav, litFor(nav, '/tasks')), [], 'a page that stands alone has no siblings');
  const ro = visibleNav(navigation, navAccessFromMe(me(['governance:committees:view', 'governance:policies:view'])));
  assert.deepEqual(moduleSwitcher(ro, litFor(ro, '/governance/committees')).map((l) => l.label), ['Overview', 'Documents', 'Committees'], 'only the pages they have (the policies right opens the Overview too)');
});

test('a phone\'s one-block bar: the way up over the page you are on, the up link being the nearest crumb that is a page', () => {
  const t = trail(admin, '/governance/documents/12');
  const block = phoneBlock(t);
  assert.equal(block.here?.label, 'Document');
  assert.equal(block.up?.label, 'Documents');
  assert.equal(block.up?.href, '/governance/documents');
  const top = phoneBlock(trail(admin, '/tasks'));
  assert.equal(top.up, undefined);
  assert.equal(top.here?.label, 'Task Management');
  const none = phoneBlock(trail(reviewer, '/governance/documents/5'));
  assert.equal(none.up, undefined, 'no level they can open: no link up');
});

test('a long trail keeps its first level and its last two and folds the middle into one menu; a short one is drawn whole', () => {
  const mk = (n: number): Crumb[] => Array.from({ length: n }, (_, i) => ({ label: `L${i + 1}`, href: `/l${i + 1}` }));
  assert.equal(foldTrail(mk(3)).length, 3);
  assert.equal(foldTrail(mk(4)).length, 4);
  const five = foldTrail(mk(6));
  assert.equal(five.length, 4);
  assert.deepEqual(five.map((s) => ('crumb' in s ? s.crumb.label : `…${s.folded.map((c) => c.label).join('+')}`)), ['L1', '…L2+L3+L4', 'L5', 'L6']);
  assert.deepEqual(foldTrail([]), []);
});
