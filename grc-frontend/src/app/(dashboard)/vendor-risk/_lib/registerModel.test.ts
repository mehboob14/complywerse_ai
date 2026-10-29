// node --test "src/app/(dashboard)/vendor-risk/_lib/registerModel.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyParamsPatch } from '../_ui/urlParams.ts';
import { ATTENTION, attentionTone } from './attention.ts';
import {
  CLEAR_FILTERS, COLUMNS, PAGE_SIZE, ariaSort, asDay, classificationTone, columnCount, defaultColumns, filterPatch, hasFilters, isPast, isTiered,
  listParams, nextActionCell, nextSort, parseColumns, readState, sortPatch, tierHref, toggleColumn, vendorSubline, websiteHref,
  type Sort,
} from './registerModel.ts';

const reader = (query: string) => {
  const p = new URLSearchParams(query);
  return { get: (k: string) => p.get(k), getAll: (k: string) => p.getAll(k) };
};

test('an empty address is the whole register in the server\'s own order, page 1', () => {
  const s = readState(reader(''));
  assert.deepEqual(s, {
    q: '', attention: [], tier: [], status: [], type: null, owner: null, pii: false, unit: [], archived: false,
    sort: { key: null, dir: 'asc' }, page: 1,
  });
  assert.equal(hasFilters(s), false);
});

test('the address names every filter, the sort and the page', () => {
  const s = readState(reader('q=cloud&attention=not_tiered&attention=no_owner&tier=high&tier=critical&status=active&type=SaaS&owner=me&pii=1&unit=3&unit=5&archived=1&sort=grade&dir=desc&page=3'));
  assert.deepEqual(s, {
    q: 'cloud', attention: ['not_tiered', 'no_owner'], tier: ['high', 'critical'], status: ['active'], type: 'SaaS', owner: 'me', pii: true,
    unit: ['3', '5'], archived: true, sort: { key: 'grade', dir: 'desc' }, page: 3,
  });
  assert.equal(hasFilters(s), true);
});

test('what an address cannot mean is left out, never guessed', () => {
  const s = readState(reader('attention=bogus&attention=weak_grade&tier=extreme&owner=someone&unit=abc&unit=7&sort=colour&dir=desc&page=abc&type=%20'));
  assert.deepEqual(s.attention, ['weak_grade']);
  assert.deepEqual(s.tier, []);
  assert.equal(s.owner, null);
  assert.deepEqual(s.unit, ['7']);
  assert.deepEqual(s.sort, { key: null, dir: 'asc' });                 // a direction without a column is no sort
  assert.equal(s.page, 1);
  assert.equal(s.type, null);
  assert.equal(readState(reader('page=-4')).page, 1);
  assert.equal(readState(reader('owner=12')).owner, '12');
  assert.equal(readState(reader('owner=unassigned')).owner, 'unassigned');
  assert.deepEqual(readState(reader('tier=high&tier=high')).tier, ['high']);
});

test('a header click goes ascending, then descending, then back to the server\'s order; another column starts again', () => {
  let sort: Sort = { key: null, dir: 'asc' };
  sort = nextSort(sort, 'tier');
  assert.deepEqual(sort, { key: 'tier', dir: 'asc' });
  sort = nextSort(sort, 'tier');
  assert.deepEqual(sort, { key: 'tier', dir: 'desc' });
  sort = nextSort(sort, 'tier');
  assert.deepEqual(sort, { key: null, dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'tier', dir: 'desc' }, 'owner'), { key: 'owner', dir: 'asc' });
  assert.equal(ariaSort({ key: 'tier', dir: 'asc' }, 'tier'), 'ascending');
  assert.equal(ariaSort({ key: 'tier', dir: 'desc' }, 'tier'), 'descending');
  assert.equal(ariaSort({ key: 'tier', dir: 'desc' }, 'grade'), 'none');
});

