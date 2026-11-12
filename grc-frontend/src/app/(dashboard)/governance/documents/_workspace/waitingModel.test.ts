// node --test "src/app/(dashboard)/governance/documents/_workspace/waitingModel.test.ts"
// "Waiting for me" is the inbox's own count rule applied to documents: decisions addressed to the person, never acknowledgements or requests they sent, and a source that
// has not answered is said, not counted as nobody.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInbox, type SourceInput } from '../../../../../lib/inbox/buildInbox.ts';
import { waitingCount, waitingForMe, waitingNote } from './waitingModel.ts';

const NOW = new Date('2026-11-06T09:00:00Z');
const ready: SourceInput['state'] = { state: 'ready', at: 1 };
const lifecycle = (items: object[]): SourceInput => ({ id: 'doc.lifecycle', state: ready, raw: { enabled: true, items } });
const row = (id: number, document_id: number, kind: string) => ({ id, document_id, kind, title: `Document ${document_id}`, doc_type: 'policy', version: '1.0', status: 'pending_review' });

test('the documents with a decision addressed to the person: review, approval, a change to revise, a sign-off; not an acknowledgement', () => {
  const inbox = buildInbox([
    lifecycle([row(1, 10, 'review'), row(2, 11, 'acknowledgement'), row(3, 12, 'approval'), row(4, 14, 'changes'), row(5, 10, 'approval')]),
    { id: 'doc.signoff', state: ready, raw: { items: [{ document_id: 13, title: 'Signed off here', doc_type: 'policy', status: 'pending_review' }] } },
  ], NOW);
  const w = waitingForMe(inbox);
  assert.deepEqual(Array.from(w.ids).sort((a, b) => a - b), [10, 12, 13, 14]);
  assert.equal(w.state, 'ready');
});

test('a sign-off the life cycle also asks for is one document; the requests the person sent are not waiting for them', () => {
  const inbox = buildInbox([
    lifecycle([row(1, 10, 'review')]),
    { id: 'doc.signoff', state: ready, raw: { items: [{ document_id: 10, title: 'Same', doc_type: 'policy', status: 'pending_review' }] } },
    { id: 'doc.sent', state: ready, raw: { enabled: true, items: [{ document_id: 99, kind: 'review', title: 'Sent by me', pending: 2, waiting: ['Sara'], status: 'pending_review' }] } },
  ], NOW);
  const w = waitingForMe(inbox);
  assert.deepEqual(Array.from(w.ids), [10]);
});

test('before any source has answered the state is loading and the check draws no number; a source that never answered is said', () => {
  const loading = waitingForMe(buildInbox([{ id: 'doc.lifecycle', state: { state: 'loading' } }, { id: 'doc.signoff', state: { state: 'loading' } }], NOW));
  assert.equal(loading.state, 'loading');
  assert.equal(waitingCount(loading, [{ id: 10 }]), null);
  assert.ok(waitingNote(loading));
  const partial = waitingForMe(buildInbox([lifecycle([row(1, 10, 'review')]), { id: 'doc.signoff', state: { state: 'unavailable', error: 'x' } }], NOW));
  assert.equal(partial.state, 'unavailable');
  assert.deepEqual(Array.from(partial.ids), [10]);                                  // what did load is kept
  assert.ok(waitingNote(partial)?.title.includes('could not'));
  assert.equal(waitingNote(waitingForMe(buildInbox([lifecycle([]), { id: 'doc.signoff', state: ready, raw: { items: [] } }], NOW))), null);
});

test('the count is over the documents the person can see (an id the list does not hold is not counted), and an off life cycle is not a failure', () => {
  const inbox = buildInbox([{ id: 'doc.lifecycle', state: ready, raw: { enabled: false } }, { id: 'doc.signoff', state: ready, raw: { items: [{ document_id: 5, title: 'T', doc_type: 'policy', status: 'pending_review' }, { document_id: 6, title: 'U', doc_type: 'policy', status: 'pending_review' }] } }], NOW);
  const w = waitingForMe(inbox);
  assert.equal(w.state, 'ready');
  assert.equal(waitingCount(w, [{ id: 5 }, { id: 7 }]), 1);
});
