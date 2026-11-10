// node --test "src/app/(dashboard)/vendor-risk/_lib/contracts/contractsModel.test.ts"
// The Contracts page's model and the drawer's form: the inbox is what the server calls lapsed, decide or ending; the four views keep what they say; the address reads what a reminder links
// to (`?contract=7`); a form becomes the payload a save sends, the clauses apart from the terms; a history row is said in words with the day as written.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { sortRows, type SortState } from '../../../../../components/ui/ds/tableModel.ts';
import { CONTRACT_SCHEMA, filterContracts, inboxOf, sortValue, typesOf, viewCounts } from './contractsModel.ts';
import { EMPTY, applySuggestions, changedPayload, describe, noticeBy, split, toForm, toPayload } from './contractForm.ts';
import { countdown, money, type ContractRow, type ContractState, type HistoryRow } from './shared.ts';

let id = 0;
const contract = (over: Partial<ContractRow>): ContractRow => ({
  id: ++id, vendor: { id: 1, name: `Supplier ${id}`, tier: 'high', owner_id: null }, title: `Contract ${id}`, contract_type: 'master', type_label: 'Master agreement', status: 'active', state: 'in_force',
  effective_date: null, renewal_date: null, expiry_date: null, ends_on: null, act_by: null, days_left: null, reference: null, record_link: null, renewal_type: null, notice_days: null,
  annual_value: null, currency: null, billing: null, pricing: null, termination: null, terms: null, evidence_id: null, assessment_id: null, engagement_id: null, row_version: 1,
  right_to_audit: null, subprocessor_terms: null, exit_data_return: null, security_addendum: null, breach_notification_hours: null, ...over,
});
const items = [
  contract({ state: 'lapsed', vendor: { id: 1, name: 'Acme', tier: 'high', owner_id: null }, contract_type: 'dpa', type_label: 'Data processing agreement', ends_on: '2026-10-01' }),
  contract({ state: 'decide', vendor: { id: 2, name: 'Beta', tier: null, owner_id: null }, ends_on: '2026-12-01', annual_value: 5000 }),
  contract({ state: 'ending' }), contract({ state: 'in_force', reference: 'PO-77' }), contract({ state: 'draft' }), contract({ state: 'ended', title: null }),
];

test('the inbox is what the server calls past its date, decide now or ending soon, in the order it sent them', () => {
  assert.deepEqual(inboxOf(items).map((c) => c.state), ['lapsed', 'decide', 'ending']);
});

test('each view keeps its states; the type and the search narrow them, in the supplier, the title, the reference and the type', () => {
  const at = (view: 'current' | 'draft' | 'ended' | 'all', type = '', q = '') => filterContracts(items, { view, type, q }).map((c) => c.state);
  assert.deepEqual(at('current'), ['lapsed', 'decide', 'ending', 'in_force']);
  assert.deepEqual(at('draft'), ['draft']);
  assert.deepEqual(at('ended'), ['ended']);
  assert.equal(at('all').length, 6);
  assert.deepEqual(at('all', 'dpa'), ['lapsed']);
  assert.deepEqual(at('all', '', 'acme'), ['lapsed']);
  assert.deepEqual(at('all', '', 'po-77'), ['in_force']);
  assert.deepEqual(at('all', '', 'data processing'), ['lapsed']);
  assert.deepEqual(typesOf(items), ['dpa', 'master']);
});

test('the view counts are the server\'s counts, not the length of what is loaded', () => {
  const counts: Record<ContractState, number> = { lapsed: 1, decide: 2, ending: 3, in_force: 40, draft: 5, ended: 60 };
  assert.deepEqual(viewCounts(counts), { current: 46, draft: 5, ended: 60, all: 111 });
  assert.equal(viewCounts(undefined), null, 'no counts: nothing is claimed');
});

test('the address: a reminder\'s ?contract=7 opens that contract; a view, a type, a search and a sort are written back, and the plain address is the default', () => {
  const s = readAddress(CONTRACT_SCHEMA, '?contract=7&view=ended&type=dpa&q=acme&sort=ends:desc');
  assert.deepEqual([s.contract, s.view, s.type, s.q, s.sort], [7, 'ended', 'dpa', 'acme', { key: 'ends', dir: 'desc' }]);
  assert.equal(readAddress(CONTRACT_SCHEMA, '?contract=abc&view=nonsense').contract, 0, 'junk is the default');
  assert.equal(readAddress(CONTRACT_SCHEMA, '?view=nonsense').view, 'current');
  assert.equal(writeAddress(CONTRACT_SCHEMA, '?contract=7', { ...s, contract: 0, view: 'current', type: '', q: '', page: 1, sort: null }), '');
});

