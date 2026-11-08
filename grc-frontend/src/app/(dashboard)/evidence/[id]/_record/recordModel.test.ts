// node --test "src/app/(dashboard)/evidence/[id]/_record/recordModel.test.ts"
// The record page's rules: where Back goes, the tabs and their numbers, who is offered what, and the timeline of a file in every state it can be in.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RECORD_TABS, backTo, editBody, editDirty, editFormOf, editProblem, fileKindOf, holderOf, offeredTo, recordTabs, reviewOf, scoreOf, timelineOf, type TimelineInput } from './recordModel.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-08T10:00:00Z');
const iso = (days: number) => new Date(NOW + days * DAY).toISOString().slice(0, 19);

const file = (over: Partial<TimelineInput> = {}): TimelineInput => ({
  uploaded_at: iso(-30), uploader_name: 'Ayesha Khan', ocr_status: 'completed', ocr_processed_at: iso(-30), quality_score: 82, latest_assessment: { id: 1, assessed_at: iso(-30) } as never,
  submitted_at: iso(-29), submitted_by: 2, status: 'pending_review', reviewed_at: null, reviewed_by: null, review_comments: null, approved_at: null, approved_by: null,
  expiry_date: iso(200), lapsed: false, is_stale: false, ...over,
});
const keys = (steps: ReturnType<typeof timelineOf>) => steps.map((s) => s.key);
const only = (steps: ReturnType<typeof timelineOf>, key: string) => steps.find((s) => s.key === key);
const names = (id: number | null | undefined) => ({ 2: 'Bilal Ahmed', 3: 'Olivia Owner' } as Record<number, string>)[id ?? 0] ?? null;

test('Back is the browser\'s history, and the Library only when there is none (the Frameworks journey and the controls link here and expect to be returned to)', () => {
  assert.equal(backTo(1), '/evidence');
  assert.equal(backTo(2), 'history');
  assert.equal(backTo(0), '/evidence');
});

test('the tabs are five, in order; the Linked and File numbers appear only when there is something to count', () => {
  assert.deepEqual([...RECORD_TABS], ['overview', 'linked', 'ai', 'file', 'details']);
  const tabs = recordTabs({ linked: 14, versions: 2 });
  assert.deepEqual(tabs.map((t) => [t.key, t.count]), [['overview', undefined], ['linked', 14], ['ai', undefined], ['file', 2], ['details', undefined]]);
  assert.deepEqual(recordTabs({ linked: 0, versions: null }).map((t) => t.count), [undefined, undefined, undefined, undefined, undefined], 'nothing linked, versions unknown: no numbers');
  assert.deepEqual(recordTabs({}).map((t) => t.label), ['Overview', 'Linked', 'AI review', 'File & versions', 'Details']);
});

test('the score is the file\'s, else the audit readiness of its rating, as a whole 0-100 number', () => {
  assert.equal(scoreOf({ quality_score: 0.82, latest_assessment: null }), 82);
  assert.equal(scoreOf({ quality_score: 82, latest_assessment: null }), 82);
  assert.equal(scoreOf({ quality_score: null, latest_assessment: { audit_readiness: 0.4 } as never }), 40);
  assert.equal(scoreOf({ quality_score: null, latest_assessment: null }), null);
});

