import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PatchQueue, queueFor } from './setupPatch.ts';

test('a note typed before a choice is saved with it, one save at a time', () => {
  const q = new PatchQueue();
  q.add({ regulatory_notes: 'Licence condition 4' });             // typed: waiting for the pause
  q.add({ country: 'Pakistan' });                                  // a choice right after: sent at once, with the note
  assert.deepEqual(q.take(), { regulatory_notes: 'Licence condition 4', country: 'Pakistan' });
  q.add({ regulators: ['SBP'] });
  assert.equal(q.take(), null);                                    // one save on its way: the next waits
  assert.deepEqual(q.view({ country: '', tone: 'Plain English' }),
    { country: 'Pakistan', tone: 'Plain English', regulatory_notes: 'Licence condition 4', regulators: ['SBP'] });   // a reload keeps both
  q.done();
  assert.deepEqual(q.take(), { regulators: ['SBP'] });
});

test('a failed save waits again under newer changes', () => {
  const q = new PatchQueue();
  q.add({ tone: 'Concise', audience: 'All staff' });
  q.take();
  q.add({ tone: 'Formal and precise' });
  q.failed();
  assert.deepEqual(q.take(), { tone: 'Formal and precise', audience: 'All staff' });
  q.done();
  q.settled();
  assert.equal(q.take(), null);
  assert.deepEqual(q.view({ tone: 'Formal and precise', audience: 'All staff' }), { tone: 'Formal and precise', audience: 'All staff' });
});

test('an answer fetched before a save cannot undo it; one fetched after it can', () => {
  const q = new PatchQueue();
  q.add({ classification: 'Confidential' });
  q.take();
  q.done();
  assert.equal(q.view({ classification: 'Internal' }).classification, 'Confidential');   // an older copy arrives late
  q.settled();
  assert.equal(q.view({ classification: 'Restricted' }).classification, 'Restricted');   // changed elsewhere since: taken
});

test('text the server only trimmed is kept as typed', () => {
  const q = new PatchQueue();
  q.add({ focus_areas: 'Remote working ' });
  q.take();
  q.done();
  q.settled();
  assert.equal(q.view({ focus_areas: 'Remote working' }).focus_areas, 'Remote working ');
  assert.equal(q.view({ focus_areas: 'Something else' }).focus_areas, 'Something else');
});

test('the two editors of one session share one queue', () => {
  assert.equal(queueFor(7), queueFor(7));
  assert.notEqual(queueFor(7), queueFor(8));
});
