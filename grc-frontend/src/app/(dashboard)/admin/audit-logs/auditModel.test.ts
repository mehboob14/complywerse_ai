// node --test "src/app/(dashboard)/admin/audit-logs/auditModel.test.ts"
// The Audit log's rules: the date presets count the viewer's own calendar days (not the UTC day), the filters round-trip through the address, a request carries only what is
// chosen, a row reads as a plain sentence in its module, a change reads old -> new in words, the people to pick from are complete, and the CSV is escaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  activeFilterCount, AUDIT_SCHEMA, auditCsv, cachedSummary, changeBlocks, CSV_HEADER, csvCell, daysOf, deriveModuleContext, enrichDescription, EXPORT_CAP, exportPlan, fieldLabel, filterKey, isDay,
  localDay, payloadText, personOptions, presetRange, queryOf, recordKind, technicalRows, uniqueRows, utcStamp, valueText, type AuditFilters, type AuditLogEntry,
} from './auditModel.ts';

const NONE: AuditFilters = { action: '', module: '', submodule: '', person: '', range: 'all', from: '', to: '', page: 1 };
const row = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  id: 1, user_id: 7, user_name: 'Amna Khan', action: 'update', resource_type: 'risks', resource_id: 5, module: 'Risk Management', submodule: 'Risk Register',
  description: 'Updated risk #5', details: {}, ip_address: null, timestamp: '2026-11-08T14:02:11', ...over,
});

test('a date preset is counted on the viewer\'s calendar: at 01:00 local on 8 Nov "Today" is 8 Nov, not the UTC day before', () => {
  const lateNight = new Date(2026, 10, 8, 1, 0, 0);                         // local 8 Nov 01:00 (in a zone ahead of UTC the UTC day is 7 Nov)
  assert.equal(localDay(lateNight), '2026-11-08');
  assert.deepEqual(presetRange('today', lateNight), { start_date: '2026-11-08', end_date: '2026-11-08' });
  assert.deepEqual(presetRange('last_7_days', lateNight), { start_date: '2026-11-02', end_date: '2026-11-08' });        // today and the 6 before
  assert.deepEqual(presetRange('last_30_days', lateNight), { start_date: '2026-10-10', end_date: '2026-11-08' });
  assert.deepEqual(presetRange('last_90_days', lateNight), { start_date: '2026-08-11', end_date: '2026-11-08' });
  assert.deepEqual(presetRange('year_to_date', lateNight), { start_date: '2026-01-01', end_date: '2026-11-08' });
  assert.deepEqual(presetRange('last_year', lateNight), { start_date: '2025-11-08', end_date: '2026-11-08' });
  assert.deepEqual(presetRange('all', lateNight), {});
  assert.deepEqual(presetRange('nonsense', lateNight), {});
});

test('custom days outrank the preset, a day that is no day is dropped, a half range is allowed', () => {
  const now = new Date(2026, 10, 8, 12);
  assert.equal(isDay('2026-02-30'), false);
  assert.equal(isDay('2026-02-28'), true);
  assert.equal(isDay('12 Nov 2026'), false);
  assert.deepEqual(daysOf({ ...NONE, range: 'today', from: '2026-10-01', to: '2026-10-31' }, now), { start_date: '2026-10-01', end_date: '2026-10-31' });
  assert.deepEqual(daysOf({ ...NONE, range: 'today', from: '2026-10-01' }, now), { start_date: '2026-10-01' });
  assert.deepEqual(daysOf({ ...NONE, range: 'last_7_days', from: '2026-13-45' }, now), { start_date: '2026-11-02', end_date: '2026-11-08' }, 'a junk day falls back to the preset');
});

test('the filters round-trip through the address and a link can never put the page in a state it cannot be in', () => {
  const state: AuditFilters = { ...NONE, action: 'update', module: 'Risk Management', submodule: 'Risk Register', person: '7', range: 'last_30_days', page: 3 };
  const query = writeAddress(AUDIT_SCHEMA, '', state);
  assert.deepEqual(readAddress(AUDIT_SCHEMA, query), state);
  assert.equal(writeAddress(AUDIT_SCHEMA, '', NONE), '', 'the defaults have the plain address');
  assert.equal(readAddress(AUDIT_SCHEMA, 'range=someday&page=-4').range, 'all');
  assert.equal(readAddress(AUDIT_SCHEMA, 'range=someday&page=-4').page, 1);
  assert.equal(readAddress(AUDIT_SCHEMA, 'page=abc').page, 1);
});

