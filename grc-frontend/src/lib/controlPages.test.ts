// node --test src/lib/controlPages.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NONE, type ApprovalRecord, type ControlledContent, type RecordPerson, type RecordStage } from './approvalRecord.ts';
import {
  SECTION_TITLE, approvalRows, controlledContentKey, controlledCopy, controlledFileKey, cutComment, descriptionRows, formatPageDate, personCell,
  recordStamp, referenceLine, revisionRows, signatureCaption, stageNote, stageTitle, stagesOf, usableSegments,
} from './controlPages.ts';

const person = (name: string, decision: RecordPerson['decision'], extra: Partial<RecordPerson> = {}): RecordPerson => ({
  name, designation: null, decision, meaning: 'Reviewed by', signed_at: null, comment: null, on_behalf_of: null, signature: null, ...extra,
});
const stage = (people: RecordPerson[], extra: Partial<RecordStage> = {}): RecordStage => ({
  position: 1, label: 'Reviewed by', name: null, rule: 'all', min_count: null, status: 'pending', people, ...extra,
});
const sig = { id: 7, drawn: true, seal_short: 'abcdef123456' };

// the reader is in Karachi and reads English (British); the tests say so, they do not depend on this machine
const KHI = { locale: 'en-GB', timeZone: 'Asia/Karachi' };

// ── what to draw, and what to draw when the answer is not what was expected ───────────────────────────────
test('a platform document is drawn in segments when the answer has some, and as it is otherwise', () => {
  const record = {} as ApprovalRecord;
  const ok: ControlledContent = {
    kind: 'markdown', record,
    segments: [{ type: 'markdown', text: '## 1. Purpose' }, { type: 'slot', slot: 'description', heading: false }, { type: 'slot', slot: 'signoff', heading: true }],
  };
  assert.deepEqual(usableSegments(ok), ok.segments);
  // a Word or PDF file has its pages inside the file; nothing to cut
  assert.equal(usableSegments({ kind: 'file', segments: null, record }), null);
  assert.equal(usableSegments({ kind: 'file', segments: [{ type: 'markdown', text: 'x' }], record }), null);
  // loading, failed, an empty answer, a payload full of nulls: the document as it is, never a blank
  assert.equal(usableSegments(undefined), null);
  assert.equal(usableSegments(null), null);
  assert.equal(usableSegments({ kind: 'markdown', segments: null, record }), null);
  assert.equal(usableSegments({ kind: 'markdown', segments: [], record }), null);
  assert.equal(usableSegments({ kind: 'markdown', segments: [null, { type: 'markdown' }, { type: 'slot' }] as never, record }), null);
});

test('a malformed segment is dropped and the rest are still drawn; a slot this version does not know is not drawn', () => {
  const got = usableSegments({
    kind: 'markdown', record: {} as ApprovalRecord,
    segments: [{ type: 'markdown', text: 'a' }, null, { type: 'slot', slot: 'mystery' }, { type: 'markdown', text: 5 }, { type: 'slot', slot: 'revision' }] as never,
  });
  assert.deepEqual(got, [{ type: 'markdown', text: 'a' }, { type: 'slot', slot: 'revision' }]);
});

test('the pages are refreshed by every refresh of their document, and each version read has its own', () => {
  assert.deepEqual(controlledContentKey(5), ['governance-document', 5, 'controlled-content', 'current', '']);
  assert.deepEqual(controlledContentKey(5, '1.1'), ['governance-document', 5, 'controlled-content', '1.1', '']);
  assert.deepEqual(controlledContentKey(5, null).slice(0, 2), ['governance-document', 5]);          // invalidateQueries(['governance-document', 5]) reaches it
  // the text the document has now is in the key, so a text that changed is never shown from the pages kept for the one before it
  assert.deepEqual(controlledContentKey(5, null, '1.2'), ['governance-document', 5, 'controlled-content', 'current', '1.2']);
  assert.notDeepEqual(controlledContentKey(5, null, '1.2'), controlledContentKey(5, null, '1.3'));
  assert.deepEqual(controlledFileKey(5, null, 'a'), ['governance-document', 5, 'controlled-file', 'current', 'a']);
  assert.deepEqual(controlledFileKey(5, 31, 'a'), ['governance-document', 5, 'controlled-file', 31, 'a']);
  assert.deepEqual(controlledFileKey(5, 31, 'a').slice(0, 2), ['governance-document', 5]);
  assert.notDeepEqual(controlledFileKey(5, 31, 'a'), controlledFileKey(5, 31, 'b'));              // a changed record is a new file
});

