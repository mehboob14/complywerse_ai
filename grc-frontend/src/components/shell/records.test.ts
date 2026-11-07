// node --test src/components/shell/records.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { committeeChoices, committeeHits, committeesOf, documentHits, listOf, meetingChoices, meetingHits, recordIdsIn } from './records.ts';

test('listOf: a plain array or { items, total }; the total is the server\'s when it says one, never less than what came', () => {
  assert.deepEqual(listOf([{ id: 1 }, { id: 2 }]), { items: [{ id: 1 }, { id: 2 }], total: 2 });
  assert.deepEqual(listOf({ items: [{ id: 1 }], total: 1248 }), { items: [{ id: 1 }], total: 1248 });
  assert.deepEqual(listOf({ items: [{ id: 1 }, { id: 2 }], total: 1 }), { items: [{ id: 1 }, { id: 2 }], total: 2 }, 'a total smaller than the rows is not believed');
  assert.deepEqual(listOf({ items: [1, null, 'x', { id: 3 }] }), { items: [{ id: 3 }], total: 1 }, 'a row that is not an object is skipped');
  for (const odd of [null, undefined, 5, 'x', {}, { items: 'no' }]) assert.deepEqual(listOf(odd), { items: [], total: 0 });
});

test('documents: the brief list becomes rows that open the document; a row without an id or a title is skipped; long titles are cut', () => {
  const hits = documentHits([
    { id: 44, title: '  Remote   Work Policy ', doc_type: 'information_security_policy', current_version: '2.1', status: 'published' },
    { id: '45', title: 'Standard', doc_type: null },
    { id: null, title: 'No id' },
    { id: 46, title: '' },
    { id: 47, title: 'T'.repeat(500) },
  ]);
  assert.deepEqual(hits.map((h) => h.href), ['/governance/documents/44', '/governance/documents/45', '/governance/documents/47']);
  assert.equal(hits[0].label, 'Remote Work Policy');
  assert.equal(hits[0].sub, 'Information security policy v2.1');
  assert.equal(hits[1].sub, 'Document');
  assert.equal(hits[2].label.length, 200);
  assert.ok(hits.every((h) => h.kind === 'document'));
});

test('committees: those whose name has every word typed, in the order the server sent them', () => {
  const committees = committeesOf([{ id: 1, name: 'Board Audit Committee' }, { id: 2, name: 'Risk Committee' }, { id: 3, name: '' }, { id: 'x', name: 'Bad' }, { id: 4, name: 'Information Security & Compliance Steering Committee' }]);
  assert.deepEqual(committees.map((c) => c.id), [1, 2, 4]);
  assert.deepEqual(committeeHits(committees, 'audit').map((h) => h.href), ['/governance/committees/1']);
  assert.deepEqual(committeeHits(committees, 'committee steering').map((h) => h.label), ['Information Security & Compliance Steering Committee']);
  assert.deepEqual(committeeHits(committees, '   '), []);
  assert.deepEqual(committeeHits(committees, 'zzz'), []);
});

test('meetings: found by title, number or committee; the row says which committee and when', () => {
  const committee = { id: 3, name: 'Audit Committee' };
  const rows = [
    { id: 9, meeting_number: '3-004', title: 'Special session: third-party concentration', scheduled_date: '2026-10-12T09:00:00' },
    { id: 10, meeting_number: '3-005', title: '', scheduled_date: '2026-11-20T09:00:00' },
    { id: null, title: 'skipped' },
  ];
  const groups = [{ committee, rows }];
  assert.deepEqual(meetingHits(groups, 'concentration').map((h) => h.href), ['/governance/committees/meetings/9']);
  assert.equal(meetingHits(groups, 'concentration')[0].sub, 'Audit Committee · Meeting 3-004 · 12 Oct 2026');
  assert.deepEqual(meetingHits(groups, '3-005').map((h) => h.label), ['Meeting 3-005'], 'a meeting with no title is named by its number');
  assert.deepEqual(meetingHits(groups, 'audit').map((h) => h.id), ['m9', 'm10'], 'the committee\'s name finds its meetings');
  assert.deepEqual(meetingHits(groups, ''), []);
  assert.deepEqual(meetingHits([], 'x'), []);
});

test('the switchers: the committees, and the meetings of the open committee, with the open one marked', () => {
  const committees = committeesOf([{ id: 1, name: 'Audit' }, { id: 2, name: 'Risk' }]);
  assert.deepEqual(committeeChoices(committees, 2), [{ label: 'Audit', href: '/governance/committees/1', current: false }, { label: 'Risk', href: '/governance/committees/2', current: true }]);
  const choices = meetingChoices([{ id: 9, meeting_number: '1-002', scheduled_date: '2026-10-12T09:00:00' }, { id: 8, title: 'Q3 review' }, { id: null }], 9);
  assert.deepEqual(choices, [
    { label: 'Meeting 1-002 · 12 Oct 2026', href: '/governance/committees/meetings/9', current: true },
    { label: 'Q3 review', href: '/governance/committees/meetings/8', current: false },
  ]);
});

test('recordIdsIn reads the committee or the meeting out of a path, and nothing else', () => {
  assert.deepEqual(recordIdsIn('/governance/committees/3'), { committeeId: 3, meetingId: null });
  assert.deepEqual(recordIdsIn('/governance/committees/meetings/9/'), { committeeId: null, meetingId: 9 });
  assert.deepEqual(recordIdsIn('/governance/committees/actions'), { committeeId: null, meetingId: null });
  assert.deepEqual(recordIdsIn('/governance/committees'), { committeeId: null, meetingId: null });
  assert.deepEqual(recordIdsIn('/governance/committees/3?tab=x'), { committeeId: 3, meetingId: null });
});

// The crumbs share the committee and meeting pages' own queries (same key, same shape: nothing extra is asked). If a page changes either, this fails and the hook must follow.
test('the crumbs read the committee and meeting pages\' own cache entries: the same keys and the same raw answer', () => {
  const dir = 'src/app/(dashboard)/governance/committees';
  const meeting = readFileSync(`${dir}/meetings/[id]/page.tsx`, 'utf8');
  const committee = readFileSync(`${dir}/[id]/page.tsx`, 'utf8');
  assert.match(meeting, /const meetingId = parseInt\(params\.id as string\)/);
  assert.match(meeting, /queryKey: \['meeting', meetingId\],\s*queryFn: async \(\) => \{\s*const res = await committeeApi\.getMeeting\(meetingId\);\s*return res\.data as Meeting;/);
  assert.match(committee, /const committeeId = parseInt\(params\.id as string\)/);
  assert.match(committee, /queryKey: \['committee', committeeId\],\s*queryFn: async \(\) => \{\s*const response = await committeeApi\.getCommittee\(committeeId\);\s*return response\.data as Committee;/);
});