test('the request carries only what is chosen: a sub-module only with its module, a person as a number, the page as an offset', () => {
  const now = new Date(2026, 10, 8, 12);
  assert.deepEqual(queryOf(NONE, now), { limit: 50, offset: 0 });
  assert.deepEqual(queryOf({ ...NONE, submodule: 'Risk Register' }, now), { limit: 50, offset: 0 }, 'a sub-module alone is dropped');
  assert.deepEqual(queryOf({ ...NONE, module: 'Governance', submodule: 'Documents', person: '12', action: 'create', page: 3 }, now),
    { limit: 50, offset: 100, action: 'create', module: 'Governance', submodule: 'Documents', user_id: 12 });
  assert.equal(queryOf({ ...NONE, person: 'abc' }, now).user_id, undefined);
  assert.equal(queryOf({ ...NONE, person: '-3' }, now).user_id, undefined);
  assert.deepEqual(queryOf({ ...NONE, range: 'today' }, now, { limit: 250, offset: 500 }), { limit: 250, offset: 500, start_date: '2026-11-08', end_date: '2026-11-08' });
  assert.notEqual(filterKey(queryOf({ ...NONE, action: 'create' }, now)), filterKey(queryOf({ ...NONE, action: 'update' }, now)));
});

test('the Clear button and the empty state count the filters that narrow the log, not the page', () => {
  assert.equal(activeFilterCount(NONE), 0);
  assert.equal(activeFilterCount({ ...NONE, page: 9 }), 0);
  assert.equal(activeFilterCount({ ...NONE, action: 'create', module: 'Evidence', range: 'today' }), 3);
  assert.equal(activeFilterCount({ ...NONE, range: 'today', from: '2026-10-01', to: '2026-10-02' }), 1, 'custom days and a preset are one filter');
});

test('a row belongs to the module it names, else to the module its URL falls under, and reads as a sentence in it', () => {
  assert.deepEqual(deriveModuleContext(row()), { module: 'Risk Management', submodule: 'Risk Register' });
  assert.deepEqual(deriveModuleContext(row({ module: null, submodule: null, path: '/grc/erm/risks/5' })), { module: 'Risks & ERM', submodule: 'Risks' });
  assert.deepEqual(deriveModuleContext(row({ module: null, path: '/grc/governance/documents/3' })), { module: 'Governance', submodule: 'Documents' });
  assert.deepEqual(deriveModuleContext(row({ module: null, path: '', resource_type: 'evidence' })), { module: 'Evidence', submodule: null });
  assert.equal(enrichDescription(row({ module: 'Evidence', submodule: null, description: 'Uploaded evidence' })), 'Uploaded evidence', 'a sentence that names its module is left alone');
  assert.equal(enrichDescription(row({ module: 'Evidence', submodule: null, description: 'Deleted item 4' })), 'Deleted item 4 — in Evidence');
});

test('a change reads in words: the kind of record, what was done, old -> new, housekeeping columns left out', () => {
  assert.equal(recordKind('grc_risk_reviews'), 'Risk review');
  assert.equal(recordKind('policies'), 'Policy');
  assert.equal(recordKind('evidence'), 'Evidence');
  assert.equal(recordKind('status'), 'Status');
  assert.equal(fieldLabel('owner_id'), 'Owner');
  assert.equal(fieldLabel('next_review_date'), 'Next review date');
  const { blocks, more } = changeBlocks({
    records: [{ op: 'updated', table: 'risks', id: 5, name: 'Phishing', fields: { status: ['open', 'closed'], updated_at: ['a', 'b'], owner_id: [3, 9], reviewed: true } }, { op: 'created', table: 'tasks', fields: { title: 'Call' } }],
    more: 2,
  });
  assert.equal(more, 2);
  assert.equal(blocks[0].opLabel, 'Changed');
  assert.equal(blocks[0].kind, 'Risk');
  assert.equal(blocks[0].name, 'Phishing');
  assert.deepEqual(blocks[0].lines.map((l) => l.label), ['Status', 'Owner', 'Reviewed'], 'updated_at is housekeeping');
  assert.equal(blocks[0].lines[0].before?.text, 'open');
  assert.equal(blocks[0].lines[0].after.text, 'closed');
  assert.equal(blocks[0].lines[2].before, null, 'a value that is not a pair has no "before"');
  assert.equal(blocks[0].lines[2].after.text, 'Yes');
  assert.equal(blocks[1].opLabel, 'Added');
  assert.deepEqual(changeBlocks(undefined), { blocks: [], more: 0 });
});

