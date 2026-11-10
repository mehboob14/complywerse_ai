// node --test "src/app/(dashboard)/vendor-risk/_lib/findingsModel.test.ts"
// The Findings register's decisions: the address (old links keep working), which findings pass, the live counts of the facet rail held to a plain filter, the sort, the words of a row and the CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { countMatching, countOf, evaluate } from '../../../../components/records/facetEngine.ts';
import {
  DEFAULT_SORT, FINDINGS_SCHEMA, NO_ENGAGEMENT, NO_FILTERS, NO_OWNER, QUICK_IDS, QUICK_LABEL, acceptedLine, asScope, chosenOf, csvOf, dueView, emptyCopy, exportName, filterChips, filterCount,
  filtersPatch, headLine, inQuick, indexFindings, isBlocking, isLate, orderedOptions, pageOf, railOptions, removeChip, ruleOf, searchTerms, sortFindings, toggleFacet, type AddressState,
  type Filters, type RegisterFinding,
} from './findingsModel.ts';

const row = (id: number, over: Partial<RegisterFinding> = {}): RegisterFinding => ({
  id, vendor_id: 1, vendor_name: 'Acme Cloud', assessment_id: 1, domain: 'cybersecurity', severity: 'medium', title: `Finding ${id}`, status: 'open', is_critical_control_fail: false, due_date: null, overdue: false,
  created_at: '2026-03-01T09:00:00', owner: null, is_blocking: false, source: 'manual', accepted_until: null, task_id: null, sla_due: null, engagement: null, ...over,
});

const ROWS: RegisterFinding[] = [
  row(1, { severity: 'critical', is_blocking: true, owner: { id: 7, name: 'Ana Analyst' }, due_date: '2026-03-10T00:00:00', overdue: true, status: 'in_remediation' }),
  row(2, { severity: 'high', vendor_id: 2, vendor_name: 'Payroll Co', owner: { id: 8, name: 'Olu Owner' }, due_date: '2026-03-20T00:00:00', source: 'assessment', engagement: { id: 5, name: 'Payroll run' } }),
  row(3, { severity: 'medium', vendor_id: 2, vendor_name: 'Payroll Co', domain: 'data_privacy' }),
  row(4, { severity: 'low', status: 'accepted', accepted_until: '2031-06-30', owner: { id: 7, name: 'Ana Analyst' }, source: 'document_review' }),
  row(5, { severity: 'high', status: 'closed', source: 'sla_breach', vendor_id: 3, vendor_name: 'Core Bank' }),
];

const filters = (over: Partial<Filters> = {}): Filters => ({ ...NO_FILTERS, ...over });
const ids = (f: Filters, me: number | null = 7) => evaluate(indexFindings(ROWS), chosenOf(f), ruleOf(f, me)).matches.map((r) => r.id);

test('every old link reads as it did: scope, severity, domain, overdue; a state is written back without its defaults', () => {
  const a = readAddress(FINDINGS_SCHEMA, '?scope=closed&severity=critical&domain=data_privacy&overdue=1&page=3');
  assert.equal(a.scope, 'closed');
  assert.deepEqual(a.severity, ['critical']);
  assert.deepEqual(a.domain, ['data_privacy']);
  assert.equal(a.overdue, true);
  const page = pageOf(a as unknown as AddressState);
  assert.deepEqual(page.filters.quick, ['overdue'], 'the old "Overdue only" is the Overdue quick view');
  assert.deepEqual(page.sort, DEFAULT_SORT);
  assert.equal(page.openId, null);
  // a change of filters drops the old flag and keeps the other names of the address (the page number is not ours)
  const back = writeAddress(FINDINGS_SCHEMA, '?page=3', { ...a, ...filtersPatch(page.filters), overdue: false } as never);
  assert.equal(back, 'page=3&scope=closed&severity=critical&domain=data_privacy&quick=overdue');
  assert.deepEqual(readAddress(FINDINGS_SCHEMA, '?scope=junk&severity=huge&sort=nope:up&open=abc').scope, 'open');
  assert.deepEqual(readAddress(FINDINGS_SCHEMA, '?severity=huge').severity, []);
  assert.equal(asScope('accepted'), 'accepted');
  assert.equal(asScope('x'), 'open');
});

test('the scope is the view: open holds open and in remediation, accepted and closed are decisions, all holds everything', () => {
  assert.deepEqual(ids(filters()), [1, 2, 3]);
  assert.deepEqual(ids(filters({ scope: 'accepted' })), [4]);
  assert.deepEqual(ids(filters({ scope: 'closed' })), [5]);
  assert.deepEqual(ids(filters({ scope: 'all' })), [1, 2, 3, 4, 5]);
});