test('a stamp of the record changes with the version, the status and the row\'s update, and is the same otherwise', () => {
  const doc = { current_version: '1.2', status: 'pending_review', updated_at: '2026-10-21T09:30:00' };
  assert.equal(recordStamp(doc), recordStamp({ ...doc }));
  assert.notEqual(recordStamp(doc), recordStamp({ ...doc, status: 'approved' }));
  assert.notEqual(recordStamp(doc), recordStamp({ ...doc, current_version: '1.3' }));
  assert.notEqual(recordStamp(doc), recordStamp({ ...doc, updated_at: '2026-10-21T09:31:00' }));
  assert.equal(recordStamp(null), '||');
  assert.equal(recordStamp(undefined), '||');
});

test('a file says whether the pages are inside it, and no word from the server is no claim either way', () => {
  assert.equal(controlledCopy({ 'x-controlled-copy': 'true' }), true);
  assert.equal(controlledCopy({ 'X-Controlled-Copy': ' False ' }), false);
  assert.equal(controlledCopy({}), null);
  assert.equal(controlledCopy(undefined), null);
  assert.equal(controlledCopy({ 'x-controlled-copy': 'maybe' }), null);
});

// ── dates and words ─────────────────────────────────────────────────────────────────────────────────────────
test('a calendar date is that day wherever it is read; a moment is the day it was for the reader', () => {
  assert.equal(formatPageDate('2026-12-01', KHI), '1 Dec 2026');
  assert.equal(formatPageDate('2026-12-01T00:00:00', { locale: 'en-GB', timeZone: 'America/Los_Angeles' }), '1 Dec 2026');         // the server's midnight is not shifted into the evening before
  assert.equal(formatPageDate('2026-12-01T00:00:00.000', { locale: 'en-GB', timeZone: 'America/Los_Angeles' }), '1 Dec 2026');
  assert.equal(formatPageDate('2026-10-21T22:30:00', KHI), '22 Oct 2026');                                                       // 03:30 the next morning in Karachi
  assert.equal(formatPageDate('2026-10-21T22:30:00', { locale: 'en-GB', timeZone: 'UTC' }), '21 Oct 2026');
  assert.equal(formatPageDate(null, KHI), NONE);
  assert.equal(formatPageDate('', KHI), NONE);
  assert.equal(formatPageDate('not a date', KHI), NONE);
});

test('a long comment is cut at a word with an ellipsis, a short one is left as it is, and nothing is nothing', () => {
  assert.equal(cutComment('Reviewed against the access policy.'), 'Reviewed against the access policy.');
  assert.equal(cutComment('  two   lines\n of  text '), 'two lines of text');
  const long = `${'word '.repeat(80)}end`;
  const cut = cutComment(long, 100);
  assert.ok(cut.endsWith('…'));
  assert.ok(cut.length <= 101);
  assert.ok(!/\s…$/.test(cut));                                  // not "word …"
  assert.ok(long.startsWith(cut.slice(0, -1)));                  // a cut, never a rewrite
  assert.equal(cutComment('x'.repeat(300), 240), `${'x'.repeat(240)}…`);          // no word to cut at: cut where it is
  assert.equal(cutComment(null), '');
  assert.equal(cutComment(undefined), '');
  assert.equal(cutComment('   '), '');
});