test('a stored value reads in words: nothing is a dash, a date is a date, a long text is cut with the full text kept', () => {
  assert.equal(valueText(null).text, '—');
  assert.equal(valueText('').text, '—');
  assert.equal(valueText(false).text, 'No');
  assert.equal(valueText(['a', 'b']).text, 'a, b');
  assert.equal(valueText([]).text, '—');
  assert.match(valueText('2026-03-25').text, /^25 Mar 2026$/);
  assert.equal(valueText({ a: 1 }).text, '{"a":1}');
  const long = valueText('x'.repeat(500));
  assert.equal(long.cut, true);
  assert.ok(long.text.length <= 200 && long.text.endsWith('…'));
  assert.equal(long.full.length, 500);
});

test('technical details hold what an auditor checks and leave out what is empty', () => {
  const rows = technicalRows(row({ method: 'PUT', path: '/grc/erm/risks/5', status_code: 200, duration_ms: 41, ip_address: '10.0.0.4', details: { user_agent: 'Edge' } }));
  assert.deepEqual(rows.map(([k]) => k), ['Request', 'Result code', 'Took', 'From address', 'Browser', 'Record type', 'Record number']);
  assert.deepEqual(technicalRows(row({ resource_type: '', resource_id: null })), []);
  assert.equal(payloadText(row()), null);
  assert.equal(payloadText(row({ details: { request: { name: 'x' } } })), '{\n  "name": "x"\n}');
  assert.equal(payloadText(row({ details: { request: {} } })), null);
});

test('a summary already written is read from where the server keeps it (inside details), so opening a row twice asks nothing twice', () => {
  assert.equal(cachedSummary(row()), null);
  assert.equal(cachedSummary(row({ ai_summary: '  Changed the owner.  ' })), 'Changed the owner.');
  assert.equal(cachedSummary(row({ details: { ai_summary: 'Closed the risk.' } })), 'Closed the risk.');
  assert.equal(cachedSummary(row({ details: { ai_summary: '   ' } })), null);
});

test('the people to pick from are the users the viewer may list plus anyone on the rows in hand, once each, by name', () => {
  const people = personOptions(
    [{ id: 2, display_name: 'Zed', username: 'zed' }, { id: 1, display_name: null, username: 'amna' }],
    [{ user_id: 2, user_name: 'Zed' }, { user_id: 9, user_name: 'Left Company' }, { user_id: null, user_name: 'System' }],
  );
  assert.deepEqual(people, [{ id: 1, label: 'amna' }, { id: 9, label: 'Left Company' }, { id: 2, label: 'Zed' }]);
  assert.deepEqual(personOptions([], [{ user_id: 4, user_name: 'Only Row' }]), [{ id: 4, label: 'Only Row' }], 'a viewer who may not list users still gets the people on the page');
});

test('the export: a filtered set is written up to the cap, the plan says how many requests, and the CSV is escaped and safe in a spreadsheet', () => {
  assert.deepEqual(exportPlan(0), { rows: 0, requests: 0, capped: false });
  assert.deepEqual(exportPlan(260), { rows: 260, requests: 2, capped: false });
  assert.deepEqual(exportPlan(EXPORT_CAP + 1), { rows: EXPORT_CAP, requests: EXPORT_CAP / 250, capped: true });
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'a formula is quoted, not run');
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
  assert.equal(utcStamp('2026-11-08T14:02:11.123456'), '2026-11-08 14:02:11');
  assert.equal(utcStamp('2026-11-08T14:02:11Z'), '2026-11-08 14:02:11');
  assert.equal(utcStamp(null), '');
  const csv = auditCsv([row(), row({ id: 2, user_name: 'Smith, J', description: 'Said "no"', resource_id: null })]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^2026-11-08 14:02:11,Amna Khan,Updated,Risk Management,Risk Register,Updated risk #5 — in Risk Register,risks,5$/);
  assert.match(lines[2], /"Smith, J"/);
  assert.match(lines[2], /"Said ""no"" — in Risk Register"/);
});

test('a row met on two pages (one was written in between) is exported once, in the order first met', () => {
  assert.deepEqual(uniqueRows([row({ id: 3 }), row({ id: 2 }), row({ id: 3 }), row({ id: 1 })]).map((r) => r.id), [3, 2, 1]);
});