test('a draft is sent by anyone; a pending file is decided by a person who may edit; a lapsed approved file is renewed by one who may edit; delete needs delete', () => {
  const base = { status: 'draft', ocr_status: 'completed', file_path: 'x.pdf', expiry_date: iso(100), lapsed: false, is_stale: false };
  const none = { canEdit: false, canDelete: false };
  const all = { canEdit: true, canDelete: true };
  assert.deepEqual([offeredTo(base, none, NOW).submit, offeredTo(base, none, NOW).primary], [true, 'submit'], 'a read-only person may still send a draft: the server lets any signed-in person');
  assert.equal(offeredTo({ ...base, status: 'pending_review' }, none, NOW).decide, false);
  assert.equal(offeredTo({ ...base, status: 'pending_review' }, all, NOW).decide, true);
  assert.equal(offeredTo({ ...base, status: 'pending_review' }, all, NOW).primary, null, 'the decision has its own bar');
  const lapsed = { ...base, status: 'approved', expiry_date: iso(-3) };
  assert.deepEqual([offeredTo(lapsed, none, NOW).renew, offeredTo(lapsed, all, NOW).renew, offeredTo(lapsed, all, NOW).primary], [false, true, 'renew']);
  assert.equal(offeredTo({ ...base, status: 'approved' }, all, NOW).renew, false, 'in date: nothing to renew');
  assert.equal(offeredTo({ ...lapsed, status: 'archived' }, all, NOW).renew, false, 'an archived file never lapses');
  assert.deepEqual([offeredTo(base, all, NOW).edit, offeredTo(base, all, NOW).remove, offeredTo(base, none, NOW).edit, offeredTo(base, none, NOW).remove], [true, true, false, false]);
  assert.equal(offeredTo({ ...base, file_path: null }, all, NOW).openFile, false);
  assert.equal(offeredTo({ ...base, ocr_status: 'failed' }, all, NOW).readAgain, true);
  assert.equal(offeredTo({ ...base, ocr_status: 'not_applicable' }, all, NOW).readAgain, false);
  assert.equal(offeredTo({ ...base, ocr_status: 'completed' }, all, NOW).readAgain, false);
});

test('timeline: a pending file that was read, rated and sent shows the wait as the step in progress, then how long it is valid', () => {
  const t = timelineOf(file(), NOW, { nameOf: names });
  assert.deepEqual(keys(t), ['uploaded', 'read', 'rated', 'sent', 'decision', 'validity']);
  assert.deepEqual(t.map((s) => s.state), ['done', 'done', 'done', 'done', 'now', 'todo']);
  assert.equal(only(t, 'uploaded')?.who, 'Ayesha Khan');
  assert.equal(only(t, 'rated')?.text, '82% mature');
  assert.equal(only(t, 'sent')?.who, 'Bilal Ahmed');
  assert.equal(only(t, 'decision')?.label, 'Waiting for review');
  assert.equal(only(t, 'validity')?.label, 'Valid until');
  assert.equal(only(t, 'validity')?.text, '200 days left');
});

test('timeline: an approved file names who approved it and when; a name that cannot be looked up is just left off', () => {
  const approved = file({ status: 'approved', approved_at: iso(-25), approved_by: 3 });
  assert.deepEqual([only(timelineOf(approved, NOW, { nameOf: names }), 'decision')?.label, only(timelineOf(approved, NOW, { nameOf: names }), 'decision')?.who], ['Approved', 'Olivia Owner']);
  assert.equal(only(timelineOf(approved, NOW), 'decision')?.who, null);
});

test('timeline: a file sent back says so with the reviewer\'s note, and the file is a draft that was not sent again', () => {
  const back = file({ status: 'draft', submitted_at: null, submitted_by: null, reviewed_at: iso(-5), reviewed_by: 3, review_comments: 'Please add the signed page.' });
  const t = timelineOf(back, NOW, { nameOf: names });
  assert.equal(only(t, 'decision')?.label, 'Sent back');
  assert.equal(only(t, 'decision')?.state, 'warn');
  assert.equal(only(t, 'decision')?.text, 'Please add the signed page.');
  assert.equal(only(t, 'decision')?.who, 'Olivia Owner');
  assert.equal(only(t, 'sent')?.label, 'Not sent for review');
  const long = timelineOf({ ...back, review_comments: 'x'.repeat(400) }, NOW);
  assert.ok((only(long, 'decision')?.text ?? '').length <= 141, 'a long note is cut for the strip; the Details tab has all of it');
});