// ── the review and approval pages ───────────────────────────────────────────────────────────────────────────
test('the stages drawn are those that are there, each with the people that are there', () => {
  const rana = person('Rana', 'signed');
  assert.deepEqual(stagesOf({ stages: [stage([rana, null as never]), null as never, stage(undefined as never, { position: 2 })] }).map((s) => [s.position, s.people.length]), [[1, 1], [2, 0]]);
  assert.deepEqual(stagesOf({ stages: [stage([rana])] })[0].people, [rana]);                      // nobody is changed, only left out
  assert.deepEqual(stagesOf(null), []);
  assert.deepEqual(stagesOf({}), []);
  assert.deepEqual(stagesOf({ stages: 'nope' as never }), []);
});

test('a stage is headed by its number and what its people did, and by its own name when the route gave one', () => {
  assert.equal(stageTitle({ position: 1, label: 'Reviewed by', name: null }), 'STAGE 1 — REVIEWED BY');
  assert.equal(stageTitle({ position: 3, label: 'Approved by', name: 'Board approval' }), 'STAGE 3 — APPROVED BY · Board approval');
  assert.equal(stageTitle({ position: 2, label: '', name: null }), 'STAGE 2');
  assert.equal(stageTitle({ position: 2, label: '', name: 'Legal' }), 'STAGE 2 · Legal');
  assert.equal(stageTitle({ position: undefined as never, label: 'Reviewed by', name: null }), 'STAGE — REVIEWED BY');
});

test('a stage says how far it is, and what it needs only when that is not everyone', () => {
  const three = [person('Rana', 'signed'), person('Rafay', 'signed'), person('Uma', 'signed')];
  assert.equal(stageNote(stage(three, { status: 'complete' })), 'Complete · 3 of 3 signed');
  assert.equal(stageNote(stage([three[0], three[1], person('Uma', 'pending')])), 'Pending · 2 of 3 signed');
  assert.equal(stageNote(stage([three[0], person('Rafay', 'pending'), person('Uma', 'pending')], { rule: 'any', status: 'complete' })),
    'Complete · 1 of 3 signed · Any one of the 3 signs');
  assert.equal(stageNote(stage(three, { rule: 'at_least', min_count: 2 })), 'Pending · 3 of 3 signed · At least 2 of the 3 sign');
  assert.equal(stageNote(stage([person('Rana', 'signed')], { rule: 'any', status: 'complete' })), 'Complete · 1 of 1 signed');         // one person: nothing to explain
  assert.equal(stageNote(stage([], { status: 'pending' })), 'Pending · Nobody asked');
  assert.equal(stageNote(stage([person('Rana', 'signed')], { status: null as never })), '1 of 1 signed');                 // an unknown status is not a dash in the bar
  assert.equal(stageNote(stage([person('Rana', 'changes_requested')], { status: 'changes_requested' })), 'Changes requested · 0 of 1 signed');
});

test('an empty place for a signature says why it is empty', () => {
  assert.equal(signatureCaption(person('Uma', 'pending'), 'pending'), 'Awaiting signature');
  assert.equal(signatureCaption(person('Uma', 'pending'), 'changes_requested'), 'Awaiting signature');
  assert.equal(signatureCaption(person('Uma', 'pending'), 'complete'), 'Not required');
  assert.equal(signatureCaption(person('Uma', 'signed')), 'No drawn signature');                    // signed before drawn signatures were asked for
  assert.equal(signatureCaption(person('Uma', 'signed', { signature: sig })), '');
  assert.equal(signatureCaption(person('Uma', 'pending', { signature: sig })), '');
  assert.equal(signatureCaption(person('Uma', 'rejected')), '');
  assert.equal(signatureCaption(person('Uma', 'changes_requested')), '');
});

