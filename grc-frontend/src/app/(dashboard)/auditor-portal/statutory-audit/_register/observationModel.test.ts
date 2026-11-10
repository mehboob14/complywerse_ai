// node --test "src/app/(dashboard)/auditor-portal/statutory-audit/_register/observationModel.test.ts"   (or the whole suite: npm test)
// The register's definition and the logic around it: the organisation's own status levels and where an observation may be moved (the server's table re-read), the facets and chips with
// their counts, the whole-list load, a CSV a spreadsheet cannot turn into a formula, and the history told in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { evaluateRegister, indexRegister, RESERVED, stateOf, sortRows } from '../../../../../components/records/registerModel.ts';
import { groupBoard } from '../../../../../components/records/explorerModel.ts';
import {
  BUILTIN_TRANSITIONS, CAP, CSV_HEADER, OBSERVATION_SCHEMA, activityWords, cell, exportName, isTerminal, levelsOf, linkedCount, loadAll, lockedField, nextStatuses, observationDef, slaText, toCsv,
  type Level, type ObservationRow, type Sla,
} from './observationModel.ts';

const LEVELS: Level[] = [
  { key: 'open', label: 'Open', tone: 'amber' },
  { key: 'in_progress', label: 'In progress', tone: 'blue' },
  { key: 'complied', label: 'Complied', tone: 'emerald' },
  { key: 'closed', label: 'Closed', tone: 'slate', terminal: true },
  { key: 'cancelled', label: 'Cancelled', tone: 'slate', terminal: true },
];

let next = 1;
function obs(over: Partial<ObservationRow> = {}): ObservationRow {
  const id = next++;
  return {
    id, code: `SAO-${String(id).padStart(3, '0')}`, title: `Observation ${id}`, description: null, observation_type: 'observation', regulator_source: null, regulation_reference: null, priority: 'medium',
    status: 'open', audit_period: null, due_date: null, management_response: null, notes: null, area_domain: null, category: null, owner_id: null, owner_name: null, created_by_name: null,
    closed_at: null, source_document_name: null, created_at: '2026-11-01T09:00:00', updated_at: '2026-11-01T09:00:00', custom_values: {}, sla: null, evidence_count: 0, control_count: 0, risk_count: 0,
    issue_count: 0, document_count: 0, mirrored: false, mirrored_issue_id: null, ...over,
  };
}
const sla = (over: Partial<Sla>): Sla => ({ state: 'on_track', days_overdue: 0, due_in_days: 40, target_days: 90, implied_due_date: false, escalated: false, ...over });

// ── the status levels ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the built-in moves are the server\'s: the table is re-read from the Python file', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../../../../../backend/grc/modules/auditor_portal/routers/statutory_audit.py', import.meta.url)), 'utf8');
  const block = /STATUS_TRANSITIONS = \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
  const server: Record<string, string[]> = {};
  Array.from(block.matchAll(/"([a-z_]+)": \{([^}]*)\}/g)).forEach((m) => { server[m[1]] = Array.from(m[2].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]).sort(); });
  assert.deepEqual(Object.keys(server).sort(), Object.keys(BUILTIN_TRANSITIONS).sort());
  Object.keys(server).forEach((k) => assert.deepEqual([...BUILTIN_TRANSITIONS[k]].sort(), server[k], k));
});

test('where an observation may be moved: the built-in table between built-in words, anywhere for a level the organisation added, never to itself', () => {
  const levels = LEVELS.concat({ key: 'awaiting_regulator', label: 'Awaiting the regulator', tone: 'violet' });
  assert.deepEqual(nextStatuses(levels, 'open').map((l) => l.key), ['in_progress', 'complied', 'closed', 'cancelled', 'awaiting_regulator']);
  assert.deepEqual(nextStatuses(levels, 'cancelled').map((l) => l.key), ['open', 'awaiting_regulator']);
  assert.deepEqual(nextStatuses(levels, 'complied').map((l) => l.key), ['open', 'in_progress', 'closed', 'awaiting_regulator']);
  assert.deepEqual(nextStatuses(levels, 'awaiting_regulator').map((l) => l.key), ['open', 'in_progress', 'complied', 'closed', 'cancelled'], 'from a level the organisation added, anywhere');
  assert.deepEqual(nextStatuses(LEVELS, 'a_status_nobody_listed').map((l) => l.key), LEVELS.map((l) => l.key));
  assert.deepEqual(nextStatuses([], 'open'), []);
});

