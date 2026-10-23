// node --test src/lib/approvalRecord.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NONE, countedPeople, decisionLabel, decisionTone, exportReply, formatDateTime, formatDay, isMissingRoute, isWaiting, milestoneTone, noStagesLine, onBehalfLine,
  recordFileName, recordKey, roundLine, ruleLine, stageHeading, stageStatusLabel, stageSummary, stageTone, stateLabel, stateTone, statusLabel, typeLabel,
  type RecordPerson, type RecordStage,
} from './approvalRecord.ts';

const person = (name: string, decision: RecordPerson['decision'], extra: Partial<RecordPerson> = {}): RecordPerson => ({
  name, designation: null, decision, meaning: 'Reviewed by', signed_at: null, comment: null, on_behalf_of: null, signature: null, ...extra,
});
const stage = (people: RecordPerson[], extra: Partial<RecordStage> = {}): RecordStage => ({
  position: 1, label: 'Reviewed by', name: null, rule: 'all', min_count: null, status: 'pending', people, ...extra,
});

// the reader is in Karachi and reads English (British); the tests say so, they do not depend on this machine
const KHI = { locale: 'en-GB', timeZone: 'Asia/Karachi' };

test('every state of a document has its words and its tone, and an unknown one is still readable', () => {
  assert.deepEqual(
    (['published', 'approved', 'in_approval', 'in_review', 'draft', 'archived'] as const).map((s) => [stateLabel(s), stateTone(s)]),
    [['Published', 'good'], ['Approved', 'good'], ['Awaiting approval', 'warn'], ['In review', 'warn'], ['Draft', 'neutral'], ['Archived', 'neutral']],
  );
  assert.equal(stateLabel('on_hold'), 'On hold');
  assert.equal(stateTone('on_hold'), 'neutral');
  assert.equal(stateLabel(null), NONE);
  // the document's own status and type, as the rest of the page says them
  assert.equal(statusLabel('pending_review'), 'In review');
  assert.equal(statusLabel('pending_approval'), 'Awaiting approval');
  assert.equal(statusLabel('exception_applied'), 'Exception applied');
  assert.equal(statusLabel(null), NONE);
  assert.equal(typeLabel('policy'), 'Policy');
  assert.equal(typeLabel(undefined), NONE);
});

test('someone who has not signed yet is Waiting, and a decision is never told by colour alone', () => {
  assert.deepEqual(
    (['signed', 'pending', 'changes_requested', 'rejected', 'delegated'] as const).map((d) => [decisionLabel(d), decisionTone(d)]),
    [['Signed', 'good'], ['Waiting', 'warn'], ['Asked for changes', 'warn'], ['Rejected', 'bad'], ['Delegated', 'neutral']],
  );
  assert.deepEqual(
    (['complete', 'pending', 'changes_requested', 'rejected'] as const).map((s) => [stageStatusLabel(s), stageTone(s)]),
    [['Complete', 'good'], ['Pending', 'warn'], ['Changes requested', 'warn'], ['Rejected', 'bad']],
  );
  assert.equal(decisionLabel('mystery'), 'Mystery');
});

test('in a stage that is complete without them, the others who were asked are not waited for', () => {
  assert.equal(decisionLabel('pending', 'pending'), 'Waiting');
  assert.equal(decisionLabel('pending', 'changes_requested'), 'Waiting');          // held until the author resubmits: they are still to sign
  assert.equal(decisionLabel('pending', 'complete'), 'Not needed');
  assert.equal(decisionTone('pending', 'complete'), 'neutral');
  assert.equal(decisionLabel('signed', 'complete'), 'Signed');
  assert.equal(isWaiting('pending', 'pending'), true);
  assert.equal(isWaiting('pending'), true);
  assert.equal(isWaiting('pending', 'complete'), false);
  assert.equal(isWaiting('signed', 'pending'), false);
});

