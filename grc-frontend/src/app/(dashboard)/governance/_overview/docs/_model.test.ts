// node --test "src/app/(dashboard)/governance/_overview/docs/_model.test.ts"
// The document figures of the Governance Overview (_model.ts): the library address every figure opens, the scope picker, the words and bars, the department
// table, the flow, the request blocks, the reviews and issues, and what a failed request says. The numbers a person reads are never invented here: they are the server's, and a
// figure with no address is plain text. The last tests hold the model to the backend that answers it (the keys it asks of `links`) and to the library it opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { PARAM_KEYS } from '../../documents/_workspace/libraryModel.ts';
import {
  hasDepartmentTable, rowIsHere, rowValue, choiceLabel, failureOf, figureHref, figureName, flow, isEmpty, issueRows, lapsed, lateBy, libraryHref, openHref,
  overviewHref, pickedValue, requestRows, retryOverview, reviewRows, scopeOptions, scopeParams, statusOf,
  type Choice, type Overview,
} from './_model.ts';

const D = (dept: string, extra: Record<string, string> = {}) => ({ ...(dept ? { dept } : {}), ...extra });

/** The breakdowns every department row also carries (their rules are _matrix.test.ts's): nothing in them is read here. */
const NONE = { pending: 0, overdue: 0 };
const BREAKDOWN = {
  by_status: {}, by_type: {}, waiting: { review: NONE, approval: NONE, acknowledgement: NONE }, reviews: { overdue: 0, due_soon: 0, unscheduled: 0 },
  issues_by: { stuck: 0, on_hold: 0, late_approvals: 0, late_acknowledgements: 0, no_owner: 0 },
};

