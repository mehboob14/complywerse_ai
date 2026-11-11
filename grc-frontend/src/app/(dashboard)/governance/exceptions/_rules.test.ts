// node --test "src/app/(dashboard)/governance/exceptions/_rules.test.ts"
// What the Policy exceptions page decides since it moved onto the design-system kit: what the server holds against what was loaded (the list is cut at
// 100 and carries no total), what a row offers, what the form reads and sends, how dates are said in three time zones, and what the charts are made of.
// (The older rules, the sort values, the CSV, the search and the pages, are tested in _logic.test.ts, unchanged.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  SERVER_LIMIT, agingBars, chartAlt, closedOnTimeTone, countLabel, csvDone, cutNotice, emptyForm, formErrors, formForPolicy, formFrom, itemsOf, payloadOf,
  departmentOf, longRefusal, openIdOf, requesterOf, rowActionKeys, sameForm, searchExceptions, serverList, sortLoaded, statusSlices, toDateInput, waitingLabel, waitingRows,
  withoutOpen, type ExceptionCounts, type ExceptionFields, type Filters,
} from './_logic.ts';

const NONE: Filters = { status: '', priority: '' };
const counts = (over: Partial<ExceptionCounts> = {}): ExceptionCounts => ({
  total: 172, by_status: { draft: 54, pending_approval: 50, approved: 40, rejected: 16, revoked: 12 }, by_priority: { low: 30, medium: 74, high: 39, critical: 29 }, ...over,
});

// ── what the server holds ─────────────────────────────────────────────────────────────────────────────────────────────────

test('the server sends at most 100 and no total: that is the limit the page reads a full list against', () => {
  assert.equal(SERVER_LIMIT, 100);
});

test('fewer rows than the server sends at most is the whole list, and the count is the rows (never the analytics, which can be behind)', () => {
  assert.deepEqual(serverList(0, NONE, undefined), { cut: false, total: 0 });
  assert.deepEqual(serverList(12, NONE, counts({ total: 500 })), { cut: false, total: 12 });
  assert.deepEqual(serverList(99, { status: 'draft', priority: '' }, counts()), { cut: false, total: 99 });
});

test('a full page is read against the analytics: every exception, those with the status, those with the priority', () => {
  assert.deepEqual(serverList(100, NONE, counts()), { cut: true, total: 172 });
  assert.deepEqual(serverList(100, { status: 'pending_approval', priority: '' }, counts({ by_status: { pending_approval: 140 } })), { cut: true, total: 140 });
  assert.deepEqual(serverList(100, { status: '', priority: 'high' }, counts({ by_priority: { high: 130 } })), { cut: true, total: 130 });
});

test('exactly 100 held is not cut, and counts that are behind what is on screen do not make a smaller total', () => {
  assert.deepEqual(serverList(100, NONE, counts({ total: 100 })), { cut: false, total: 100 });
  assert.deepEqual(serverList(100, NONE, counts({ total: 90 })), { cut: false, total: 100 });
  assert.deepEqual(serverList(100, { status: '', priority: 'medium' }, counts()), { cut: false, total: 100 });
  assert.deepEqual(serverList(100, { status: 'expired', priority: '' }, counts()), { cut: false, total: 100 });              // no such status held: nothing more than loaded
});

test('both filters at once, or no analytics yet, cannot be read: it is cut and the total is not known, never made up', () => {
  assert.deepEqual(serverList(100, { status: 'draft', priority: 'high' }, counts()), { cut: true, total: null });
  assert.deepEqual(serverList(100, NONE, undefined), { cut: true, total: null });
  assert.deepEqual(serverList(100, NONE, null), { cut: true, total: null });
  assert.deepEqual(serverList(100, NONE, counts({ total: Number.NaN })), { cut: true, total: null });
});