test('timeline: a draft never reviewed has a to-do decision; a note on an approval that came after is not a return', () => {
  const draft = file({ status: 'draft', submitted_at: null, submitted_by: null });
  assert.equal(only(timelineOf(draft, NOW), 'decision')?.label, 'Not reviewed yet');
  const renewed = file({ status: 'draft', submitted_at: null, reviewed_at: iso(-60), review_comments: 'old note', approved_at: iso(-50) });
  assert.equal(only(timelineOf(renewed, NOW), 'decision')?.label, 'Not reviewed yet', 'approved after the note: the note is history, not a return');
});

test('timeline: a lapsed file ends in a red step; one ending within 30 days is amber; a file with no expiry has no validity step; an archived file none', () => {
  const lapsed = timelineOf(file({ status: 'approved', approved_at: iso(-100), expiry_date: iso(-9) }), NOW);
  assert.deepEqual([only(lapsed, 'validity')?.label, only(lapsed, 'validity')?.state, only(lapsed, 'validity')?.text], ['Lapsed', 'bad', 'Expired 9 days ago']);
  const soon = timelineOf(file({ status: 'approved', approved_at: iso(-100), expiry_date: iso(12) }), NOW);
  assert.deepEqual([only(soon, 'validity')?.state, only(soon, 'validity')?.text], ['warn', '12 days left']);
  assert.equal(only(timelineOf(file({ expiry_date: null }), NOW), 'validity'), undefined);
  assert.equal(only(timelineOf(file({ status: 'archived', expiry_date: iso(-3) }), NOW), 'validity'), undefined);
  const flagged = timelineOf(file({ status: 'approved', approved_at: iso(-100), expiry_date: iso(90), is_stale: true }), NOW);
  assert.equal(only(flagged, 'validity')?.label, 'Lapsed', 'a file the server calls lapsed is lapsed whatever its date says');
});

test('timeline: the text step and the rating step say where they stand while they run and when they failed', () => {
  const reading = timelineOf(file({ ocr_status: 'processing', ocr_processed_at: null, quality_score: null, latest_assessment: null }), NOW, { review: { status: 'running', step: 'reading' } });
  assert.deepEqual([only(reading, 'read')?.label, only(reading, 'read')?.state, only(reading, 'rated')?.label, only(reading, 'rated')?.state], ['Reading the file', 'now', 'Reading the file', 'now']);
  const rating = timelineOf(file({ quality_score: null, latest_assessment: null }), NOW, { review: { status: 'running', step: 'rating' } });
  assert.equal(only(rating, 'rated')?.label, 'AI rating');
  const failed = timelineOf(file({ quality_score: null, latest_assessment: null }), NOW, { review: { status: 'failed', error: 'x' } });
  assert.deepEqual([only(failed, 'rated')?.label, only(failed, 'rated')?.state], ['Not rated', 'bad']);
  const unread = timelineOf(file({ ocr_status: 'failed', ocr_processed_at: null, quality_score: null, latest_assessment: null }), NOW);
  assert.deepEqual([only(unread, 'read')?.label, only(unread, 'read')?.state], ['Could not be read', 'bad']);
  const unrateable = timelineOf(file({ quality_score: null, latest_assessment: null }), NOW, { review: { status: 'unavailable', error: 'x' } });
  assert.equal(only(unrateable, 'rated')?.label, "Can't be rated by AI");
  const stalled = timelineOf(file({ quality_score: null, latest_assessment: null }), NOW, { ocrStalled: true });
  assert.equal(only(stalled, 'rated')?.state, 'warn');
  const notRated = timelineOf(file({ quality_score: null, latest_assessment: null }), NOW);
  assert.deepEqual([only(notRated, 'rated')?.label, only(notRated, 'rated')?.state], ['Not rated yet', 'todo']);
});

test('timeline: a file with no text to read (a picture type) has no reading step', () => {
  assert.equal(only(timelineOf(file({ ocr_status: 'not_applicable' }), NOW), 'read'), undefined);
});