test('a person\'s cell names them, and says what they did and when, in the reader\'s zone', () => {
  const s = stage([], { status: 'complete' });
  const signed = person('Rana Qureshi', 'signed', { designation: 'Chief Risk Officer', signed_at: '2026-10-21T09:30:00', signature: sig, comment: 'Reviewed against the policy.' });
  assert.deepEqual(personCell(signed, s, KHI), {
    name: 'Rana Qureshi', designation: 'Chief Risk Officer', behalf: '', status: 'Signed 21 Oct 2026, 14:30 GMT+5', caption: '',
    comment: 'Reviewed against the policy.', fullComment: 'Reviewed against the policy.',
  });
  assert.equal(personCell(person('Rafay', 'rejected', { signed_at: '2026-10-21T09:30:00' }), s, KHI).status, 'Rejected 21 Oct 2026, 14:30 GMT+5');
  assert.equal(personCell(person('Rafay', 'changes_requested', { signed_at: '2026-10-21T09:30:00' }), s, KHI).status, 'Asked for changes 21 Oct 2026, 14:30 GMT+5');
  // no time, or one that is not a time: still says what they did
  assert.equal(personCell(person('Rafay', 'signed'), s, KHI).status, 'Signed');
  assert.equal(personCell(person('Rafay', 'signed', { signed_at: 'garbage' }), s, KHI).status, 'Signed');
});

test('someone who has not signed is Waiting, or Not needed once their stage is complete without them', () => {
  const waiting = person('Uma', 'pending');
  assert.equal(personCell(waiting, stage([waiting], { status: 'pending' }), KHI).status, 'Waiting');
  assert.equal(personCell(waiting, stage([waiting], { status: 'pending' }), KHI).caption, 'Awaiting signature');
  assert.equal(personCell(waiting, stage([waiting], { status: 'complete', rule: 'any' }), KHI).status, 'Not needed');
  assert.equal(personCell(waiting, stage([waiting], { status: 'complete', rule: 'any' }), KHI).caption, 'Not required');
});

test('a delegate signs on behalf of someone, and the one who handed the step on says to whom', () => {
  const rana = person('Rana', 'delegated');
  const mina = person('Mina', 'signed', { on_behalf_of: 'Rana', signed_at: '2026-10-21T09:30:00', signature: sig });
  const s = stage([rana, mina]);
  assert.equal(personCell(rana, s, KHI).status, 'Delegated to Mina');
  assert.equal(personCell(mina, s, KHI).behalf, 'on behalf of Rana');
  assert.equal(personCell(person('Zed', 'delegated'), s, KHI).status, 'Delegated');                   // nobody found who took it
});

test('a cell is made of whatever the payload has: nothing breaks on nulls', () => {
  const c = personCell({ name: null, designation: null, decision: 'pending', meaning: null, signed_at: null, comment: null, on_behalf_of: null, signature: null } as never,
    { status: 'pending', people: undefined } as never, KHI);
  assert.deepEqual(c, { name: NONE, designation: '', behalf: '', status: 'Waiting', caption: 'Awaiting signature', comment: '', fullComment: '' });
});

test('a long comment is cut in the cell and whole for the tooltip', () => {
  const whole = `${'Needs a clearer retention period. '.repeat(20)}Done.`;
  const c = personCell(person('Rana', 'signed', { comment: whole }), stage([]), KHI);
  assert.ok(c.comment.length < whole.length && c.comment.endsWith('…'));
  assert.equal(c.fullComment, whole.trim());
});

// ── the description ─────────────────────────────────────────────────────────────────────────────────────────
const control = {
  title: 'Access Control Policy', code: 'POL-001', version: '1.2', type: 'policy', type_label: 'Policy', classification: 'Internal',
  owner: 'Olivia Owner', department: 'Compliance', ownership: 'Governance and Risk Office', approving_authority: 'Risk Committee',
  date_of_approval: '2026-10-22T09:15:00', date_of_implementation: '2026-11-01T00:00:00', review_frequency: 'Every 12 months',
  last_approval_date: '2025-10-20T00:00:00', next_review_date: '2027-10-22T00:00:00', status: 'published',
};
const document = {
  id: 5, code: 'POL-001', title: 'Info Sec (document row)', type: 'policy', classification: 'Internal', version: '1.2', status: 'published', department: 'Compliance',
  owner: 'Olivia Owner', author: 'Olivia Owner', effective_date: '2026-11-01T00:00:00', next_review_date: '2027-10-22T00:00:00', approved_at: '2026-10-22T09:15:00',
  published_at: null, published_by: null,
};