test('the notice says what is shown out of what there is, and what the search, sort and CSV work on', () => {
  assert.equal(cutNotice(12, { cut: false, total: 12 }, NONE), null);
  assert.deepEqual(cutNotice(100, { cut: true, total: 1243 }, NONE), {
    title: 'Showing 100 of 1,243 exceptions',
    detail: 'Search, sort and CSV use these 100 only. Pick a status or priority to narrow the list.',
  });
  assert.deepEqual(cutNotice(100, { cut: true, total: 172 }, { status: 'draft', priority: '' }), {
    title: 'Showing 100 of 172 exceptions',
    detail: 'Search, sort and CSV use these 100 only. Pick a status or priority to narrow the list.',
  });
});

test('a notice for a total nobody knows says so, and offers no narrowing once both filters are in use', () => {
  assert.deepEqual(cutNotice(100, { cut: true, total: null }, { status: 'draft', priority: 'high' }), {
    title: 'Showing the first 100 exceptions, there may be more',
    detail: 'Search, sort and CSV use these 100 only.',
  });
});

test('the count in the head: all of them, the loaded ones of the total, and what a search narrows', () => {
  assert.equal(countLabel(12, 12, false, { cut: false, total: 12 }), '12 exceptions');
  assert.equal(countLabel(1, 1, false, { cut: false, total: 1 }), '1 exception');
  assert.equal(countLabel(100, 100, false, { cut: true, total: 172 }), '100 of 172 exceptions');
  assert.equal(countLabel(100, 100, false, { cut: true, total: null }), '100+ exceptions');
  assert.equal(countLabel(3, 100, true, { cut: true, total: 172 }), '3 of 100 loaded · 172 in all');
  assert.equal(countLabel(3, 100, true, { cut: true, total: null }), '3 of 100 loaded');
  assert.equal(countLabel(3, 12, true, { cut: false, total: 12 }), '3 of 12 exceptions');          // an uncut list reads as it always did
  assert.equal(countLabel(100, 100, false, { cut: true, total: 1243 }), '100 of 1,243 exceptions');
});

test('the CSV toast never implies the file holds the whole set', () => {
  assert.equal(csvDone(12, 12, { cut: false, total: 12 }), 'Exported 12 exceptions');
  assert.equal(csvDone(1, 1, { cut: false, total: 1 }), 'Exported 1 exception');
  assert.equal(csvDone(100, 100, { cut: true, total: 172 }), 'Exported 100 exceptions from the 100 loaded (172 in all)');
  assert.equal(csvDone(3, 100, { cut: true, total: 172 }), 'Exported 3 exceptions from the 100 loaded (172 in all)');
  assert.equal(csvDone(100, 100, { cut: true, total: null }), 'Exported 100 exceptions from the 100 loaded (more on the server)');
});

test('the list is read out of an array, or out of an object that holds one; anything else is no list', () => {
  assert.deepEqual(itemsOf([1, 2]), [1, 2]);
  assert.deepEqual(itemsOf({ items: [1] }), [1]);
  assert.deepEqual(itemsOf({ exceptions: [2] }), [2]);
  assert.deepEqual(itemsOf({ documents: [3] }), [3]);
  assert.deepEqual(itemsOf({ data: [4] }), [4]);
  for (const nothing of [null, undefined, 'text', 7, {}, { items: 'x' }]) assert.deepEqual(itemsOf(nothing), []);
});

// ── order and search on the loaded rows ───────────────────────────────────────────────────────────────────────────────────

type Row = ExceptionFields & { id: number };
const row = (id: number, over: Partial<Row> = {}): Row => ({ id, title: `T${id}`, status: 'draft', priority: 'medium', created_at: '2026-10-01T09:30:00', expiry_date: null, ...over });

test('sort works on the loaded rows with the kit\'s sort state, never reordering its input; no sort leaves the rows as they are', () => {
  const rows = [row(1, { title: 'beta' }), row(2, { title: 'Alpha' }), row(3, { title: 'gamma' })];
  assert.deepEqual(sortLoaded(rows, { key: 'title', dir: 'asc' }).map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(sortLoaded(rows, { key: 'title', dir: 'desc' }).map((r) => r.id), [3, 1, 2]);
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 3]);
  assert.equal(sortLoaded(rows, null), rows);
  assert.equal(sortLoaded(rows, { key: 'actions', dir: 'asc' }), rows);                          // a column that only draws sorts nothing
});