/** What the server answers for Support (id 11), trimmed. The addresses are the ones the backend writes (documents_overview.py `links`). */
const SUPPORT = '11';
const OVERVIEW: Overview = {
  scope: { value: SUPPORT, department_id: 11, name: 'Support', path: ['Operations', 'Support'], level: 2, level_label: 'Sub-department', whole_organisation: false, includes_below: true },
  choices: [],
  as_of: '2026-11-04T12:00:00',
  totals: { documents: 40, in_force: 22, in_progress: 14, expired: 3, exception_applied: 1, archived: 5 },
  by_type: [
    { key: 'type:policy', doc_type: 'policy', label: 'Policy', count: 20, in_force: 12, in_force_key: 'type:policy:in_force' },
    { key: 'type:standard', doc_type: 'standard', label: 'Standard', count: 10, in_force: 6, in_force_key: 'type:standard:in_force' },
    { key: 'type:risk_register', doc_type: 'risk_register', label: 'Risk register', count: 1, in_force: 0, in_force_key: 'type:risk_register:in_force' },
  ],
  by_status: [
    { key: 'status:draft', status: 'draft', count: 4 }, { key: 'status:pending_review', status: 'pending_review', count: 5 },
    { key: 'status:pending_approval', status: 'pending_approval', count: 3 }, { key: 'status:approved', status: 'approved', count: 2 },
    { key: 'status:published', status: 'published', count: 22 }, { key: 'status:expired', status: 'expired', count: 3 },
    { key: 'status:exception_applied', status: 'exception_applied', count: 1 }, { key: 'status:review_required', status: 'review_required', count: 0 },
  ],
  by_department: [
    { key: 'dept:11', department_id: 11, name: 'Support', path: ['Operations', 'Support'], level: 2, level_label: 'Sub-department', depth: 0, is_active: true, owner: 'Mia',
      own: 25, documents: 40, in_force: 22, in_progress: 14, overdue_reviews: 6, issues: 9, ...BREAKDOWN },
    { key: 'dept:12', department_id: 12, name: 'Helpdesk', path: ['Operations', 'Support', 'Helpdesk'], level: 3, level_label: 'Unit', depth: 1, is_active: true, owner: null,
      own: 15, documents: 15, in_force: 8, in_progress: 5, overdue_reviews: 2, issues: 3, ...BREAKDOWN },
  ],
  requests: {
    review: { pending: 9, overdue: 3, due_soon: 2, oldest_days_late: 12 },
    approval: { pending: 4, overdue: 1, due_soon: 0, oldest_days_late: 0 },
    acknowledgement: { pending: 30, overdue: 0, due_soon: 5, oldest_days_late: null },
  },
  waiting: [],
  reviews: { overdue: 6, due_soon: 4, unscheduled: 0, up_to_date: 10 },
  issues: { no_owner: 2, expired: 3, exception_applied: 1, stuck: 2, on_hold: 0, late_acknowledgements: 0, late_approvals: 4, documents: 9 },
  links: {
    'totals.documents': D(SUPPORT), 'totals.in_force': D(SUPPORT, { status: 'published' }), 'totals.in_progress': D(SUPPORT, { status: 'draft,pending_review,pending_approval,approved' }),
    'totals.expired': D(SUPPORT, { status: 'expired' }), 'totals.exception_applied': D(SUPPORT, { status: 'exception_applied' }), 'totals.archived': D(SUPPORT, { status: 'archived' }),
    'type:policy': D(SUPPORT, { type: 'policy' }), 'type:policy:in_force': D(SUPPORT, { type: 'policy', status: 'published' }),
    'type:standard': D(SUPPORT, { type: 'standard' }), 'type:standard:in_force': D(SUPPORT, { type: 'standard', status: 'published' }),
    'type:risk_register': D(SUPPORT, { type: 'risk_register' }), 'type:risk_register:in_force': D(SUPPORT, { type: 'risk_register', status: 'published' }),
    'status:draft': D(SUPPORT, { status: 'draft' }), 'status:pending_review': D(SUPPORT, { status: 'pending_review' }), 'status:pending_approval': D(SUPPORT, { status: 'pending_approval' }),
    'status:approved': D(SUPPORT, { status: 'approved' }), 'status:published': D(SUPPORT, { status: 'published' }), 'status:expired': D(SUPPORT, { status: 'expired' }),
    'status:exception_applied': D(SUPPORT, { status: 'exception_applied' }), 'status:review_required': D(SUPPORT, { status: 'review_required' }),
    'stage:review:Review': D(SUPPORT, { status: 'pending_review' }), 'stage:approval:CISO sign-off': D(SUPPORT, { status: 'pending_approval' }),
    'requests.review.pending': D(SUPPORT, { status: 'pending_review' }), 'requests.approval.pending': D(SUPPORT, { status: 'pending_approval' }),
    'requests.review.overdue': D(SUPPORT, { attn: 'late_approvals' }), 'requests.approval.overdue': D(SUPPORT, { attn: 'late_approvals' }),
    'requests.acknowledgement.overdue': D(SUPPORT, { attn: 'late_acknowledgements' }),
    'reviews.overdue': D(SUPPORT, { review: 'overdue' }), 'reviews.due_soon': D(SUPPORT, { review: 'due_soon' }), 'reviews.unscheduled': D(SUPPORT, { review: 'unscheduled' }),
    'reviews.up_to_date': D(SUPPORT, { review: 'ok' }),
    'issues.no_owner': D(SUPPORT, { owner: 'none' }), 'issues.expired': D(SUPPORT, { status: 'expired' }), 'issues.exception_applied': D(SUPPORT, { status: 'exception_applied' }),
    'issues.stuck': D(SUPPORT, { attn: 'stuck' }), 'issues.on_hold': D(SUPPORT, { attn: 'on_hold' }), 'issues.late_acknowledgements': D(SUPPORT, { attn: 'late_acknowledgements' }),
    'issues.late_approvals': D(SUPPORT, { attn: 'late_approvals' }),
    'dept:11': D('11'), 'dept:11:in_force': D('11', { status: 'published' }), 'dept:11:in_progress': D('11', { status: 'draft,pending_review,pending_approval,approved' }),
    'dept:11:overdue_reviews': D('11', { review: 'overdue' }),
    'dept:12': D('12'), 'dept:12:in_force': D('12', { status: 'published' }), 'dept:12:in_progress': D('12', { status: 'draft,pending_review,pending_approval,approved' }),
    'dept:12:overdue_reviews': D('12', { review: 'overdue' }),
  },
};

// ── the library's address ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a figure opens the library with the parameters the server gave it; none given is plain text', () => {
  assert.equal(libraryHref(null), null);
  assert.equal(libraryHref(undefined), null);
  assert.equal(libraryHref({}), '/governance/documents');                                       // the whole organisation, nothing filtered
  assert.equal(libraryHref({ dept: '11' }), '/governance/documents?dept=11');
  assert.equal(libraryHref({ dept: '11', status: 'draft,pending_review' }), '/governance/documents?dept=11&status=draft%2Cpending_review');
  assert.equal(libraryHref({ dept: '', review: 'overdue' }), '/governance/documents?review=overdue');       // an empty value is left out
  assert.equal(figureHref(OVERVIEW, 'reviews.overdue'), '/governance/documents?dept=11&review=overdue');
  assert.equal(figureHref(OVERVIEW, 'no.such.key'), null);
  assert.equal(openHref(7), '/governance/documents?open=7');
  // what the library reads back from such an address is what the server meant
  assert.equal(new URLSearchParams(libraryHref({ status: 'draft,pending_review' })!.split('?')[1]).get('status'), 'draft,pending_review');
});

