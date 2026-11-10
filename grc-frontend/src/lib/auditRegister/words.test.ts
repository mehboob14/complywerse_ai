// node --test "src/lib/auditRegister/words.test.ts"
// The sentences of the Issue Register: what a workbook check found, what an import created, what re-linking linked, why a finding is on the reminder list. The numbers are the server's, said
// in plain words; no id, path or status code on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alsoAddedLine, localToday, readyLine, relinkLine, reminderReason, reminderSummary, remindedLine, resultLine, sheetsLine, unmatchedLine, workbookName } from './words.ts';

test('the check of a workbook says how many findings are ready and where from, in the sources\' own words', () => {
  assert.equal(readyLine({ rows: 2, by_source: { regulator: 2 } }), '2 findings are ready to import: 2 Regulator.');
  assert.equal(readyLine({ rows: 1, by_source: { it_pen: 1 } }), '1 finding is ready to import: 1 IT pen test.');
  assert.equal(readyLine({ rows: 1500, by_source: { regulator: 1000, ey: 500 } }), '1,500 findings are ready to import: 1,000 Regulator, 500 CFSB Audit-EY.');
  assert.equal(readyLine({ rows: 0, by_source: {} }), '0 findings are ready to import.');
  assert.equal(sheetsLine({ 'Regulatory ': 80, 'IA-EY Issue': 40 }), 'Regulatory 80 · IA-EY Issue 40');
});

test('owners that match nobody are listed with the first few and the number left over, and the next step is said', () => {
  assert.equal(unmatchedLine([]), null);
  assert.match(unmatchedLine(['A']) as string, /^1 owner name matches nobody and will be left unassigned: A\./);
  const many = unmatchedLine(['A', 'B', 'C', 'D', 'E', 'F']) as string;
  assert.match(many, /6 owner names match nobody/);
  assert.match(many, /A, B, C, D, and 2 more/);
  assert.match(many, /under Queues/);
});

test('an import says what it created and when the workbook is as of; a skipped row is said only when there is one', () => {
  assert.equal(resultLine({ created: 12, updated: 3, skipped: 0, as_of: '2026-09-20' }), '12 created, 3 updated, as of 20 Sep 2026.');
  assert.equal(resultLine({ created: 0, updated: 0, skipped: 2, as_of: null }), '0 created, 0 updated, 2 skipped.');
  assert.equal(alsoAddedLine(undefined), null);
  assert.equal(alsoAddedLine({ observations: 0, incidents: 0 }), null);
  assert.equal(alsoAddedLine({ observations: 3, incidents: 1 }), 'Also added: 3 MRAs to Statutory Audit and 1 self-identified event to Incidents.');
});

test('re-linking says what it linked, or that there was nothing', () => {
  assert.equal(relinkLine({}), 'Nothing new to link.');
  assert.equal(relinkLine(undefined), 'Nothing new to link.');
  assert.equal(relinkLine({ assets: 2, vulnerabilities: 1, observations: 1 }), 'Linked 2 assets, 1 vulnerability, 1 MRA to Statutory Audit.');
});

test('a reminder says why the finding is on the list, and the dialog sums them up', () => {
  const base = { issue_id: 1, reference: 'MRA-1', title: 'T', due: '2026-12-01', past_due: 0 };
  assert.equal(reminderReason({ ...base, kind: 'past_due', past_due: 12 }), '12 days past due');
  assert.equal(reminderReason({ ...base, kind: 'past_due', past_due: 1 }), '1 day past due');
  assert.equal(reminderReason({ ...base, kind: 'due_soon' }), 'due 1 Dec 2026');
  assert.equal(reminderReason({ ...base, kind: 'not_started' }), 'not started yet');
  assert.match(reminderReason({ ...base, kind: 'validation_waiting', waited: 9 }), /waiting on validation for 9 days/);
  const preview = { due_soon: 3, past_due: 2, delayed: 0, not_started: 0, validation_waiting: 1, owners: 4, escalated: 1, email: false, items: [] };
  assert.equal(reminderSummary(preview), '3 coming due, 2 past due, 1 waiting on validation');
  assert.equal(reminderSummary({ ...preview, due_soon: 0, past_due: 0, validation_waiting: 0 }), 'Nothing is due today');
  assert.equal(remindedLine(preview), 'Reminded 4 owners about 5 findings; 1 escalated to Audit Services; 1 waiting validation flagged.');
});

test('"today" is the viewer\'s own day: a click at 23:30 local is not tomorrow in UTC', () => {
  assert.equal(localToday(new Date(2026, 10, 10, 23, 30)), '2026-11-10');
  assert.equal(localToday(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
  assert.equal(workbookName('CFSB Template.xlsb'), 'CFSB Template');
  assert.equal(workbookName(null), '');
});