test('the requester a row shows is the name the server sends, and the search reads that name, not the user number (which took the page down)', () => {
  const list = [
    row(1, { title: 'Legacy VPN', requester_name: 'Rhea Requester', requested_by: 7 }),
    row(2, { title: 'Old FTP', requester_name: 'Olivia Owner', requested_by: 2 }),
  ];
  assert.equal(requesterOf(list[0]), 'Rhea Requester');
  assert.equal(requesterOf({ requested_by_name: 'Older Name' }), 'Older Name');
  assert.equal(requesterOf({}), '');
  assert.deepEqual(searchExceptions(list, 'rhea').map((r) => r.id), [1]);
  assert.deepEqual(searchExceptions(list, 'nothing like this'), []);                              // a term in no title used to call .toLowerCase on the number 7
  assert.deepEqual(searchExceptions(list, '7'), []);                                              // the number is not searched
});

// ── what a row offers ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('a row offers what the server\'s flags and its status allow, in the menu\'s order', () => {
  assert.deepEqual(rowActionKeys({ status: 'draft' }), ['view']);
  assert.deepEqual(rowActionKeys({ status: 'draft', can_edit: true, can_delete: true }), ['view', 'edit', 'submit', 'delete']);
  assert.deepEqual(rowActionKeys({ status: 'pending_approval', can_edit: true, can_decide: true }), ['view', 'edit', 'approve', 'reject']);
  assert.deepEqual(rowActionKeys({ status: 'approved', can_decide: true }), ['view', 'revoke']);
  assert.deepEqual(rowActionKeys({ status: 'rejected', can_edit: true, can_decide: true }), ['view', 'edit']);
});

test('nobody decides their own: without can_decide there is no approve, reject or revoke, whoever else may edit it', () => {
  for (const status of ['pending_approval', 'approved']) {
    const keys = rowActionKeys({ status, can_edit: status === 'pending_approval', can_decide: false });
    for (const decision of ['approve', 'reject', 'revoke']) assert.ok(!keys.includes(decision as never), `${status} ${decision}`);
  }
});

test('a decision is offered only for the status it is for: approve and reject for pending, revoke for approved', () => {
  assert.deepEqual(rowActionKeys({ status: 'draft', can_decide: true }), ['view']);
  assert.deepEqual(rowActionKeys({ status: 'revoked', can_decide: true }), ['view']);
  assert.deepEqual(rowActionKeys({ status: 'expired', can_decide: true }), ['view']);
});

// An exception that waits under an approval rule (a run that is open) is decided by the people its open step asks, and only as that step allows.
const asked = (mine: { can_reject: boolean; can_ask_changes: boolean }, over = {}) => ({
  status: 'pending_approval', can_decide: true, approval: { status: 'open', my_step: mine }, ...over,
});

test('under an approval rule the person asked may ask for changes and reject only where the open step allows it', () => {
  assert.deepEqual(rowActionKeys(asked({ can_reject: true, can_ask_changes: true })), ['view', 'approve', 'changes', 'reject']);
  assert.deepEqual(rowActionKeys(asked({ can_reject: false, can_ask_changes: true })), ['view', 'approve', 'changes']);          // a review: it does not reject unless told to
  assert.deepEqual(rowActionKeys(asked({ can_reject: true, can_ask_changes: false })), ['view', 'approve', 'reject']);
  assert.deepEqual(rowActionKeys(asked({ can_reject: false, can_ask_changes: false })), ['view', 'approve']);
});