test('the scope is the address of this page and the one parameter the server is asked with', () => {
  assert.deepEqual(scopeParams(''), {});
  assert.deepEqual(scopeParams('  '), {});
  assert.deepEqual(scopeParams('11'), { department_id: '11' });
  assert.deepEqual(scopeParams('none'), { department_id: 'none' });
  assert.equal(overviewHref(''), '/governance');
  assert.equal(overviewHref('11'), '/governance?dept=11');
});

// ── the picker ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CHOICES: Choice[] = [
  { value: '', department_id: null, name: 'Whole organisation', path: [], level: 0, level_label: '', is_active: true },
  { value: '10', department_id: 10, name: 'Operations', path: ['Operations'], level: 1, level_label: 'Department', is_active: true },
  { value: '11', department_id: 11, name: 'Support', path: ['Operations', 'Support'], level: 2, level_label: 'Sub-department', is_active: true },
  { value: '14', department_id: 14, name: 'Legacy', path: ['Finance', 'Legacy'], level: 2, level_label: 'Sub-department', is_active: false },
  { value: 'none', department_id: null, name: 'No department', path: [], level: 0, level_label: '', is_active: true },
];

test('a department is named by its whole path, a switched-off one says so, and the pseudo choices keep their names', () => {
  assert.deepEqual(CHOICES.map(choiceLabel), ['Whole organisation', 'Operations', 'Operations › Support', 'Finance › Legacy (inactive)', 'No department']);
  assert.deepEqual(scopeOptions(CHOICES).map((o) => o.value), ['', '10', '11', '14', 'none']);           // the server's order is kept
  assert.equal(pickedValue(OVERVIEW, ''), '11', 'the picker shows the scope the server answered for');
  assert.equal(pickedValue(undefined, '14'), '14', 'while it loads or has failed, the one that was asked for');
  assert.equal(pickedValue(undefined, ''), '');
});

// ── words and bars ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('how late is said compactly and in words', () => {
  assert.deepEqual(lateBy(0), { short: '<1 d', long: 'Less than a day late' });
  assert.deepEqual(lateBy(-3), { short: '<1 d', long: 'Less than a day late' });
  assert.deepEqual(lateBy(1), { short: '1 d', long: '1 day late' });
  assert.deepEqual(lateBy(12), { short: '12 d', long: '12 days late' });
  assert.deepEqual(lateBy(59), { short: '59 d', long: '59 days late' });
  assert.deepEqual(lateBy(60), { short: '2 mo', long: '2 months late' });
  assert.deepEqual(lateBy(364), { short: '12 mo', long: '12 months late' });
  assert.deepEqual(lateBy(365), { short: '1 y', long: '1 year late' });
  assert.deepEqual(lateBy(548), { short: '1.5 y', long: '1.5 years late' });
});

test('a figure is named by what it opens', () => {
  assert.equal(figureName(3, 'overdue reviews'), '3 overdue reviews. Open in the library');
  assert.equal(figureName(1200, 'documents'), '1,200 documents. Open in the library');
});

// ── an empty scope ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a scope with no documents, not even an archived one, is empty; an archived-only one is not', () => {
  const none = { archived: 0, documents: 0, in_force: 0, in_progress: 0, expired: 0, exception_applied: 0 };
  assert.equal(isEmpty({ totals: none }), true);
  assert.equal(isEmpty({ totals: { ...none, archived: 2 } }), false);
  assert.equal(isEmpty(OVERVIEW), false);
});

// ── by status ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the approval flow is the five steps in order with their counts, a step nobody is at says 0, and what fell out of it is listed apart', () => {
  assert.deepEqual(flow(OVERVIEW).map((s) => [s.label, s.count]), [['Draft', 4], ['In review', 5], ['In approval', 3], ['Approved', 2], ['Published', 22]]);
  assert.equal(flow(OVERVIEW)[1].href, '/governance/documents?dept=11&status=pending_review');
  assert.equal(flow(OVERVIEW)[1].noun, 'documents with status In review');
  assert.deepEqual(flow({ by_status: [], links: {} }).map((s) => s.count), [0, 0, 0, 0, 0]);
  assert.deepEqual(flow({ by_status: [], links: {} }).map((s) => s.href), [null, null, null, null, null]);
  assert.deepEqual(lapsed(OVERVIEW).map((s) => [s.label, s.count]), [['Expired', 3], ['Exception', 1]]);                     // review_required has none: not listed
  const other = { ...OVERVIEW, by_status: OVERVIEW.by_status.map((s) => (s.status === 'review_required' ? { ...s, count: 2 } : s)) };
  assert.deepEqual(lapsed(other).map((s) => [s.label, s.count]), [['Expired', 3], ['Exception', 1], ['Review required', 2]]);
  assert.deepEqual(lapsed({ by_status: [], links: {} }).map((s) => [s.label, s.count]), [['Expired', 0], ['Exception', 0]]);
});

