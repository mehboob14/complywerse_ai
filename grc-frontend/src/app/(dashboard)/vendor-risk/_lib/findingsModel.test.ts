// node --test "src/app/(dashboard)/vendor-risk/_lib/findingsModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyParamsPatch } from '../_ui/urlParams.ts';
import {
  CLEAR_FILTERS, PAGE_SIZE, acceptedLine, asScope, blockingLine, dueView, emptyCopy, filterPatch, hasFilters, isOpen, listParams, readFilters,
  rowHref, sourceLabel, vendorHref,
} from './findingsModel.ts';

const reader = (query: string) => {
  const p = new URLSearchParams(query);
  return { get: (k: string) => p.get(k) };
};

test('the register opens on Open findings, page 1, unfiltered', () => {
  const f = readFilters(reader(''));
  assert.deepEqual(f, { scope: 'open', severity: null, domain: null, overdue: false, page: 1 });
  assert.equal(hasFilters(f), false);
  assert.deepEqual(listParams(f), { scope: 'open', severity: undefined, domain: undefined, overdue_only: undefined, skip: 0, limit: PAGE_SIZE });
});

test('the address names the scope, the filters and the page; what it cannot mean is left out', () => {
  const f = readFilters(reader('scope=accepted&severity=Critical&domain=legal&overdue=1&page=3'));
  assert.deepEqual(f, { scope: 'accepted', severity: 'critical', domain: 'legal', overdue: true, page: 3 });
  assert.equal(hasFilters(f), true);
  assert.deepEqual(listParams(f), { scope: 'accepted', severity: 'critical', domain: 'legal', overdue_only: true, skip: 2 * PAGE_SIZE, limit: PAGE_SIZE });
  const odd = readFilters(reader('scope=everything&severity=extreme&domain=nonsense&page=0'));
  assert.deepEqual(odd, { scope: 'open', severity: null, domain: null, overdue: false, page: 1 });
  assert.equal(asScope('closed'), 'closed');
  assert.equal(asScope(null), 'open');
});

test('a change of scope or filter writes the address and returns to page 1; Open is the default and is not written', () => {
  const at = (search: string, patch: ReturnType<typeof filterPatch>) => applyParamsPatch(search, patch);
  assert.equal(at('page=3', filterPatch({ scope: 'closed' })), 'scope=closed');
  assert.equal(at('scope=closed&page=3', filterPatch({ scope: 'open' })), '');
  assert.equal(at('page=2', filterPatch({ severity: 'high' })), 'severity=high');
  assert.equal(at('severity=high', filterPatch({ severity: null })), '');
  assert.equal(at('', filterPatch({ overdue: true })), 'overdue=1');
  assert.equal(at('overdue=1&page=2', filterPatch({ overdue: false })), '');
  assert.equal(at('scope=all&severity=high&domain=legal&overdue=1&page=4', CLEAR_FILTERS), 'scope=all');     // the view stays
});

test('the line about blocking findings says how many, or nothing', () => {
  assert.equal(blockingLine(3), '3 findings blocking approval');
  assert.equal(blockingLine(1), '1 finding blocking approval');
  assert.equal(blockingLine(0), null);
  assert.equal(blockingLine(undefined), null);                  // a server that does not send it yet
});

test('remediation due is a countdown, red only while the finding is open and late', () => {
  const today = new Date(2026, 2, 10);
  assert.deepEqual(dueView({ due_date: '2026-03-19', status: 'open', overdue: false }, today), { text: 'in 9 days', title: '19 Mar 2026', late: false });
  assert.deepEqual(dueView({ due_date: '2026-02-26', status: 'in_remediation', overdue: true }, today), { text: '12 days ago', title: '26 Feb 2026', late: true });
  assert.equal(dueView({ due_date: '2026-02-26', status: 'closed', overdue: true }, today).late, false);      // done: nothing to chase
  assert.equal(dueView({ due_date: '2026-02-26', status: 'accepted' }, today).late, false);
  assert.equal(dueView({ due_date: '2026-02-26', status: 'open' }, today).late, true);                       // no flag: the date decides
  assert.equal(dueView({ due_date: '2026-03-12', status: 'open', overdue: false }, today).late, false);
  assert.equal(dueView({ due_date: '2026-03-10', status: 'open' }, today).text, 'today');
  assert.deepEqual(dueView({ due_date: null, status: 'open' }, today), { text: '—', title: '', late: false });
  assert.equal(isOpen('open'), true);
  assert.equal(isOpen('in_remediation'), true);
  assert.equal(isOpen('accepted'), false);
});

test('an accepted finding says until when; the source reads in words; a field the server does not send is simply absent', () => {
  assert.equal(acceptedLine({ status: 'accepted', accepted_until: '2026-09-30' }), 'until 30 Sep 2026');
  assert.equal(acceptedLine({ status: 'accepted', accepted_until: null }), null);
  assert.equal(acceptedLine({ status: 'open', accepted_until: '2026-09-30' }), null);
  assert.equal(acceptedLine({ status: 'accepted' }), null);
  assert.deepEqual(['assessment', 'manual', 'sla_breach', 'signal', 'document_review', 'offboarding'].map(sourceLabel),
    ['Assessment', 'Manual', 'SLA breach', 'Signal', 'Document review', 'Offboarding']);
  assert.equal(sourceLabel('something_new'), 'Something new');
  assert.equal(sourceLabel(null), null);
  assert.equal(sourceLabel(undefined), null);
});

test('a row opens the finding on the vendor\'s Findings tab; the vendor name opens the tab', () => {
  assert.equal(rowHref({ vendor_id: 7, id: 31 }), '/vendor-risk/vendors/7?tab=findings&finding=31');
  assert.equal(vendorHref({ vendor_id: 7 }), '/vendor-risk/vendors/7?tab=findings');
});

test('an empty list says whether the view is empty or the filters matched nothing', () => {
  assert.equal(emptyCopy('open', false).title, 'No open findings');
  assert.equal(emptyCopy('accepted', false).title, 'Nothing in this state');
  assert.equal(emptyCopy('open', true).title, 'No findings match these filters');
});