test('under an approval rule whoever is not asked decides nothing (can_decide is the server\'s: only the people the open step asks), and Withdraw is the server\'s flag', () => {
  assert.deepEqual(rowActionKeys({ status: 'pending_approval', can_decide: false, approval: { status: 'open', my_step: null } }), ['view']);
  assert.deepEqual(rowActionKeys({ status: 'pending_approval', can_edit: true, can_withdraw: true, approval: { status: 'open', my_step: null } }), ['view', 'edit', 'withdraw']);
  assert.deepEqual(rowActionKeys(asked({ can_reject: true, can_ask_changes: true }, { can_edit: true, can_withdraw: true })), ['view', 'edit', 'approve', 'changes', 'reject', 'withdraw']);
  assert.deepEqual(rowActionKeys({ status: 'draft', can_edit: true, can_withdraw: true }), ['view', 'edit', 'submit']);                // withdraw is for what waits
});

test('an exception whose earlier run is over (a draft sent back, an approved one) is decided as it always was: no ask for changes, no withdraw', () => {
  assert.deepEqual(rowActionKeys({ status: 'draft', can_edit: true, approval: { status: 'changes_requested', my_step: null } }), ['view', 'edit', 'submit']);
  assert.deepEqual(rowActionKeys({ status: 'approved', can_decide: true, approval: { status: 'approved', my_step: null } }), ['view', 'revoke']);
  // a later submission that no rule met: the older run is closed, and the older flow decides (approve and reject, never "ask for changes": the server refuses it)
  assert.deepEqual(rowActionKeys({ status: 'pending_approval', can_decide: true, approval: { status: 'withdrawn', my_step: null } }), ['view', 'approve', 'reject']);
});

// ── the quick filter and an alert's link ────────────────────────────────────────────────────────────────────────────────

test('"Waiting for me" is narrowed by the status and priority the page also offers, and says how many wait', () => {
  const rows = [
    { id: 1, status: 'pending_approval', priority: 'high' }, { id: 2, status: 'pending_approval', priority: 'low' }, { id: 3, status: 'draft', priority: 'high' },
  ];
  assert.deepEqual(waitingRows(rows, { status: '', priority: '' }).map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(waitingRows(rows, { status: 'pending_approval', priority: 'high' }).map((r) => r.id), [1]);
  assert.deepEqual(waitingRows(rows, { status: 'approved', priority: '' }), []);
  assert.equal(waitingLabel(0), 'Waiting for me');
  assert.equal(waitingLabel(3), 'Waiting for me · 3');
  assert.equal(waitingLabel(1200), 'Waiting for me · 1,200');
});

test('an alert\'s link asks for one exception: ?open= and a whole number from 1; anything else is no request', () => {
  assert.equal(openIdOf('open=12'), 12);
  assert.equal(openIdOf('?open=12'), 12);
  assert.equal(openIdOf('?foo=1&open=7&bar=2'), 7);
  assert.equal(openIdOf('?open=%2012'), 12);                                       // spaces are not part of a number
  for (const none of [null, undefined, '', '?', 'open=', 'open=0', 'open=-3', 'open=12abc', 'open=1.5', 'open=abc', 'open=12345678901', 'other=12']) {
    assert.equal(openIdOf(none), null, String(none));
  }
});

test('a link is used up once taken: the address keeps everything but its open', () => {
  assert.equal(withoutOpen('?open=12'), '');
  assert.equal(withoutOpen('open=12'), '');
  assert.equal(withoutOpen('?open=12&status=draft'), '?status=draft');
  assert.equal(withoutOpen('?status=draft'), '?status=draft');
  assert.equal(withoutOpen(''), '');
  assert.equal(withoutOpen(null), '');
});

test('what the server said when it refused is said in full only when a toast would cut it (a rule that cannot start names every step nobody can act at)', () => {
  const short = { response: { data: { detail: "This exception follows the rule 'Support', which cannot start: Step 1 (Approval) has nobody who can decide: Owner of Helpdesk (none set) for Helpdesk. Ask an administrator to change the rule or to set the owners." } } };
  assert.equal(longRefusal(short), null);
  const detail = `${short.response.data.detail} Step 2 (Approval) has nobody who can decide: Role: Nobody for Helpdesk.`;
  assert.equal(longRefusal({ response: { data: { detail } } }), detail);
  assert.equal(longRefusal(new Error('network')), null);
  assert.equal(longRefusal({ response: { data: { detail: 'x'.repeat(2000) } } })?.length, 1000);                         // never a wall of text
});

test('an exception\'s department is its path, and says when it comes from its policy', () => {
  assert.deepEqual(departmentOf({ department_path: ['Operations', 'Support'], department_inherited: true }), { text: 'Operations › Support', inherited: true });
  assert.deepEqual(departmentOf({ department_path: ['Finance'] }), { text: 'Finance', inherited: false });
  assert.equal(departmentOf({ department_path: [] }), null);
  assert.equal(departmentOf({}), null);
});

// ── the form ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a date field shows the day the server stored: a stored date has a time, which a date field turns into nothing', () => {
  assert.equal(toDateInput('2026-11-15T08:22:49'), '2026-11-15');
  assert.equal(toDateInput('2026-11-15'), '2026-11-15');
  assert.equal(toDateInput('2026-11-15T00:00:00Z'), '2026-11-15');
  for (const none of [null, undefined, '', 'not a date', '15/11/2026']) assert.equal(toDateInput(none), '');
});

