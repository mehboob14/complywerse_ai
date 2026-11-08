// node --test "src/app/(dashboard)/issues/_overview/forwards.test.ts"
// The old addresses of /issues still land where the thing is now: three tabs became pages, the settings tabs became /issues/settings, the audit-register switch moved to the register, an
// "issues of this record" address filters the register, the SCF record link opens the issue. The Overview itself is not a forward, and a parameter nobody consumed rides along.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { forwardFor } from './forwards.ts';

test('the Overview is not a forward', () => {
  for (const q of ['', '?', '?tab=overview', '?tab=closure', '?tab=nonsense', '?foo=1']) assert.equal(forwardFor(q), null, q);
});

test('the three tabs that became pages go to them (Contract as a filter of the register)', () => {
  assert.equal(forwardFor('?tab=log'), '/issues/register');
  assert.equal(forwardFor('?tab=contract'), '/issues/register?category=contract');
  assert.equal(forwardFor('?tab=capa'), '/issues/actions');
});

test('the settings tabs go to the settings page (the automation tab to its section)', () => {
  assert.equal(forwardFor('?tab=severity_matrix'), '/issues/settings');
  assert.equal(forwardFor('?tab=classification_matrix'), '/issues/settings');
  assert.equal(forwardFor('?tab=automation'), '/issues/settings#automation');
});

test('the audit-register tab and switch go to the register, which opens the audit register', () => {
  assert.equal(forwardFor('?tab=register'), '/issues/register?register=audit');
  assert.equal(forwardFor('?tab=register&register=platform'), '/issues/register?register=platform', 'an explicit choice in the address wins');
  assert.equal(forwardFor('?register=audit'), '/issues/register?register=audit');
  assert.equal(forwardFor('?register=audit&source=Internal%20audit'), '/issues/register?register=audit&source=Internal%20audit');
});

test('"the issues of this record" opens the register filtered to that record; an unknown kind or a bad number is no filter', () => {
  assert.equal(forwardFor('?source_type=risk&source_id=7'), '/issues/register?linked=risk:7');
  assert.equal(forwardFor('?source_type=vulnerability&source_id=12&foo=1'), '/issues/register?linked=vulnerability:12&foo=1');
  assert.equal(forwardFor('?source_type=alien&source_id=7'), null);
  assert.equal(forwardFor('?source_type=risk&source_id=abc'), null);
  assert.equal(forwardFor('?source_type=risk'), null);
});

test('the SCF record link (?issue=<id>) opens the issue', () => {
  assert.equal(forwardFor('?issue=41'), '/issues/41');
  assert.equal(forwardFor('?issue=0'), null);
  assert.equal(forwardFor('?issue=abc'), null);
  assert.equal(forwardFor('?issue=41&tab=log'), '/issues/41', 'the record wins over a tab');
});

test('other parameters ride along, and a parameter the target already names is not repeated', () => {
  assert.equal(forwardFor('?tab=log&severity=critical'), '/issues/register?severity=critical');
  assert.equal(forwardFor('?tab=contract&category=privacy'), '/issues/register?category=contract', 'the tab\'s own filter is not overridden');
});