test('a sort and a change of filter write the address, and the filter returns to page 1', () => {
  const at = (search: string, patch: ReturnType<typeof filterPatch>) => applyParamsPatch(search, patch);
  assert.equal(at('page=4&tier=high', filterPatch({ tier: ['high', 'low'] })), 'tier=high&tier=low');
  assert.equal(at('page=4&tier=high', filterPatch({ tier: [] })), '');
  assert.equal(at('', filterPatch({ pii: true })), 'pii=1');
  assert.equal(at('pii=1&page=2', filterPatch({ pii: false })), '');
  assert.equal(at('', filterPatch({ owner: 'unassigned', type: 'SaaS' })), 'type=SaaS&owner=unassigned');
  assert.equal(at('type=SaaS', filterPatch({ type: null })), '');
  assert.equal(at('q=old', filterPatch({ q: '  new  ' })), 'q=new');
  assert.equal(at('q=old', filterPatch({ q: '   ' })), '');
  assert.equal(at('', filterPatch({ archived: true })), 'archived=1');
  assert.equal(at('page=2', sortPatch({ key: 'grade', dir: 'desc' })), 'sort=grade&dir=desc');
  assert.equal(at('sort=grade&dir=desc&page=2', sortPatch({ key: null, dir: 'asc' })), '');
  assert.equal(at('', sortPatch({ key: 'owner', dir: 'asc' })), 'sort=owner');
  // a filter change leaves what it does not name (the sort) alone
  assert.equal(at('sort=tier&page=3', filterPatch({ status: ['active'] })), 'sort=tier&status=active');
});

test('Clear filters takes off every filter and the page, and keeps the sort', () => {
  const next = applyParamsPatch('q=a&attention=no_owner&tier=high&status=active&type=x&owner=me&pii=1&unit=2&archived=1&page=3&sort=tier&dir=desc', CLEAR_FILTERS);
  assert.equal(next, 'sort=tier&dir=desc');
});

test('the server is asked for one page in the sort the address names, risk order without one', () => {
  assert.deepEqual(listParams(readState(reader(''))), {
    search: undefined, tier: undefined, status: undefined, attention: undefined, vendor_type: undefined, owner: undefined,
    holds_personal_data: undefined, business_unit_id: undefined, archived_only: undefined, sort: 'risk', dir: 'asc', skip: 0, limit: PAGE_SIZE,
  });
  assert.deepEqual(listParams(readState(reader('q=x&tier=high&attention=not_tiered&type=SaaS&owner=unassigned&pii=1&unit=4&unit=9&archived=1&sort=owner&dir=desc&page=3'))), {
    search: 'x', tier: ['high'], status: undefined, attention: ['not_tiered'], vendor_type: 'SaaS', owner: 'unassigned',
    holds_personal_data: true, business_unit_id: [4, 9], archived_only: true, sort: 'owner', dir: 'desc', skip: 2 * PAGE_SIZE, limit: PAGE_SIZE,
  });
});

test('the columns: Verity\'s by default, Compliverse\'s own one click away, the two that matter never hidden', () => {
  assert.deepEqual(defaultColumns(), ['vendor', 'tier', 'status', 'next_action', 'grade', 'owner', 'next_reassessment']);
  assert.ok(COLUMNS.filter((c) => !c.shown).map((c) => c.id).includes('risk_rating'));
  assert.deepEqual(toggleColumn(defaultColumns(), 'contract_end'), ['vendor', 'tier', 'status', 'next_action', 'grade', 'owner', 'next_reassessment', 'contract_end']);
  assert.deepEqual(toggleColumn(defaultColumns(), 'tier'), ['vendor', 'status', 'next_action', 'grade', 'owner', 'next_reassessment']);
  assert.deepEqual(toggleColumn(defaultColumns(), 'vendor'), defaultColumns());                // the vendor and the next action stay
  assert.deepEqual(toggleColumn(defaultColumns(), 'next_action'), defaultColumns());
  assert.deepEqual(toggleColumn(['vendor', 'next_action'], 'business_unit'), ['vendor', 'next_action', 'business_unit']);
});