test('Edit starts with what the exception has: its dates as days, its justification as lines, its business impact, its assets', () => {
  const form = formFrom({
    title: 'Legacy VPN', document_id: 44, justification: '["Vendor cannot patch"]', business_impact: 'Remote staff lose access',
    priority: undefined, effective_date: '2026-10-01T08:22:49', expiry_date: '2026-12-15T08:22:49', linked_asset_ids: [3, 1],
  });
  assert.deepEqual(form, {
    title: 'Legacy VPN', document_id: 44, justification: 'Vendor cannot patch', business_impact: 'Remote staff lose access',
    priority: 'medium', department_id: '', exception_type: '', effective_date: '2026-10-01', expiry_date: '2026-12-15', asset_ids: [3, 1],
    implementer_people: [], implementer_days: '',
  });
  assert.equal(formFrom({ title: 'x', document_id: 4 }).business_impact, '');                                  // an exception raised before it existed
  assert.equal(formFrom({ title: 'x', document_id: null }).document_id, '');
  assert.equal(formFrom({ title: 'x', document_id: 4, department_id: 12 }).department_id, 12);                  // its own department; one it takes from its policy is not in the form
  assert.equal(formFrom({ title: 'x', document_id: 4, exception_type: 'technical' }).exception_type, 'technical');      // its type, as the organisation's list names it
  assert.equal(formFrom({ title: 'x', document_id: 4, exception_type: null }).exception_type, '');
});

test('a new exception raised against a policy, or from a suggestion, starts with the title, the reason and the priority it came with', () => {
  assert.deepEqual(formForPolicy(5), { ...emptyForm(), document_id: 5 });
  assert.deepEqual(formForPolicy(5, { title: 'Guest Wi-Fi', justification: "['a', 'b']", priority: 'high' }), {
    ...emptyForm(), title: 'Guest Wi-Fi', document_id: 5, justification: '1. a\n2. b', priority: 'high',
  });
});

test('closing the form has something to lose only when it differs from where it started; the assets compare as a set', () => {
  const start = formFrom({ title: 'T', document_id: 4, justification: 'J', linked_asset_ids: [1, 2] });
  assert.ok(sameForm(start, { ...start }));
  assert.ok(sameForm(start, { ...start, asset_ids: [2, 1] }));
  assert.ok(sameForm(start, { ...start, document_id: '4' }));
  assert.ok(sameForm({ ...start, department_id: 12 }, { ...start, department_id: '12' }));
  for (const changed of [{ title: 'T2' }, { justification: 'J2' }, { business_impact: 'b' }, { priority: 'high' }, { effective_date: '2026-01-01' },
    { expiry_date: '2026-01-01' }, { asset_ids: [1] }, { document_id: '' }, { department_id: 12 }, { exception_type: 'technical' }]) assert.ok(!sameForm(start, { ...start, ...changed }), JSON.stringify(changed));
  assert.ok(sameForm(emptyForm(), emptyForm()));
});

