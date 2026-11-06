// node --test "src/app/(dashboard)/governance/documents/overview/_model.test.ts"
// The Documents Overview's rules (_model.ts): the library address every figure opens, the scope picker, the words and bars, the six tiles, the department
// table, the flow and stages, the request blocks, the reviews and issues, and what a failed request says. The numbers a person reads are never invented here: they are the server's, and a
// figure with no address is plain text. The last tests hold the model to the backend that answers it (the keys it asks of `links`) and to the library it opens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { PARAM_KEYS } from '../_workspace/libraryModel.ts';
import {
  departmentLines, hasDepartmentTable, barPercent, choiceLabel, failureOf, figureHref, figureName, flow, isEmpty, issueRows, lapsed, lateBy, lateRequests, libraryHref, namesText, openHref,
  overviewHref, pickedValue, requestRows, retryOverview, reviewRows, reviewShares, scopeOptions, scopeParams, stages, statusOf, tileLinkName, tiles, typeBars,
  type Choice, type Overview,
} from './_model.ts';

const D = (dept: string, extra: Record<string, string> = {}) => ({ ...(dept ? { dept } : {}), ...extra });

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
      own: 25, documents: 40, in_force: 22, in_progress: 14, overdue_reviews: 6, issues: 9 },
    { key: 'dept:12', department_id: 12, name: 'Helpdesk', path: ['Operations', 'Support', 'Helpdesk'], level: 3, level_label: 'Unit', depth: 1, is_active: true, owner: null,
      own: 15, documents: 15, in_force: 8, in_progress: 5, overdue_reviews: 2, issues: 3 },
  ],
  stages: [{ key: 'stage:review:Review', name: 'Review', kind: 'review', count: 5 }, { key: 'stage:approval:CISO sign-off', name: 'CISO sign-off', kind: 'approval', count: 3 }],
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
  assert.equal(overviewHref(''), '/governance/documents/overview');
  assert.equal(overviewHref('11'), '/governance/documents/overview?dept=11');
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

test('how late is said compactly and in words, and a bar is never invisible', () => {
  assert.deepEqual(lateBy(0), { short: '<1 d', long: 'Less than a day late' });
  assert.deepEqual(lateBy(-3), { short: '<1 d', long: 'Less than a day late' });
  assert.deepEqual(lateBy(1), { short: '1 d', long: '1 day late' });
  assert.deepEqual(lateBy(12), { short: '12 d', long: '12 days late' });
  assert.deepEqual(lateBy(59), { short: '59 d', long: '59 days late' });
  assert.deepEqual(lateBy(60), { short: '2 mo', long: '2 months late' });
  assert.deepEqual(lateBy(364), { short: '12 mo', long: '12 months late' });
  assert.deepEqual(lateBy(365), { short: '1 y', long: '1 year late' });
  assert.deepEqual(lateBy(548), { short: '1.5 y', long: '1.5 years late' });
  assert.equal(barPercent(0, 10), 0);
  assert.equal(barPercent(5, 0), 0);
  assert.equal(barPercent(10, 10), 100);
  assert.equal(barPercent(1, 1000), 3, 'one document in a thousand still shows');
  assert.equal(barPercent(5, 10), 50);
  assert.equal(barPercent(20, 10), 100);
});

test('the people a step waits for: the names, and how many more', () => {
  assert.equal(namesText({ waiting_for: ['Ana', 'Bob'], waiting_count: 2 }), 'Ana, Bob');
  assert.equal(namesText({ waiting_for: ['Ana', 'Bob', 'Cara', 'Dan', 'Eve'], waiting_count: 8 }), 'Ana, Bob, Cara, Dan, Eve +3');
  assert.equal(namesText({ waiting_for: [], waiting_count: 0 }), '');
  assert.equal(figureName(3, 'overdue reviews'), '3 overdue reviews. Open in the library');
  assert.equal(figureName(1200, 'documents'), '1,200 documents. Open in the library');
});