// ── waiting on people ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a block for each kind of request: pending and overdue open the library where it can, due soon and a pending acknowledgement are text', () => {
  const rows = requestRows(OVERVIEW);
  assert.deepEqual(rows.map((r) => [r.label, r.pending, r.overdue, r.dueSoon, r.oldest]), [
    ['Review', 9, 3, 2, '12 d'], ['Approval', 4, 1, 0, '<1 d'], ['Acknowledgement', 30, 0, 5, null],
  ]);
  assert.equal(rows[0].oldestLong, '12 days late');
  assert.equal(rows[2].oldestLong, null, 'nothing overdue: no age to say');
  assert.deepEqual(rows.map((r) => r.pendingHref), ['/governance/documents?dept=11&status=pending_review', '/governance/documents?dept=11&status=pending_approval', null]);
  assert.deepEqual(rows.map((r) => r.overdueHref), [
    '/governance/documents?dept=11&attn=late_approvals', '/governance/documents?dept=11&attn=late_approvals', '/governance/documents?dept=11&attn=late_acknowledgements',
  ]);
});

// ── reviews and issues ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the reviews use the library\'s own words, worst first, and the bar is each state\'s share of the reviews owed', () => {
  const rows = reviewRows(OVERVIEW);
  assert.deepEqual(rows.map((r) => [r.label, r.count]), [['Overdue', 6], ['Due in 30 days', 4], ['No review date', 0], ['Up to date', 10]]);
  assert.deepEqual(rows.map((r) => r.href), [
    '/governance/documents?dept=11&review=overdue', '/governance/documents?dept=11&review=due_soon', '/governance/documents?dept=11&review=unscheduled',
    '/governance/documents?dept=11&review=ok',
  ]);
});

test('the department table is worth a card when there is more than one row, and each row\'s total opens the library on that department and what is under it', () => {
  assert.equal(hasDepartmentTable(OVERVIEW), true);
  assert.equal(hasDepartmentTable({ by_department: [OVERVIEW.by_department[0]] }), false, 'one row is the six figures above: no table');
  assert.equal(hasDepartmentTable({ by_department: [] }), false);
  assert.equal(figureHref(OVERVIEW, OVERVIEW.by_department[0].key), '/governance/documents?dept=11');
  assert.equal(figureHref({ links: {} }, OVERVIEW.by_department[0].key), null, 'a missing address is plain text, never a guessed one');
  // the address value of a row: its id, "none" for the documents in no department; the scope's own row is the page itself
  assert.deepEqual([rowValue(OVERVIEW.by_department[1]), rowValue({ department_id: null })], ['12', 'none']);
  assert.deepEqual([rowIsHere(OVERVIEW.by_department[0], OVERVIEW.scope), rowIsHere(OVERVIEW.by_department[1], OVERVIEW.scope), rowIsHere({ department_id: null }, { department_id: null })], [true, false, false]);
});

test('the issues: the ones that mean someone is stuck first, in the words the library shows when it opens them', () => {
  const rows = issueRows(OVERVIEW);
  assert.deepEqual(rows.map((r) => [r.label, r.count]), [
    ['Stuck in a stage', 2], ['On hold', 0], ['Late approvals', 4], ['Late acknowledgements', 0], ['No owner', 2], ['Expired', 3], ['Exception', 1],
  ]);
  assert.deepEqual(rows.map((r) => r.href), [
    '/governance/documents?dept=11&attn=stuck', '/governance/documents?dept=11&attn=on_hold', '/governance/documents?dept=11&attn=late_approvals',
    '/governance/documents?dept=11&attn=late_acknowledgements', '/governance/documents?dept=11&owner=none', '/governance/documents?dept=11&status=expired',
    '/governance/documents?dept=11&status=exception_applied',
  ]);
  assert.ok(rows.every((r) => r.noun.startsWith('documents') || r.noun === 'expired documents'));
  assert.ok(rows.every((r) => r.info.length > 10));
});