test('the title and the justification are required, and spaces alone are nothing', () => {
  assert.deepEqual(formErrors(emptyForm()), { title: 'Enter a title', justification: 'Enter a justification' });
  assert.deepEqual(formErrors({ ...emptyForm(), title: '   ', justification: 'x' }), { title: 'Enter a title' });
  assert.deepEqual(formErrors({ ...emptyForm(), title: 'T', justification: '\n ' }), { justification: 'Enter a justification' });
  assert.deepEqual(formErrors({ ...emptyForm(), title: 'T', justification: 'J' }), {});
});

test('a new exception sends what it always did: a date only when set, the document only when chosen, and its department (none: null, its document\'s); the two long texts are no longer sent', () => {
  const form = { ...emptyForm(), title: 'T', justification: 'J', document_id: '44', expiry_date: '2026-12-15', asset_ids: [1, 2] };
  assert.deepEqual(payloadOf(form, false), {
    title: 'T', justification: 'J', priority: 'medium', document_id: 44, department_id: null, exception_type: null,
    expiry_date: '2026-12-15', asset_ids: [1, 2], implementer: null,
  });
  assert.equal(payloadOf({ ...form, business_impact: 'It stops the migration' }, false).business_impact, 'It stops the migration');
  assert.ok(!('business_impact' in payloadOf(form, false)));                                                       // a new exception without it sends none
  assert.equal(payloadOf({ ...form, business_impact: '' }, true).business_impact, null);                           // an edit that empties it: the server clears it
  const sentKeys = Object.keys(payloadOf(form, true));
  assert.ok(!sentKeys.includes('risk_assessment') && !sentKeys.includes('compensating_controls'));               // nothing the old long boxes held is wiped by an edit
  assert.equal(payloadOf({ ...form, exception_type: 'technical' }, false).exception_type, 'technical');
  assert.equal(payloadOf({ ...form, exception_type: '' }, true).exception_type, null);                            // an edit that empties it: the server clears it
  assert.equal(payloadOf({ ...form, department_id: '12' }, false).department_id, 12);
  assert.equal(payloadOf({ ...form, department_id: 12 }, true).department_id, 12);
  assert.equal(payloadOf({ ...form, department_id: '' }, true).department_id, null);                              // an edit that empties it: the server clears it
  const bare = payloadOf({ ...emptyForm(), title: 'T', justification: 'J' }, false);
  assert.ok(!('document_id' in bare) && !('effective_date' in bare) && !('expiry_date' in bare));
});

test('an edit also sends a date that was emptied, as null, so that clearing it means something', () => {
  const sent = payloadOf({ ...emptyForm(), title: 'T', justification: 'J', effective_date: '2026-10-01' }, true);
  assert.equal(sent.effective_date, '2026-10-01');
  assert.equal(sent.expiry_date, null);
  assert.ok(!('document_id' in sent));
});

// ── dates, in three zones ─────────────────────────────────────────────────────────────────────────────────────────────────