test('the description lists what the platform keeps for the document, labelled as a policy page labels it', () => {
  const rows = descriptionRows({ control, document }, { locale: 'en-GB', timeZone: 'UTC' });
  assert.deepEqual(rows, [
    { label: 'Title', value: 'Access Control Policy' },
    { label: 'Document code', value: 'POL-001' },
    { label: 'Version', value: '1.2' },
    { label: 'Document type', value: 'Policy' },
    { label: 'Classification', value: 'Internal' },
    { label: 'Ownership', value: 'Governance and Risk Office' },
    { label: 'Owner', value: 'Olivia Owner' },
    { label: 'Department', value: 'Compliance' },
    { label: 'Approving authority', value: 'Risk Committee' },
    { label: 'Date of approval', value: '22 Oct 2026' },
    { label: 'Date of implementation', value: '1 Nov 2026' },
    { label: 'Review frequency', value: 'Every 12 months' },
    { label: 'Last approval date', value: '20 Oct 2025' },
    { label: 'Next review date', value: '22 Oct 2027' },
    { label: 'Status', value: 'Published' },
  ]);
});

test('a row with nothing in it is left out, except the title, the version and the status', () => {
  const rows = descriptionRows({ control: { ...control, ownership: null, approving_authority: '  ', date_of_approval: null, last_approval_date: null, review_frequency: null, code: null }, document: { ...document, code: null, approved_at: null } });
  const labels = rows.map((r) => r.label);
  for (const gone of ['Ownership', 'Approving authority', 'Date of approval', 'Last approval date', 'Review frequency', 'Document code']) assert.ok(!labels.includes(gone), gone);
  for (const kept of ['Title', 'Version', 'Status', 'Owner', 'Department', 'Next review date']) assert.ok(labels.includes(kept), kept);
});

test('a control field that is missing falls back to the document\'s own', () => {
  const rows = descriptionRows({ control: null, document }, { locale: 'en-GB', timeZone: 'UTC' });
  const by = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(by['Title'], 'Info Sec (document row)');
  assert.equal(by['Document type'], 'Policy');
  assert.equal(by['Date of approval'], '22 Oct 2026');
  assert.equal(by['Date of implementation'], '1 Nov 2026');
  assert.equal(by['Next review date'], '22 Oct 2027');
  assert.equal(by['Status'], 'Published');
  // the control's own value wins over the document row's
  assert.equal(Object.fromEntries(descriptionRows({ control, document }).map((r) => [r.label, r.value]))['Title'], 'Access Control Policy');
});

test('a document type is said by its label, else made readable, else left out', () => {
  assert.equal(descriptionRows({ control: { ...control, type_label: null, type: 'standard' }, document }).find((r) => r.label === 'Document type')?.value, 'Standard');
  assert.equal(descriptionRows({ control: { ...control, type_label: null, type: null }, document: { ...document, type: null } }).find((r) => r.label === 'Document type'), undefined);
});

test('nothing at all still gives the three rows every description has', () => {
  assert.deepEqual(descriptionRows(null), [{ label: 'Title', value: NONE }, { label: 'Version', value: NONE }, { label: 'Status', value: NONE }]);
  assert.deepEqual(descriptionRows({ control: undefined, document: undefined }).map((r) => r.value), [NONE, NONE, NONE]);
  // a payload full of nulls
  const nulls = Object.fromEntries(Object.keys(control).map((k) => [k, null]));
  assert.deepEqual(descriptionRows({ control: nulls as never, document: null as never }).map((r) => r.label), ['Title', 'Version', 'Status']);
});