test('the levels are the organisation\'s own in its order, and a word a row holds that no level names is added so a filter can reach it', () => {
  const got = levelsOf({ status_levels: LEVELS.slice(0, 2) }, [obs({ status: 'closed' }), obs({ status: 'closed' }), obs({ status: 'open' })]);
  assert.deepEqual(got.map((l) => l.key), ['open', 'in_progress', 'closed']);
  assert.equal(got[2].label, 'Closed');
  assert.deepEqual(levelsOf(undefined, []), []);
  assert.equal(isTerminal(LEVELS, 'closed'), true);
  assert.equal(isTerminal(LEVELS, 'open'), false);
  assert.equal(isTerminal(LEVELS, 'unknown'), false);
});

test('the SLA is told in words, and nothing is said of a closed observation', () => {
  assert.equal(slaText(sla({ state: 'breached', days_overdue: 3 })), 'Overdue by 3 days');
  assert.equal(slaText(sla({ state: 'breached', days_overdue: 1, escalated: true })), 'Overdue by 1 day, escalated');
  assert.equal(slaText(sla({ state: 'due_soon', due_in_days: 0 })), 'Due today');
  assert.equal(slaText(sla({ state: 'due_soon', due_in_days: 5 })), 'Due in 5 days');
  assert.equal(slaText(sla({ state: 'on_track', due_in_days: 40 })), 'On track, 40 days left');
  assert.equal(slaText(sla({ state: 'paused' })), 'Paused');
  assert.equal(slaText(sla({ state: 'no_due_date' })), 'No due date');
  assert.equal(slaText(sla({ state: 'closed' })), '');
  assert.equal(slaText(null), '');
});

// ── the definition ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const def = observationDef(LEVELS, 7);
const everyone = (rows: ObservationRow[], over: Partial<Parameters<typeof stateOf>[1]> = {}) => {
  const state = stateOf(def, { q: '', quick: 'all', view: 'list', sort: def.defaultSort, page: 1, id: 0, ...over });
  return evaluateRegister(def, indexRegister(def, rows), state, new Date('2026-11-10T12:00:00Z'));
};

test('a facet never has a name the address already uses, and the address names every facet and chip', () => {
  def.facets.forEach((f) => assert.ok(!(RESERVED as readonly string[]).includes(f.key), f.key));
  ['status', 'priority', 'type', 'regulator', 'period', 'category', 'owner', 'q', 'quick', 'view', 'sort', 'page', 'id'].forEach((k) => assert.ok(k in OBSERVATION_SCHEMA, k));
});

test('the facets offer every value an observation can have, with a bucket for the ones that say nothing, and count what the filters leave', () => {
  const rows = [
    obs({ status: 'open', priority: 'high', regulator_source: 'SBP', audit_period: 'FY2025', category: 'AML', owner_id: 3, owner_name: 'Ada Admin' }),
    obs({ status: 'closed', priority: 'low', regulator_source: ' SBP ', audit_period: null, category: '', owner_id: null }),
    obs({ status: 'in_progress', priority: 'high', regulator_source: 'SAMA', audit_period: 'FY2025', category: 'AML', owner_id: 3, owner_name: 'Ada Admin' }),
  ];
  const opts = (key: string) => def.facets.find((f) => f.key === key)!.options(rows);
  assert.deepEqual(opts('status').map((o) => o.label), ['Open', 'In progress', 'Complied', 'Closed', 'Cancelled'], 'every level, even one nobody holds yet');
  assert.deepEqual(opts('regulator'), [{ value: 'SAMA', label: 'SAMA' }, { value: 'SBP', label: 'SBP' }]);
  assert.deepEqual(opts('period'), [{ value: 'FY2025', label: 'FY2025' }, { value: 'none', label: 'No period' }]);
  assert.deepEqual(opts('category').map((o) => o.label), ['AML', 'No category']);
  assert.deepEqual(opts('owner'), [{ value: '3', label: 'Ada Admin' }, { value: 'none', label: 'Unassigned' }]);
  assert.equal(everyone(rows).result.matches.length, 3);
  assert.equal(everyone(rows).quickCounts.all, 3);
});