test('a stage says how many signed, and what it needs when that is not everyone', () => {
  const three = [person('Rana', 'signed'), person('Rafay', 'signed'), person('Uma', 'pending')];
  assert.equal(stageSummary(stage(three)), '2 of 3 signed');
  assert.equal(ruleLine(stage(three)), 'Everyone signs');
  assert.equal(ruleLine(stage(three, { rule: 'any', status: 'complete' })), 'Any one of the 3 signs');
  assert.equal(ruleLine(stage(three, { rule: 'at_least', min_count: 2 })), 'At least 2 of the 3 sign');
  assert.equal(ruleLine(stage(three, { rule: 'at_least', min_count: 9 })), 'At least 3 of the 3 sign');        // never more than there are
  assert.equal(ruleLine(stage(three, { rule: 'at_least', min_count: null })), 'At least 1 of the 3 sign');
  // one person: nothing to explain
  assert.equal(stageSummary(stage([person('Rana', 'signed')])), '1 of 1 signed');
  assert.equal(ruleLine(stage([person('Rana', 'signed')], { rule: 'any' })), '');
  assert.equal(ruleLine(stage([person('Rana', 'signed')])), '');
  // nobody asked
  assert.equal(stageSummary(stage([])), 'Nobody asked');
  assert.equal(ruleLine(stage([])), '');
});

test('someone who handed the step to a delegate is not counted twice', () => {
  const handed = [person('Rana', 'delegated'), person('Mina', 'signed', { on_behalf_of: 'Rana' }), person('Rafay', 'pending')];
  assert.deepEqual(countedPeople(handed).map((p) => p.name), ['Mina', 'Rafay']);
  assert.equal(stageSummary(stage(handed)), '1 of 2 signed');
  assert.equal(ruleLine(stage(handed, { rule: 'any' })), 'Any one of the 2 signs');
  assert.equal(onBehalfLine(handed[1]), 'on behalf of Rana');
  assert.equal(onBehalfLine(handed[2]), '');
  assert.deepEqual(countedPeople(undefined), []);
});

test('a stage is headed by what its people did and, when the route named it, by its name', () => {
  assert.equal(stageHeading({ label: 'Reviewed by', name: null }), 'Reviewed by');
  assert.equal(stageHeading({ label: 'Approved by', name: 'Board' }), 'Approved by: Board');
  assert.equal(stageHeading({ label: '', name: null }), 'Stage');
});

test('nobody asked yet: a draft says it was not sent, and the other states say there is nothing recorded', () => {
  assert.equal(noStagesLine('draft'), 'Not yet sent for review.');
  assert.equal(noStagesLine('archived'), 'No review or approval was recorded for this version.');
  assert.equal(noStagesLine('in_review'), 'No review or approval stages are recorded for this version.');
});

test('the workflow marks what went well, what is asked again and what was refused', () => {
  assert.deepEqual(
    ['Prepared', 'Sent for review', 'Stage complete', 'Changes requested', 'Resubmitted', 'Rejected', 'Approved', 'Published', 'Archived'].map(milestoneTone),
    ['neutral', 'neutral', 'good', 'warn', 'warn', 'bad', 'good', 'good', 'neutral'],
  );
  assert.equal(milestoneTone('Something new'), 'neutral');
});

test('a moment is read as UTC, shown in the reader\'s zone with the zone named', () => {
  assert.equal(formatDateTime('2026-10-21T09:30:00', KHI), '21 Oct 2026, 14:30 GMT+5');
  assert.equal(formatDateTime('2026-10-21T09:30:00', { locale: 'en-GB', timeZone: 'UTC' }), '21 Oct 2026, 09:30 UTC');
  assert.equal(formatDateTime('2026-10-21T09:30:00+05:00', { locale: 'en-GB', timeZone: 'UTC' }), '21 Oct 2026, 04:30 UTC');          // a time that names its zone is left as it is
  assert.equal(formatDateTime(null, KHI), NONE);
  assert.equal(formatDateTime('', KHI), NONE);
  assert.equal(formatDateTime('not a date', KHI), NONE);
});

test('a calendar date is that day wherever it is read, whether the server sent the day or midnight UTC', () => {
  const west = { locale: 'en-GB' };
  assert.equal(formatDay('2026-12-01', west), '1 Dec 2026');
  assert.equal(formatDay('2026-12-01T00:00:00', west), '1 Dec 2026');
  assert.equal(formatDay(null, west), NONE);
  // a day with no time in a moment's place is not shifted into the evening before
  assert.equal(formatDateTime('2026-12-01', { locale: 'en-GB', timeZone: 'America/Los_Angeles' }), '1 Dec 2026');
});

