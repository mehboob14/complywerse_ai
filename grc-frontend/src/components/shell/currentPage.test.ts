// node --test src/components/shell/currentPage.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanQuery, shortcutFor } from './currentPage.ts';

test('a page with a name of its own is kept by that name, its module as the second line, and the view in its address', () => {
  assert.deepEqual(shortcutFor('/governance/committees', '', null), { label: 'Committees', href: '/governance/committees', sub: 'Governance' });
  assert.deepEqual(shortcutFor('/governance/documents', '?status=pending_review&q=remote', null), { label: 'Documents', href: '/governance/documents?status=pending_review&q=remote', sub: 'Governance' });
  assert.equal(shortcutFor('/governance', '', null)?.label, 'Governance Overview', 'the title where the label would not do on its own');
  assert.equal(shortcutFor('/vendor-risk/intake', '', null)?.sub, 'Third-Party Vendor Risk');
});

test('a page named like its area is kept once: no second line that repeats its name', () => {
  assert.deepEqual(shortcutFor('/admin', '', null), { label: 'Administration', href: '/admin', sub: undefined });
  assert.equal(shortcutFor('/complychat', '', null)?.sub, undefined);
  assert.equal(shortcutFor('/complychat', '', null)?.label, 'Comply Agent');
});

test('how a page was opened is not where it is: from, act, item and the like are dropped; a very long query is not kept', () => {
  assert.equal(cleanQuery('?status=draft&from=%2Fneeds-my-action&act=sign&item=a%3Ab'), '?status=draft');
  assert.equal(cleanQuery('?from=%2Fx'), '');
  assert.equal(cleanQuery(''), '');
  assert.equal(cleanQuery(null), '');
  assert.equal(cleanQuery(`?q=${'x'.repeat(300)}`), '');
  assert.equal(shortcutFor('/governance/committees', '?from=%2Fneeds-my-action', null)?.href, '/governance/committees');
});

test('a record page is kept by the record\'s own name and its path alone; with no name yet it is not kept', () => {
  const kept = shortcutFor('/governance/documents/44', '?tab=lifecycle', ' Remote   Work Policy ');
  assert.deepEqual(kept, { label: 'Remote Work Policy', href: '/governance/documents/44', sub: 'Document' });
  assert.equal(shortcutFor('/governance/documents/44', '', null), null);
  assert.equal(shortcutFor('/governance/documents/44', '', '   '), null);
  assert.equal(shortcutFor('/governance/committees/3', '', 'Audit Committee')?.sub, 'Committee');
});

test('the home page, the queue (always on the rail), a forward and a path that is no page are not kept', () => {
  assert.equal(shortcutFor('/dashboard', '', null), null);
  assert.equal(shortcutFor('/needs-my-action', '', null), null);
  assert.equal(shortcutFor('/governance/approvals', '', null), null, 'the old address of the queue');
  assert.equal(shortcutFor('/nowhere', '', 'x'), null);
  assert.equal(shortcutFor(null, '', 'x'), null);
});