test('the chips count what they say: open follows the levels, overdue follows the SLA, mine follows the signed-in person', () => {
  const rows = [
    obs({ status: 'open', sla: sla({ state: 'breached', days_overdue: 4, due_in_days: -4 }), owner_id: 7 }),
    obs({ status: 'in_progress', sla: sla({ state: 'due_soon', due_in_days: 9 }), owner_id: 7 }),
    obs({ status: 'in_progress', sla: sla({ state: 'on_track', due_in_days: 90 }) }),
    obs({ status: 'closed', sla: sla({ state: 'closed' }), owner_id: 7 }),
    obs({ status: 'cancelled', sla: sla({ state: 'breached', days_overdue: 2, due_in_days: -2 }) }),     // a closed level never counts as open or overdue-and-open
    obs({ status: 'open', mirrored: true, sla: null }),
  ];
  const counts = everyone(rows).quickCounts;
  assert.equal(counts.all, 6);
  assert.equal(counts.open, 4, 'closed and cancelled are final levels');
  assert.equal(counts.due30, 1, 'due within 30 days, not closed');
  assert.equal(counts.overdue, 2, 'the SLA says breached');
  assert.equal(counts.mine, 3);
  assert.equal(counts.mirrored, 1);
  assert.equal(observationDef(LEVELS, null).quick.some((c) => c.key === 'mine'), false, 'no "Mine" chip until the person is known');
  assert.equal(observationDef(LEVELS, 7).quick.find((c) => c.key === 'open')!.test(obs({ status: 'a_level_nobody_listed' }), new Date()), true, 'a status no level names is not a final one');
});

test('the board has a column for every level, in the organisation\'s order, and the sort puts a missing value last either way', () => {
  const rows = [obs({ status: 'closed', due_date: '2026-12-01T00:00:00' }), obs({ status: 'open', due_date: null }), obs({ status: 'open', due_date: '2026-11-15T00:00:00' })];
  const board = groupBoard(rows, def.board!.columns);
  assert.deepEqual(board.map((c) => [c.label, c.rows.length]), [['Open', 2], ['In progress', 0], ['Complied', 0], ['Closed', 1], ['Cancelled', 0]]);
  const asc = sortRows(def, rows, { key: 'due', dir: 'asc' }).map((r) => r.due_date);
  const desc = sortRows(def, rows, { key: 'due', dir: 'desc' }).map((r) => r.due_date);
  assert.equal(asc[2], null);
  assert.equal(desc[2], null);
  assert.deepEqual(sortRows(def, rows, { key: 'status', dir: 'asc' }).map((r) => r.status), ['open', 'open', 'closed']);
  assert.deepEqual(sortRows(def, [obs({ priority: 'low' }), obs({ priority: 'critical' }), obs({ priority: 'high' })], { key: 'priority', dir: 'asc' }).map((r) => r.priority), ['critical', 'high', 'low']);
});