test('the round says when it began and whether it is finished', () => {
  const opts = { locale: 'en-GB', timeZone: 'UTC' };
  assert.equal(roundLine({ version: '1.2', started_at: '2026-10-21T10:00:00', completed_at: '2026-10-22T09:15:00', complete: true }, opts),
    'Version 1.2: started 21 Oct 2026, 10:00 UTC, completed 22 Oct 2026, 09:15 UTC');
  assert.equal(roundLine({ version: '1.2', started_at: '2026-10-21T10:00:00', completed_at: null, complete: false }, opts),
    'Version 1.2: started 21 Oct 2026, 10:00 UTC, still in progress');
  assert.equal(roundLine({ version: null, started_at: '2026-10-21T10:00:00', completed_at: null, complete: false }, opts),
    'started 21 Oct 2026, 10:00 UTC, still in progress');
  assert.equal(roundLine({ version: '1.0', started_at: null, completed_at: null, complete: false }, opts), '');           // never sent
  assert.equal(roundLine(null), '');
});

test('a download names its file, and says when the record could not go inside it', () => {
  assert.deepEqual(exportReply({ 'content-disposition': 'attachment; filename="Access Policy v1.2.pdf"' }, 'x.pdf'), { filename: 'Access Policy v1.2.pdf', separate: false });
  assert.deepEqual(exportReply({ 'Content-Disposition': "attachment; filename*=UTF-8''Access%20Policy.docx" }, 'x.docx'), { filename: 'Access Policy.docx', separate: false });
  assert.deepEqual(exportReply({ 'content-disposition': 'attachment; filename=register.xlsx', 'X-Approval-Record': 'separate' }, 'x'), { filename: 'register.xlsx', separate: true });
  assert.deepEqual(exportReply({ 'x-approval-record': ' Separate ' }, 'fallback.pdf'), { filename: 'fallback.pdf', separate: true });
  assert.deepEqual(exportReply({ 'x-approval-record': 'appended' }, 'fallback.pdf'), { filename: 'fallback.pdf', separate: false });
  assert.deepEqual(exportReply(undefined, 'fallback.pdf'), { filename: 'fallback.pdf', separate: false });
  assert.deepEqual(exportReply({ 'content-disposition': 'attachment; filename="100%.pdf"' }, 'x.pdf').filename, '100%.pdf');         // not a valid escape: kept as sent
});

test('the record\'s own file is named for the document and its version, in letters every system accepts', () => {
  assert.equal(recordFileName('Access Control Policy', '1.2'), 'Access Control Policy v1.2 - approval record.pdf');
  assert.equal(recordFileName('AC/DC: "Policy"?', null), 'AC DC Policy - approval record.pdf');
  assert.equal(recordFileName('', '2.0'), 'Document v2.0 - approval record.pdf');
  assert.equal(recordFileName(undefined), 'Document - approval record.pdf');
});

test('a server without the record is told from one that refuses or lacks the document', () => {
  assert.equal(isMissingRoute({ response: { status: 404, data: { detail: 'Not Found' } } }), true);
  assert.equal(isMissingRoute({ response: { status: 404 } }), true);
  assert.equal(isMissingRoute({ response: { status: 404, data: { detail: 'Version 9.9 of this document was not found.' } } }), false);
  assert.equal(isMissingRoute({ response: { status: 403, data: { detail: 'Not allowed' } } }), false);
  assert.equal(isMissingRoute(new Error('network')), false);
  assert.equal(isMissingRoute(null), false);
});

test('the record is refreshed by every refresh of its document, and each version has its own', () => {
  assert.deepEqual(recordKey(5), ['governance-document', 5, 'approval-record', 'current']);
  assert.deepEqual(recordKey(5, '1.1'), ['governance-document', 5, 'approval-record', '1.1']);
  assert.deepEqual(recordKey(5, null).slice(0, 2), ['governance-document', 5]);              // invalidateQueries(['governance-document', 5]) reaches it
});