test('a column sorts by what it shows; a contract with nothing there is last whichever way', () => {
  const ends = (dir: 'asc' | 'desc') => sortRows(items, { key: 'ends', dir } as SortState, sortValue).map((c) => c.ends_on);
  assert.deepEqual(ends('asc').slice(0, 2), ['2026-10-01', '2026-12-01']);
  assert.deepEqual(ends('desc').slice(0, 2), ['2026-12-01', '2026-10-01']);
  assert.equal(ends('desc')[5], null);
  assert.deepEqual(sortRows(items, { key: 'state', dir: 'asc' }, sortValue).map((c) => c.state), ['lapsed', 'decide', 'ending', 'in_force', 'draft', 'ended']);
  assert.equal(sortValue(items[5], 'contract'), 'Master agreement', 'no title: the type');
});

test('a form is the text of a contract, and a save sends only what changed, the clauses apart from the terms', () => {
  const c = contract({ title: 'MSA', effective_date: '2026-01-01T00:00:00', expiry_date: '2027-01-01', annual_value: 1200, currency: 'USD', pricing: { unit_price: 9, uplift: true }, right_to_audit: true, breach_notification_hours: 24 });
  const form = toForm(c);
  assert.equal(form.effective_date, '2026-01-01');
  assert.deepEqual([form.uplift, form.unit_price, form.right_to_audit, form.subprocessor_terms], ['yes', '9', 'yes', '']);
  assert.deepEqual(changedPayload(form, form), {}, 'nothing changed, nothing to save');
  const next = { ...form, title: 'Master agreement', right_to_audit: 'no' as const, breach_notification_hours: '48', currency: 'eur' };
  const changed = changedPayload(next, form);
  assert.deepEqual(Object.keys(changed).sort(), ['breach_notification_hours', 'currency', 'right_to_audit', 'title']);
  const { clauses, terms } = split(changed);
  assert.deepEqual(clauses, { right_to_audit: false, breach_notification_hours: 48 });
  assert.deepEqual(terms, { title: 'Master agreement', currency: 'EUR' });
  assert.deepEqual(toPayload(EMPTY).pricing, null);
  assert.equal(toPayload({ ...EMPTY, notice_days: '30' }).notice_days, 30);
});

test('what the AI read from the signed copy fills the form and names the fields it filled; a field the form does not have is not made up', () => {
  const { form, keys } = applySuggestions(EMPTY, { title: 'Master agreement', notice_days: 60, pricing: { unit_price: 12, uplift: true }, nonsense: 'x' });
  assert.deepEqual([form.title, form.notice_days, form.unit_price, form.uplift], ['Master agreement', '60', '12', 'yes']);
  assert.deepEqual(keys.sort(), ['notice_days', 'title', 'unit_price', 'uplift']);
  assert.equal(EMPTY.title, '', 'the form it was given is not changed');
  assert.deepEqual(applySuggestions(EMPTY, {}).keys, []);
});

test('the last day to give notice is the earlier of the renewal and end dates, less the notice days', () => {
  assert.equal(noticeBy({ renewal_date: '', expiry_date: '', notice_days: '30' }), null);
  assert.equal(noticeBy({ renewal_date: '2027-03-31', expiry_date: '2027-06-30', notice_days: '30' }), '2027-03-01');
  assert.equal(noticeBy({ renewal_date: '', expiry_date: '2027-06-30', notice_days: '' }), '2027-06-30');
});

test('a history row is a sentence with the day as written, never an id or a raw timestamp', () => {
  const row = (over: Partial<HistoryRow>): HistoryRow => ({ id: 1, entity: 'contract', action: 'update', by: 'Ada', from_value: null, to_value: null, reason: null, changes: null, at: '2026-11-10T09:00:00', ...over });
  assert.equal(describe(row({ action: 'create' })), 'Added');
  assert.equal(describe(row({ action: 'renew', from_value: '2026-12-31', to_value: '2027-12-31' })), 'Renewed: now runs to 31 Dec 2027 (was 31 Dec 2026)');
  assert.equal(describe(row({ changes: { expiry_date: ['2026-12-31T00:00:00', '2027-12-31T00:00:00'], notice_days: [30, 60] } })), 'Changed end date 31 Dec 2026 → 31 Dec 2027; notice 30 days → 60 days');
  assert.equal(describe(row({ entity: 'obligation', action: 'delete' })), 'Obligation removed');
  assert.equal(describe(row({ action: 'attach_file', reason: 'signed.pdf' })), 'Signed copy attached: signed.pdf');
});

test('money and the clock say what the Contracts page always said, the same for every viewer', () => {
  assert.equal(money(1234567, 'USD'), '$1,234,567');
  assert.equal(money(null, 'USD'), '—');
  assert.equal(countdown({ state: 'lapsed', days_left: -3, notice_days: null, renewal_type: 'auto', act_by: '2026-11-07', ends_on: '2026-11-07' }), 'Renewal date passed 3 days ago');
  assert.equal(countdown({ state: 'decide', days_left: 10, notice_days: 30, renewal_type: 'manual', act_by: '2026-11-20', ends_on: '2026-12-20' }), 'Give notice within 10 days');
});