test('a stored column pick is read back in the table\'s order, and anything unreadable is the default', () => {
  assert.deepEqual(parseColumns(JSON.stringify(['grade', 'tier', 'bogus'])), ['vendor', 'tier', 'next_action', 'grade']);
  assert.deepEqual(parseColumns(JSON.stringify([])), ['vendor', 'next_action']);                // hiding every optional one is a choice
  assert.deepEqual(parseColumns(null), defaultColumns());
  assert.deepEqual(parseColumns(''), defaultColumns());
  assert.deepEqual(parseColumns('not json'), defaultColumns());
  assert.deepEqual(parseColumns('{"a":1}'), defaultColumns());
  assert.deepEqual(parseColumns('[1,2]'), defaultColumns());
  const optional = COLUMNS.filter((c) => !c.always).length;
  assert.deepEqual(columnCount(defaultColumns()), { shown: 5, total: optional });
  assert.deepEqual(columnCount(COLUMNS.map((c) => c.id)), { shown: optional, total: optional });
});

test('the blocker cell says the server\'s next action in its colour, or that nothing is outstanding, or that the vendor is archived', () => {
  assert.deepEqual(nextActionCell({ next_action: { code: 'reassessment_overdue', label: 'Reassessment overdue', link: '/vendor-risk/vendors/4?stage=reassessment' } }),
    { kind: 'action', label: 'Reassessment overdue', href: '/vendor-risk/vendors/4?stage=reassessment', tone: 'danger' });
  assert.equal(nextActionCell({ next_action: { code: 'no_owner', label: 'No owner', link: '/x' } }).tone, 'warning');
  assert.equal(nextActionCell({ next_action: { code: 'awaiting_approval', label: 'Awaiting approval', link: '/x' } }).tone, 'progress');
  assert.deepEqual(nextActionCell({ next_action: null }), { kind: 'none', label: 'Nothing outstanding', href: null, tone: 'success' });
  assert.deepEqual(nextActionCell({}), { kind: 'none', label: 'Nothing outstanding', href: null, tone: 'success' });
  assert.equal(nextActionCell({ archived_at: '2026-03-01T10:00:00', next_action: null }).kind, 'archived');
  assert.equal(attentionTone('something new'), 'neutral');          // a code this page does not know is grey, not a guess
  assert.deepEqual(ATTENTION.map((a) => a.code), ['suspended', 'reassessment_overdue', 'not_tiered', 'awaiting_approval', 'response_to_review',
    'documents_expired', 'weak_grade', 'no_owner', 'reassessment_due', 'offboarding']);
});

test('a vendor is tiered when it has a score, not because it carries a default tier word', () => {
  assert.equal(isTiered({ inherent_risk_score: 61.5 }), true);
  assert.equal(isTiered({ inherent_risk_score: 0 }), true);
  assert.equal(isTiered({ inherent_risk_score: null }), false);
  assert.equal(isTiered({}), false);
});

test('a day picked on a form reads as that day; a computed moment stays a moment', () => {
  assert.equal(asDay('2027-01-31T00:00:00'), '2027-01-31');
  assert.equal(asDay('2027-01-31T00:00:00.000000'), '2027-01-31');
  assert.equal(asDay('2027-01-31'), '2027-01-31');
  assert.equal(asDay('2026-10-26T16:53:24.698730'), '2026-10-26T16:53:24.698730');
  assert.equal(asDay(''), null);
  assert.equal(asDay(null), null);
  assert.equal(asDay(undefined), null);
});

test('classification colours, sub-lines, links and dates', () => {
  assert.equal(classificationTone('Restricted'), 'danger');
  assert.equal(classificationTone('confidential'), 'warning');
  assert.equal(classificationTone('internal'), 'neutral');
  assert.equal(classificationTone(null), 'neutral');
  assert.equal(vendorSubline({ vendor_type: 'Software as a service', industry: 'Payroll' }), 'Software as a service · Payroll');
  assert.equal(vendorSubline({ vendor_type: null, industry: ' Payroll ' }), 'Payroll');
  assert.equal(vendorSubline({}), '');
  assert.equal(tierHref(7), '/vendor-risk/vendors/7?tab=lifecycle&tier=1');
  assert.equal(websiteHref('corebank.example'), 'https://corebank.example');
  assert.equal(websiteHref('http://x.example/a'), 'http://x.example/a');
  assert.equal(websiteHref(' '), null);
  assert.equal(websiteHref(null), null);
  const today = new Date(2026, 2, 10);
  assert.equal(isPast('2026-03-09', today), true);
  assert.equal(isPast('2026-03-10', today), false);
  assert.equal(isPast('2026-04-01', today), false);
  assert.equal(isPast(null, today), false);
});