// ── the six tiles ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the tiles: four open the library on what they count, two jump to their list; late requests are people asked, and issues count each document once', () => {
  const t = tiles(OVERVIEW);
  assert.deepEqual(t.map((x) => x.label), ['Documents', 'In force', 'In progress', 'Overdue reviews', 'Late requests', 'Issues']);
  assert.deepEqual(t.map((x) => x.value), [40, 22, 14, 6, 4, 9]);                                     // 3 + 1 + 0 overdue requests; 9 documents with an issue
  assert.equal(lateRequests(OVERVIEW), 4);
  assert.deepEqual(t.map((x) => x.href), [
    '/governance/documents?dept=11', '/governance/documents?dept=11&status=published', '/governance/documents?dept=11&status=draft%2Cpending_review%2Cpending_approval%2Capproved',
    '/governance/documents?dept=11&review=overdue', '#waiting', '#issues',
  ]);
  assert.deepEqual(t.map((x) => x.tone), ['default', 'success', 'default', 'danger', 'danger', 'warning']);
  assert.equal(tileLinkName(t[3]), '6 overdue reviews. Open in the library');
  assert.equal(tileLinkName(t[4]), '4 late requests. Go to the list below');
  assert.ok(t.every((x) => x.info.length > 10 && !/\s{2,}/.test(x.info)));
  const quiet = tiles({ ...OVERVIEW, reviews: { ...OVERVIEW.reviews, overdue: 0 }, issues: { ...OVERVIEW.issues, documents: 0 },
    requests: { review: { ...OVERVIEW.requests.review, overdue: 0 }, approval: { ...OVERVIEW.requests.approval, overdue: 0 }, acknowledgement: OVERVIEW.requests.acknowledgement } });
  assert.deepEqual(quiet.map((x) => x.tone), ['default', 'success', 'default', 'default', 'default', 'default']);
  assert.equal(quiet[4].value, 0);
});

test('a scope with no documents, not even an archived one, is empty; an archived-only one is not', () => {
  const none = { archived: 0, documents: 0, in_force: 0, in_progress: 0, expired: 0, exception_applied: 0 };
  assert.equal(isEmpty({ totals: none }), true);
  assert.equal(isEmpty({ totals: { ...none, archived: 2 } }), false);
  assert.equal(isEmpty(OVERVIEW), false);
});

// ── by type, by status, by stage ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('the type bars are as long as their count against the biggest type, each number with its own address', () => {
  const bars = typeBars(OVERVIEW);
  assert.deepEqual(bars.map((b) => [b.label, b.count, b.inForce, b.percent]), [['Policy', 20, 12, 100], ['Standard', 10, 6, 50], ['Risk register', 1, 0, 5]]);
  assert.equal(bars[0].href, '/governance/documents?dept=11&type=policy');
  assert.equal(bars[0].inForceHref, '/governance/documents?dept=11&type=policy&status=published');
  assert.deepEqual(typeBars({ by_type: [], links: {} }), []);
});

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

test('the stages keep the server\'s order and open the documents of their status', () => {
  const s = stages(OVERVIEW);
  assert.deepEqual(s.map((x) => [x.name, x.count, x.href]), [
    ['Review', 5, '/governance/documents?dept=11&status=pending_review'], ['CISO sign-off', 3, '/governance/documents?dept=11&status=pending_approval'],
  ]);
  assert.equal(s[1].noun, 'documents in CISO sign-off');
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
  const shares = reviewShares(OVERVIEW.reviews);
  assert.deepEqual(shares.map((s) => s.key), ['overdue', 'due_soon', 'up_to_date'], 'a state nobody is in has no segment');
  assert.ok(Math.abs(shares.reduce((n, s) => n + s.percent, 0) - 100) < 1e-9);
  assert.deepEqual(reviewShares({ overdue: 0, due_soon: 0, unscheduled: 0, up_to_date: 0 }), [], 'no review owed: no bar, never a full one');
});