const MODULE = new URL('./_logic.ts', import.meta.url).href;
const CHILD = `
  const m = await import(process.argv[1]);
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  process.stdout.write(JSON.stringify(JSON.parse(input).map(([fn, ...args]) => m[fn](...args))));
`;
function inZone(zone: string, calls: unknown[][]): string[] {
  const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', CHILD, MODULE], { env: { ...process.env, TZ: zone }, input: JSON.stringify(calls), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

// UTC+5 (Karachi, the clients' zone), UTC-8 and UTC+13: a day at one end of the world is a different day at the other when it is wrongly shifted
const ZONES: Array<[string, string]> = [['UTC+5', 'Asia/Karachi'], ['UTC-8', 'Etc/GMT+8'], ['UTC+13', 'Etc/GMT-13']];

for (const [name, zone] of ZONES) {
  test(`an expiry, effective or review date is a day: it reads the same in ${name}, however the server wrote it`, () => {
    const out = inZone(zone, [
      ['dayText', '2026-12-31'], ['dayText', '2026-12-31T00:00:00'], ['dayText', '2026-12-31T23:59:59'], ['dayText', '2027-01-01T00:00:00.000Z'],
      ['dayText', null], ['dayText', ''], ['dayText', '2027-02-29T00:00:00'],
    ]);
    assert.deepEqual(out, ['31 Dec 2026', '31 Dec 2026', '31 Dec 2026', '1 Jan 2027', 'Not set', 'Not set', 'Not set']);
  });
}

test('a created or approved time is a moment: it reads as the viewer\'s own day, so 23:30 UTC is the next day east of Greenwich and the same day west of it', () => {
  const at = ['momentDay', '2026-12-31T23:30:00'];
  assert.deepEqual(inZone('Asia/Karachi', [at, ['momentText', '2026-12-31T23:30:00']]), ['1 Jan 2027', '1 Jan 2027, 04:30']);
  assert.deepEqual(inZone('Etc/GMT+8', [at, ['momentText', '2026-12-31T23:30:00']]), ['31 Dec 2026', '31 Dec 2026, 15:30']);
  assert.deepEqual(inZone('Etc/GMT-13', [at]), ['1 Jan 2027']);
  assert.deepEqual(inZone('UTC', [['momentDay', null], ['momentDay', 'nonsense'], ['momentText', null]]), ['—', '—', '—']);
});

// ── the charts ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the status mix is the registry\'s words in the registry\'s order with the registry\'s tones and labels, from the server\'s counts', () => {
  const slices = statusSlices({ rejected: 16, draft: 54, revoked: 12, approved: 40, pending_approval: 50 });
  assert.deepEqual(slices.map((s) => [s.key, s.label, s.value, s.tone]), [
    ['draft', 'Draft', 54, 'neutral'], ['pending_approval', 'Pending approval', 50, 'pending'], ['approved', 'Approved', 40, 'success'],
    ['rejected', 'Rejected', 16, 'danger'], ['revoked', 'Revoked', 12, 'neutral'],
  ]);
});

test('a status with none is left out, a word nobody registered is kept (neutral, in words), and no counts is no slices', () => {
  assert.deepEqual(statusSlices({ draft: 0, approved: 3, on_hold: 2 }).map((s) => [s.label, s.value, s.tone]), [['Approved', 3, 'success'], ['On hold', 2, 'neutral']]);
  assert.deepEqual(statusSlices(null), []);
  assert.deepEqual(statusSlices(undefined), []);
});

test('open by age is always five bars, an empty bucket a bar of nothing, in the order of age', () => {
  assert.deepEqual(agingBars({ '0_30': 120, '31_60': 30, overdue: 12 }).map((b) => [b.label, b.value]), [['0–30d', 120], ['31–60d', 30], ['61–90d', 0], ['90d+', 0], ['Overdue', 12]]);
  assert.deepEqual(agingBars(null).map((b) => b.value), [0, 0, 0, 0, 0]);
  assert.equal(agingBars({ overdue: 1 })[4].tone, 'danger');
});

test('a chart is also said in words, and an empty one says none', () => {
  assert.equal(chartAlt('Status', [{ label: 'Draft', value: 54 }, { label: 'Approved', value: 40 }]), 'Status: Draft 54, Approved 40');
  assert.equal(chartAlt('Status', []), 'Status: none');
});

test('"closed on time" is green from 80, amber from 50, red below, and neutral when nothing is measured', () => {
  assert.deepEqual([100, 80, 79.9, 50, 49.9, 0].map(closedOnTimeTone), ['success', 'success', 'warning', 'warning', 'danger', 'danger']);
  for (const none of [null, undefined, Number.NaN]) assert.equal(closedOnTimeTone(none), 'neutral');
});