// ── revision and approval history ───────────────────────────────────────────────────────────────────────────
test('the revision history keeps its order, and the version being worked on is marked in progress', () => {
  const rows = revisionRows([
    { version: '1.0', date: '2026-10-01T00:00:00', change_type: 'initial', summary: 'First issue of the policy', updated_by: 'Olivia Owner', released: true },
    { version: '1.1', date: '2026-10-21T09:30:00', change_type: 'minor', summary: null, updated_by: null, released: true },
    { version: '1.2', date: null, change_type: null, summary: 'Added a retention period.', updated_by: 'Rana Qureshi', released: false },
  ], { locale: 'en-GB', timeZone: 'UTC' });
  assert.deepEqual(rows, [
    { version: '1.0', mark: '', date: '1 Oct 2026', changeType: 'Initial', summary: 'First issue of the policy', updatedBy: 'Olivia Owner' },
    { version: '1.1', mark: '', date: '21 Oct 2026', changeType: 'Minor', summary: NONE, updatedBy: NONE },
    { version: '1.2', mark: 'In progress', date: NONE, changeType: NONE, summary: 'Added a retention period.', updatedBy: 'Rana Qureshi' },
  ]);
});

test('a revision history that is missing, empty or malformed is no rows, never an error', () => {
  assert.deepEqual(revisionRows(undefined), []);
  assert.deepEqual(revisionRows(null), []);
  assert.deepEqual(revisionRows([]), []);
  assert.deepEqual(revisionRows('nope' as never), []);
  assert.deepEqual(revisionRows([null, { version: null, date: null, change_type: null, summary: null, updated_by: null }] as never),
    [{ version: NONE, mark: '', date: NONE, changeType: NONE, summary: NONE, updatedBy: NONE }]);          // a row that does not say it is in progress was released
});

test('the approval history names who reviewed and who approved each version, with their designations and, for an approver, the stage', () => {
  const rows = approvalRows([
    {
      version: '1.0', approval_date: '2026-10-02T00:00:00',
      reviewed_by: [{ name: 'Sana Mirza', designation: 'CISO' }, { name: 'Imran Qadir', designation: null }],
      approved_by: [{ name: 'Risk Committee', designation: null, stage: null }, { name: 'Nadia Khan', designation: 'CEO', stage: 'Board approval' }],
    },
    { version: '1.1', approval_date: null, reviewed_by: [], approved_by: [] },
  ], { locale: 'en-GB', timeZone: 'UTC' });
  assert.deepEqual(rows, [
    { version: '1.0', reviewers: ['Sana Mirza, CISO', 'Imran Qadir'], approvers: ['Risk Committee', 'Nadia Khan, CEO (Board approval)'], date: '2 Oct 2026' },
    { version: '1.1', reviewers: [], approvers: [], date: NONE },
  ]);
  assert.deepEqual(approvalRows(undefined), []);
  assert.deepEqual(approvalRows([{ version: '1.0', approval_date: null, reviewed_by: null, approved_by: [{ name: null }, null] }] as never),
    [{ version: '1.0', reviewers: [], approvers: [], date: NONE }]);
});

test('the reference of the pages is something to quote, with when they were made', () => {
  assert.equal(referenceLine({ reference: 'DAR-5-1.2-ab12cd34', generated_at: '2026-10-25T05:00:00' }, KHI), 'Record reference DAR-5-1.2-ab12cd34 · Generated 25 Oct 2026, 10:00 GMT+5');
  assert.equal(referenceLine({ reference: 'DAR-5-1.2-ab12cd34', generated_at: '' }, KHI), 'Record reference DAR-5-1.2-ab12cd34');
  assert.equal(referenceLine({ reference: '', generated_at: '2026-10-25T05:00:00' }, KHI), 'Generated 25 Oct 2026, 10:00 GMT+5');
  assert.equal(referenceLine(null), '');
});

test('the three pages have their own titles for a document that has no section of its own', () => {
  assert.deepEqual(SECTION_TITLE, { description: 'Document Description', signoff: 'Review and Approval', revision: 'Revision History' });
});