test('a search finds the code, the title, the regulator and the owner', () => {
  const rows = [obs({ code: 'SAO-014', title: 'AML thresholds', regulator_source: 'State Bank', owner_name: 'Ada Admin' }), obs({ title: 'Other' })];
  const found = (q: string) => everyone(rows, { q }).result.matches.length;
  assert.equal(found('sao-014'), 1);
  assert.equal(found('thresholds'), 1);
  assert.equal(found('state bank'), 1);
  assert.equal(found('ada'), 1);
  assert.equal(found('nothing like this'), 0);
});

// ── a copy of a register finding ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('on a copy of a register finding the fields the register overwrites are read-only, and the person\'s own are not', () => {
  ['title', 'description', 'regulator_source', 'priority', 'due_date', 'management_response', 'owner_id', 'category', 'status'].forEach((f) => assert.equal(lockedField(true, f), true, f));
  ['notes', 'observation_type', 'custom_values'].forEach((f) => assert.equal(lockedField(true, f), false, f));
  assert.equal(lockedField(false, 'title'), false);
  const crosslinks = readFileSync(fileURLToPath(new URL('../../../../../../../backend/grc/modules/issue_management/audit_register/crosslinks.py', import.meta.url)), 'utf8');
  const written = Array.from(crosslinks.matchAll(/observation\.([a-z_]+) = /g)).map((m) => m[1]).filter((f) => !['closed_at', 'updated_at', 'closed_by'].includes(f));
  written.forEach((f) => assert.equal(lockedField(true, f), true, `the register writes ${f}: it must be read-only here`));
});

// ── the whole list ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const server = (n: number) => {
  const all = Array.from({ length: n }, () => obs());
  const asked: Array<[number, number]> = [];
  return { asked, fetchPage: async (skip: number, limit: number) => { asked.push([skip, limit]); return { items: all.slice(skip, skip + limit), total: n }; }, all };
};

test('the whole list is read page by page until the server\'s total, the total is the server\'s, and a row seen twice is shown once', async () => {
  const s = server(1203);
  const got = await loadAll(s.fetchPage);
  assert.equal(got.rows.length, 1203);
  assert.equal(got.total, 1203);
  assert.deepEqual(s.asked, [[0, 500], [500, 500], [1000, 500]]);
  const dup = await loadAll(async (skip) => ({ items: skip === 0 ? [s.all[0], s.all[1]] : [s.all[1], s.all[2]], total: 4 }), { page: 2 });
  assert.deepEqual(dup.rows.map((r) => r.id), [s.all[0].id, s.all[1].id, s.all[2].id]);
});

test('a list longer than the cap is cut there and says how many the server holds; a failed page fails the load', async () => {
  const s = server(5600);
  const got = await loadAll(s.fetchPage);
  assert.equal(got.rows.length, CAP);
  assert.equal(got.total, 5600, 'the page can say "5,000 of 5,600"');
  assert.deepEqual((await loadAll(server(0).fetchPage)), { rows: [], total: 0 });
  let calls = 0;
  await assert.rejects(loadAll(async (skip, limit) => { calls += 1; if (calls === 2) throw new Error('network'); return { items: server(900).all.slice(skip, skip + limit), total: 900 }; }), /network/);
  const lying = await loadAll(async (skip) => ({ items: skip === 0 ? [obs()] : [], total: 50 }));
  assert.equal(lying.rows.length, 1, 'a server that holds less than it said does not make the load run for ever');
});

// ── export ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a cell a spreadsheet would read as a formula is written as text, and quotes, commas and line breaks are quoted', () => {
  assert.equal(cell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(cell('+1'), "'+1");
  assert.equal(cell('-2'), "'-2");
  assert.equal(cell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(cell('\tcmd'), "'\tcmd");
  assert.equal(cell('plain'), 'plain');
  assert.equal(cell('a, b'), '"a, b"');
  assert.equal(cell('line\nbreak'), '"line\nbreak"');
  assert.equal(cell(null), '');
  assert.equal(cell(0), '0');
});