// ── when the request fails ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a failed request is said as what it is, and only a failure that can pass is tried again', () => {
  assert.equal(failureOf(403, ''), 'no-access');
  assert.equal(failureOf(403, '11'), 'not-yours');
  assert.equal(failureOf(404, '999'), 'not-found');
  for (const status of [null, 400, 500, 502, 503]) assert.equal(failureOf(status, '11'), 'unavailable', String(status));
  assert.equal(statusOf({ response: { status: 403 } }), 403);
  assert.equal(statusOf(new Error('network')), null);
  assert.equal(statusOf(null), null);
  const e = (status: number | undefined) => ({ response: status === undefined ? undefined : { status } });
  assert.deepEqual([403, 404, 400, 422, 401].map((s) => retryOverview(0, e(s))), [false, false, false, false, false]);
  assert.deepEqual([500, 502, 503, 408, 425, 429, undefined].map((s) => retryOverview(0, e(s))), [true, true, true, true, true, true, true]);
  assert.equal(retryOverview(3, e(500)), false, 'three tries and it is unavailable');
});

// ── the model and the backend that answers it ──────────────────────────────────────────────────────────────────────────────────────────────

const BACKEND = new URL('../../../../../../../backend/grc/modules/governance/documents_overview.py', import.meta.url);

test('every address the page asks the server for is one the server writes, and every parameter it writes is one the library reads', () => {
  if (!existsSync(BACKEND)) return;                                   // read when the backend is beside the frontend (as navRegistry.test.ts and status.test.ts do)
  const source = readFileSync(BACKEND, 'utf8');
  const asked = new Set<string>();
  const model = readFileSync(new URL('./_model.ts', import.meta.url), 'utf8');
  Array.from(model.matchAll(/figureHref\(d, ['"`]([^'"`$]+)['"`]\)/g)).forEach((m) => asked.add(m[1]));                 // the fixed keys
  Array.from(model.matchAll(/`requests\.\$\{kind\}\.(pending|overdue)`/g)).forEach((m) => ['review', 'approval', 'acknowledgement'].forEach((k) => asked.add(`requests.${k}.${m[1]}`)));
  Array.from(model.matchAll(/figureHref\(d, `issues\.\$\{key\}`\)/g)).forEach(() => ['no_owner', 'expired', 'exception_applied', 'stuck', 'on_hold', 'late_acknowledgements', 'late_approvals'].forEach((k) => asked.add(`issues.${k}`)));
  assert.ok(asked.size >= 17, `read ${asked.size} keys`);
  // the keys the server writes: a quoted key, or the three the list rows build (type:, status:, stage:)
  const written = new Set(Array.from(source.matchAll(/"((?:totals|reviews|issues|requests)\.[a-z_.]+)"/g)).map((m) => m[1]));
  for (const k of ['pending', 'overdue']) for (const kind of ['review', 'approval', 'acknowledgement']) if (source.includes(`"requests.${kind}.${k}"`)) written.add(`requests.${kind}.${k}`);
  for (const key of Array.from(asked)) {
    if (key.startsWith('requests.acknowledgement.pending')) continue;                                       // no filter shows it: the server gives it no address, the page shows text
    assert.ok(written.has(key), `${key}: the page asks for it, the server never writes it`);
  }
  for (const prefix of ['f"type:{', 'f"type:{doc_type}:in_force"', 'f"status:{', 'f"stage:{kind}:{name}"']) assert.ok(source.includes(prefix), prefix);
  // the department table asks for one address per row, `dept:<id>` (its other figures are made from the library's own parameters: _matrix.ts)
  assert.ok(readFileSync(new URL('./_DepartmentTable.tsx', import.meta.url), 'utf8').includes('figureHref(data, line.row.key)'));
  assert.ok(source.includes('"key": key') && source.includes('f"dept:{node if node is not None else NONE}"'));
  // every parameter the server puts in an address is one the library reads (libraryModel.PARAM_KEYS) - `attn` is the one this page added
  const names = new Set<string>();
  Array.from(source.matchAll(/\blink\(([^)]*)\)/g)).forEach((call) => Array.from(call[1].matchAll(/\b([a-z_]+)=/g)).forEach((p) => names.add(p[1])));
  assert.ok(names.size >= 5, `read ${Array.from(names).join(',')}`);
  for (const name of Array.from(names)) assert.ok(PARAM_KEYS.includes(name), `the server writes ?${name}= and the library does not read it`);
  assert.ok(PARAM_KEYS.includes('dept') && PARAM_KEYS.includes('attn'));
});