test('the quick views are about work still open, and several at once must all hold', () => {
  assert.deepEqual(QUICK_IDS.map((q) => ROWS.filter((r) => inQuick(q, r, 7)).map((r) => r.id)),
    [[1], [1], [1], [3], [1], [1]]);                                           // blocking, overdue, mine, unowned, critical, fixing
  assert.deepEqual(ids(filters({ quick: ['mine', 'blocking'] })), [1]);
  assert.deepEqual(ids(filters({ quick: ['mine', 'unowned'] })), []);
  assert.deepEqual(ids(filters({ quick: ['mine'] }), null), [], 'nobody known: "Mine" is empty, not everything');
  assert.equal(isBlocking(row(9, { is_blocking: true, status: 'closed' })), false, 'a closed finding no longer holds the gate');
  assert.equal(isLate(row(9, { overdue: true, status: 'accepted' })), false);
  assert.ok(QUICK_IDS.every((q) => QUICK_LABEL[q].length > 2));
});

test('facets: any chosen value in a facet, every facet must pass, a search needs every word', () => {
  assert.deepEqual(ids(filters({ scope: 'all', severity: ['high', 'low'] })), [2, 4, 5]);
  assert.deepEqual(ids(filters({ scope: 'all', severity: ['high'], vendor: ['3'] })), [5]);
  assert.deepEqual(ids(filters({ owner: [NO_OWNER] })), [3]);
  assert.deepEqual(ids(filters({ engagement: [NO_ENGAGEMENT] })), [1, 3]);
  assert.deepEqual(ids(filters({ engagement: ['5'] })), [2]);
  assert.deepEqual(ids(filters({ search: 'payroll high' })), [2], 'every word, in the title, the vendor, the owner, the severity, the domain, the source');
  assert.deepEqual(ids(filters({ search: 'privacy' })), [3]);
  assert.deepEqual(ids(filters({ scope: 'all', search: 'service level' })), [5]);
  assert.deepEqual(searchTerms('  Café  Núñez '), ['cafe', 'nunez']);
});

test('the live counts equal what choosing the option would show, and a facet never empties its own list', () => {
  const index = indexFindings(ROWS);
  const f = filters({ scope: 'all', severity: ['high'] });
  const got = evaluate(index, chosenOf(f), ruleOf(f, 7));
  // the vendor counts honour the severity choice; the severity counts honour the vendors (none chosen), so critical still reads 1
  assert.equal(countOf(got.counts, 'vendor', '2'), 1);
  assert.equal(countOf(got.counts, 'vendor', '3'), 1);
  assert.equal(countOf(got.counts, 'vendor', '1'), 0);
  assert.equal(countOf(got.counts, 'severity', 'critical'), 1);
  for (const [facet, key] of [['vendor', '2'], ['owner', '7'], ['source', 'assessment'], ['domain', 'data_privacy']] as const) {
    const would = { ...f, [facet]: [...(f[facet as 'vendor'] as string[]), key] } as Filters;
    assert.equal(countOf(got.counts, facet, key), countMatching(index, chosenOf(would), ruleOf(would, 7)), `${facet}:${key}`);
  }
  // the scope switch reads its numbers from the engine: open 3, accepted 1, closed 1 whatever scope is on
  const open = evaluate(index, chosenOf(filters()), ruleOf(filters(), 7));
  assert.deepEqual(['open', 'accepted', 'closed'].map((s) => countOf(open.counts, 'scope', s)), [3, 1, 1]);
});

test('the engine agrees with the plain filter on every combination of scope, severity and quick view', () => {
  const plain = (f: Filters, me: number | null) => ROWS.filter((r) => {
    const scopeOk = f.scope === 'all' || (f.scope === 'open' ? r.status === 'open' || r.status === 'in_remediation' : r.status === f.scope);
    return scopeOk && (!f.severity.length || f.severity.includes(r.severity)) && f.quick.every((q) => inQuick(q, r, me));
  }).map((r) => r.id);
  for (const scope of ['open', 'accepted', 'closed', 'all'] as const) for (const severity of [[], ['high'], ['critical', 'low']]) for (const quick of [[], ['unowned'], ['mine', 'critical']] as const) {
    const f = filters({ scope, severity, quick: [...quick] });
    assert.deepEqual(ids(f), plain(f, 7), JSON.stringify(f));
  }
});

test('the options are the ones the findings have, with a nobody and a "the vendor itself" that never vanish', () => {
  const o = railOptions(ROWS);
  assert.deepEqual(o.severity.map((x) => x.value), ['critical', 'high', 'medium', 'low']);
  assert.deepEqual(o.domain.map((x) => x.label), ['Cybersecurity', 'Data Privacy']);
  assert.deepEqual(o.owner.map((x) => x.label), ['Ana Analyst', 'Olu Owner', 'Unassigned']);
  assert.deepEqual(o.vendor.map((x) => x.label), ['Acme Cloud', 'Core Bank', 'Payroll Co']);
  assert.deepEqual(o.source.map((x) => x.label), ['Assessment', 'Document review', 'Manual', 'Service level']);
  assert.deepEqual(o.engagement.map((x) => x.label), ['The vendor itself', 'Payroll run']);
  const none = (v: string) => (v === '9' ? 0 : 1);
  assert.deepEqual(orderedOptions([{ value: '9', label: 'Gone' }, { value: '1', label: 'Here' }], [], none).map((x) => x.value), ['1']);
  assert.deepEqual(orderedOptions([{ value: '9', label: 'Gone' }, { value: '1', label: 'Here' }], ['9'], none).map((x) => x.value), ['9', '1']);
});