test('a rejected file keeps the reviewer\'s words; the holder of a file is its owner, else its uploader, else nobody; the live review beats the record\'s copy', () => {
  const rejected = timelineOf(file({ status: 'rejected', reviewed_at: iso(-2), reviewed_by: 3, review_comments: 'Not acceptable.' }), NOW, { nameOf: names });
  assert.deepEqual([only(rejected, 'decision')?.label, only(rejected, 'decision')?.state, only(rejected, 'decision')?.text], ['Rejected', 'bad', 'Not acceptable.']);
  assert.equal(holderOf({ owner_name: 'Bilal', uploader_name: 'Ayesha' }), 'Bilal');
  assert.equal(holderOf({ owner_name: null, uploader_name: 'Ayesha' }), 'Ayesha');
  assert.equal(holderOf({ owner_name: null, uploader_name: null }), null);
  assert.deepEqual(reviewOf({ status: 'done' }, { status: 'running' }), { status: 'done' });
  assert.deepEqual(reviewOf(undefined, { status: 'running' }), { status: 'running' });
  assert.equal(reviewOf(undefined, undefined), null);
});

test('a file is told by its kind in words, from its name or its type, and never as a raw type string', () => {
  assert.equal(fileKindOf('report.pdf', 'application/pdf'), 'PDF document');
  assert.equal(fileKindOf('minutes.DOCX', null), 'Word document');
  assert.equal(fileKindOf(null, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'Spreadsheet');
  assert.equal(fileKindOf('access.csv', 'text/csv'), 'Spreadsheet');
  assert.equal(fileKindOf('shot.PNG', 'image/png'), 'Image');
  assert.equal(fileKindOf('notes.txt', 'text/plain'), 'Text file');
  assert.equal(fileKindOf('pack.zip', 'application/zip'), 'Archive');
  assert.equal(fileKindOf('config.conf', 'application/octet-stream'), 'CONF file');
  assert.equal(fileKindOf('noending', 'application/octet-stream'), 'File');
  assert.equal(fileKindOf(null, null), null);
});

test('the edit form starts as the file stands, keeps the collection day as stored, and sends the fields the page always sent', () => {
  const start = editFormOf({ name: 'Firewall export', description: null, evidence_type: 'log', collection_date: '2026-11-12T00:00:00', validity_period_days: 365, source_system: null });
  assert.deepEqual(start, { name: 'Firewall export', description: '', evidence_type: 'log', collection_date: '2026-11-12', validity_period_days: '365', source_system: '' });
  assert.deepEqual(editBody(start, { owner: 'x' }), {
    name: 'Firewall export', description: null, evidence_type: 'log', collection_date: '2026-11-12T00:00:00', validity_period_days: 365, source_system: null, custom_values: { owner: 'x' },
  });
  assert.deepEqual(editBody({ ...start, collection_date: '', validity_period_days: '', evidence_type: '' }, null), {
    name: 'Firewall export', description: null, evidence_type: null, collection_date: null, validity_period_days: null, source_system: null, custom_values: null,
  });
  assert.equal(editDirty(start, start), false);
  assert.equal(editDirty({ ...start, description: 'x' }, start), true);
});

test('the edit form needs a name and a whole number of days for the validity', () => {
  const ok = editFormOf({ name: 'A', description: null, evidence_type: null, collection_date: null, validity_period_days: null, source_system: null });
  assert.equal(editProblem(ok), null);
  assert.equal(editProblem({ ...ok, name: '   ' }), 'Enter a name.');
  assert.match(editProblem({ ...ok, validity_period_days: '0' }) ?? '', /whole number/);
  assert.match(editProblem({ ...ok, validity_period_days: '1.5' }) ?? '', /whole number/);
  assert.equal(editProblem({ ...ok, validity_period_days: '90' }), null);
});