test('the department table: a row for the scope and each department under it, every figure opening the library on that department and what is under it', () => {
  const lines = departmentLines(OVERVIEW);
  assert.deepEqual(lines.map((l) => [l.row.name, l.here, l.open]), [['Support', true, null], ['Helpdesk', false, '/governance/documents/overview?dept=12']]);
  assert.equal(lines[0].documentsHref, '/governance/documents?dept=11');
  assert.equal(lines[1].inForceHref, '/governance/documents?dept=12&status=published');
  assert.equal(lines[1].inProgressHref, '/governance/documents?dept=12&status=draft%2Cpending_review%2Cpending_approval%2Capproved');
  assert.equal(lines[1].overdueHref, '/governance/documents?dept=12&review=overdue');
  // the Issues figure has no single library filter: it goes to the list on this page, or to the department's own overview
  assert.deepEqual(lines.map((l) => l.issuesHref), ['#issues', '/governance/documents/overview?dept=12#issues']);
  // the name says where it sits and how the documents are split between the department itself and what is under it
  assert.equal(lines[0].title, 'Operations › Support · Sub-department · 25 filed in it, 15 below it');
  assert.equal(lines[1].title, 'Operations › Support › Helpdesk · Unit');
  assert.equal(hasDepartmentTable(OVERVIEW), true);
  assert.equal(hasDepartmentTable({ by_department: [OVERVIEW.by_department[0]] }), false, 'one row is the six figures above: no table');
  assert.equal(hasDepartmentTable({ by_department: [] }), false);
  // a missing address is plain text, never a guessed one
  assert.equal(departmentLines({ ...OVERVIEW, links: {} })[1].documentsHref, null);
  // the whole organisation: "No department" is a row too, its own overview is ?dept=none and no row is "the page itself"
  const whole = { ...OVERVIEW, scope: { ...OVERVIEW.scope, value: '', department_id: null, name: 'Whole organisation', whole_organisation: true },
    by_department: [{ ...OVERVIEW.by_department[0], key: 'dept:none', department_id: null, name: 'No department', path: [], level: 0, level_label: '', depth: 0, owner: null, own: 3, documents: 3 }],
    links: { ...OVERVIEW.links, 'dept:none': D('none') } };
  const [none] = departmentLines(whole);
  assert.deepEqual([none.value, none.here, none.open, none.issuesHref, none.documentsHref], ['none', false, '/governance/documents/overview?dept=none', '/governance/documents/overview?dept=none#issues', '/governance/documents?dept=none']);
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
  // the department table's four addresses per row: `dept:<id>` and its three suffixes, as the model asks for them
  assert.ok(model.includes('figureHref(d, row.key)') && model.includes('`${row.key}:in_force`') && model.includes('`${row.key}:in_progress`') && model.includes('`${row.key}:overdue_reviews`'));
  for (const suffix of ['in_force', 'in_progress', 'overdue_reviews']) assert.ok(source.includes(`:${suffix}"`), `the server writes dept:<id>:${suffix}`);
  assert.ok(source.includes('"key": key') && source.includes('f"dept:{node if node is not None else NONE}"'));
  // every parameter the server puts in an address is one the library reads (libraryModel.PARAM_KEYS) - `attn` is the one this page added
  const names = new Set<string>();
  Array.from(source.matchAll(/\blink\(([^)]*)\)/g)).forEach((call) => Array.from(call[1].matchAll(/\b([a-z_]+)=/g)).forEach((p) => names.add(p[1])));
  assert.ok(names.size >= 5, `read ${Array.from(names).join(',')}`);
  for (const name of Array.from(names)) assert.ok(PARAM_KEYS.includes(name), `the server writes ?${name}= and the library does not read it`);
  assert.ok(PARAM_KEYS.includes('dept') && PARAM_KEYS.includes('attn'));
});

test('the tiles that jump on the page point at sections that exist', () => {
  const sections = readFileSync(new URL('./_Sections.tsx', import.meta.url), 'utf8');
  for (const t of tiles(OVERVIEW).filter((x) => x.href?.startsWith('#'))) assert.ok(sections.includes(`id="${t.href!.slice(1)}"`), t.href!);
});