test('chips say what is on, and taking one away takes only that', () => {
  const f = filters({ search: 'mfa', severity: ['critical'], quick: ['overdue'], vendor: ['2'] });
  const chips = filterChips(f, railOptions(ROWS));
  assert.deepEqual(chips.map((c) => c.label), ['Search: mfa', 'Overdue', 'Severity: Critical', 'Vendor: Payroll Co']);
  assert.equal(filterCount(f), 4);
  assert.equal(filterCount(NO_FILTERS), 0);
  assert.deepEqual(removeChip(f, chips[1]).quick, []);
  assert.deepEqual(removeChip(f, chips[3]).vendor, []);
  assert.equal(removeChip(f, chips[0]).search, '');
  assert.deepEqual(toggleFacet(f, 'severity', 'high').severity, ['critical', 'high']);
  assert.deepEqual(toggleFacet(f, 'severity', 'critical').severity, []);
});

test('the default sort is the worst first, late before not late, and a tie ends with the newest; nobody and no date come last either way', () => {
  assert.deepEqual(sortFindings(ROWS, DEFAULT_SORT).map((r) => r.id), [1, 2, 5, 3, 4]);       // a dated fix before an undated one of the same severity
  assert.deepEqual(sortFindings(ROWS, { key: 'severity', dir: 'asc' }).map((r) => r.id), [4, 3, 5, 2, 1]);
  assert.deepEqual(sortFindings(ROWS, { key: 'due', dir: 'asc' }).map((r) => r.id), [1, 2, 5, 4, 3]);
  assert.deepEqual(sortFindings(ROWS, { key: 'due', dir: 'desc' }).map((r) => r.id), [2, 1, 5, 4, 3]);
  assert.deepEqual(sortFindings(ROWS, { key: 'owner', dir: 'asc' }).map((r) => r.id), [4, 1, 2, 5, 3]);
  assert.deepEqual(sortFindings(ROWS, { key: 'owner', dir: 'desc' }).map((r) => r.id), [2, 4, 1, 5, 3]);
  assert.deepEqual(sortFindings(ROWS, { key: 'vendor', dir: 'asc' }).map((r) => r.id), [4, 1, 5, 3, 2]);
  assert.deepEqual(ROWS.map((r) => r.id), [1, 2, 3, 4, 5], 'never reorders what it was given');
});

test('a row says when the fix is due and whether that is late, and until when an acceptance runs', () => {
  const today = new Date(2026, 2, 12, 15, 0);                                       // 12 Mar 2026
  assert.deepEqual(dueView({ status: 'open', due_date: '2026-03-21T00:00:00', overdue: false }, today), { text: 'in 9 days', title: '21 Mar 2026', late: false });
  assert.deepEqual(dueView({ status: 'open', due_date: '2026-03-10T00:00:00', overdue: true }, today), { text: '2 days ago', title: '10 Mar 2026', late: true });
  assert.equal(dueView({ status: 'closed', due_date: '2026-03-10T00:00:00', overdue: true }, today).late, false, 'a closed finding is not chased');
  assert.deepEqual(dueView({ status: 'open', due_date: null }, today), { text: '—', title: '', late: false });
  assert.equal(dueView({ status: 'open', due_date: '2026-03-10T00:00:00' }, today).late, true, 'without the server\'s flag the date decides');
  assert.equal(acceptedLine({ status: 'accepted', accepted_until: '2031-06-30' }), 'until 30 Jun 2031');
  assert.equal(acceptedLine({ status: 'open', accepted_until: '2031-06-30' }), null);
});

test('the head line counts what is open and what holds a supplier\'s approval', () => {
  assert.equal(headLine(ROWS), '3 open · 1 blocking approval');
  assert.equal(headLine([]), '0 open');
  assert.equal(emptyCopy('open', false).title, 'No open findings');
  assert.equal(emptyCopy('closed', false).title, 'Nothing in this view');
  assert.equal(emptyCopy('open', true).title, 'No findings match');
});

test('the export is what is shown, in the words of the screen, with a formula made harmless', () => {
  const csv = csvOf([row(1, { title: '=HYPERLINK("x")', owner: { id: 1, name: 'Ana, Analyst' }, due_date: '2026-03-10T00:00:00', is_blocking: true }), row(2)]);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Severity,Finding,Vendor,Domain,Status,Fix due,Owner,Source,About,Blocks approval,Raised');
  assert.match(lines[1], /^medium,"'=HYPERLINK\(""x""\)",Acme Cloud,Cybersecurity,open,10 Mar 2026,"Ana, Analyst",Manual,The vendor itself,Yes,1 Mar 2026$/);
  assert.equal(exportName(new Date('2026-03-12T10:00:00Z')), 'vendor-findings-2026-03-12.csv');
});