test('the CSV has the observations as shown: levels in the organisation\'s words, dates as days, the SLA in words, nothing formula-like', () => {
  const csv = toCsv([
    obs({ code: 'SAO-001', title: '=cmd|\' /C calc\'!A0', status: 'in_progress', priority: 'high', regulator_source: 'SBP', due_date: '2026-11-30T00:00:00', owner_name: 'Ada Admin', evidence_count: 2, control_count: 1, risk_count: 2, mirrored: true,
      sla: sla({ state: 'breached', days_overdue: 3 }) }),
    obs({ code: 'SAO-002', title: 'Second', status: 'closed', sla: sla({ state: 'closed' }) }),
  ], LEVELS.map((l) => (l.key === 'in_progress' ? { ...l, label: 'Being worked on' } : l)));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.ok(lines[1].startsWith("SAO-001,'=cmd"), lines[1]);
  assert.match(lines[1], /,Being worked on,High,SBP,/);
  assert.match(lines[1], /,2026-11-30,Overdue by 3 days,2,3,Yes,/);
  assert.match(lines[2], /,Closed,Medium,/);
  assert.equal(linkedCount({ control_count: 1, risk_count: 2, issue_count: 0, document_count: 4 }), 7);
  assert.equal(exportName('2026-11-10', 84, false), 'statutory-audit-2026-11-10-84.csv');
  assert.equal(exportName('2026-11-10', 3, true), 'statutory-audit-selected-2026-11-10-3.csv');
});

// ── the history ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the history is told in words: moves in the organisation\'s levels, edits by field, links without ids', () => {
  const levels = LEVELS.map((l) => (l.key === 'complied' ? { ...l, label: 'Met' } : l));
  assert.deepEqual(activityWords({ activity_type: 'status_change', message: 'Status open → complied', payload: { from: 'open', to: 'complied', notes: ' Evidence accepted ' } }, levels), { text: 'Moved from Open to Met', note: 'Evidence accepted' });
  assert.deepEqual(activityWords({ activity_type: 'status_change', message: 'Status open → in_progress', payload: { from: 'open', to: 'in_progress', notes: null } }, levels), { text: 'Moved from Open to In progress', note: null });
  assert.equal(activityWords({ activity_type: 'update', message: 'Updated observation fields', payload: { fields: ['priority', 'due_date', 'owner_id', 'priority'] } }, levels).text, 'Changed the priority, the due date and the owner');
  assert.equal(activityWords({ activity_type: 'update', message: 'Updated observation fields', payload: { fields: ['custom_values'] } }, levels).text, 'Changed the additional fields');
  assert.equal(activityWords({ activity_type: 'update', message: 'x', payload: null }, levels).text, 'Changed the observation');
  assert.equal(activityWords({ activity_type: 'link', message: 'Linked evidence #12', payload: { evidence_id: 12 } }, levels).text, 'Linked a file');
  assert.equal(activityWords({ activity_type: 'link', message: 'Linked issue #8', payload: null }, levels).text, 'Linked an issue');
  assert.equal(activityWords({ activity_type: 'unlink', message: 'Unlinked control #5', payload: null }, levels).text, 'Unlinked a control');
  assert.equal(activityWords({ activity_type: 'link', message: 'Linked control IC-003', payload: { control: 3 } }, levels).text, 'Linked control IC-003');
  assert.equal(activityWords({ activity_type: 'link', message: "Uploaded evidence 'scan.pdf'", payload: null }, levels).text, "Uploaded evidence 'scan.pdf'");
  assert.equal(activityWords({ activity_type: 'link', message: 'Linked risk #9 to this', payload: null }, levels).text, 'Linked risk to this', 'an id left in a longer message is dropped');
  assert.equal(activityWords({ activity_type: 'created', message: 'Registered "AML thresholds"', payload: null }, levels).text, 'Registered "AML thresholds"');
  assert.equal(activityWords({ activity_type: 'something_new', message: null, payload: null }, levels).text, 'Something new');
});
