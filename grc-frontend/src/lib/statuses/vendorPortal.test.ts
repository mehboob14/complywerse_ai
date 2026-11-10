// node --test "src/lib/statuses/vendorPortal.test.ts"
// The supplier portal's words: every word the server writes has a tone and a label, they are said in full, and a word nobody registered reads neutral.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statusPill, TONE, type Statuses } from '../status.ts';
import { portalKind, portalLateness, portalQuestionnaire, portalRequest } from './vendorPortal.ts';

const ALL: Statuses[] = [portalQuestionnaire, portalRequest, portalKind, portalLateness];
const BACKEND = fileURLToPath(new URL('../../../../backend/grc/', import.meta.url));
const read = (rel: string) => readFileSync(`${BACKEND}${rel}`, 'utf8');

test('every word has one of the six tones and a readable label', () => {
  for (const registry of ALL) for (const word of registry.words) {
    assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}`);
    assert.match(registry.label(word), /^[A-Z]/, `${registry.record}.${word}: ${registry.label(word)}`);
  }
});

test('every questionnaire status the portal can show is registered (the server\'s own lists)', () => {
  const portal = read('modules/vendor_risk/tpra/portal.py');
  const waiting = /WAITING_ON_VENDOR\s*=\s*\(([^)]*)\)/.exec(portal)![1].match(/"(\w+)"/g)!.map((w) => w.replace(/"/g, ''));
  assert.deepEqual(waiting, ['pending', 'in_progress', 'returned']);
  for (const word of waiting) assert.ok(portalQuestionnaire.has(word), word);
  const home = read('modules/vendor_risk/tpra/supplier_portal.py');
  const sent = /Q\.status\.in_\(\(([^)]*)\)\)/.exec(home)![1].match(/"(\w+)"/g)!.map((w) => w.replace(/"/g, ''));
  assert.deepEqual(sent, ['submitted', 'under_review', 'accepted']);
  for (const word of sent) assert.ok(portalQuestionnaire.has(word), word);
  assert.ok(portalQuestionnaire.has('closed'), 'a waiting questionnaire whose link has run out');
});

test('every request status the server writes is registered', () => {
  const model = read('models/_87_tpra_supplier_requests.py');
  const comment = /#\s*(open[^\n]*cancelled[^\n]*)/.exec(model);
  assert.ok(comment, "the model's comment lists the request's states");
  for (const word of ['open', 'submitted', 'accepted', 'returned', 'cancelled']) {
    assert.match(comment![1], new RegExp(word), `the model's comment names ${word}`);
    assert.ok(portalRequest.has(word), word);
  }
});

test('the words say what the supplier does next, and the old ones keep their labels', () => {
  assert.equal(portalQuestionnaire.label('pending'), 'Not started');
  assert.equal(portalQuestionnaire.label('in_progress'), 'In progress');
  assert.equal(portalQuestionnaire.label('returned'), 'Questions for you');
  assert.equal(portalQuestionnaire.label('under_review'), 'In review');
  assert.equal(portalRequest.label('open'), 'To do');
  assert.equal(portalRequest.label('returned'), 'Returned to you');
  assert.equal(portalRequest.label('cancelled'), 'Withdrawn');
  assert.equal(portalKind.label('finding'), 'Finding to fix');
});

test('waiting is amber or grey-blue, done is green, late is red; colour is never the only signal', () => {
  assert.equal(portalQuestionnaire.tone('returned'), 'warning');
  assert.equal(portalQuestionnaire.tone('accepted'), 'success');
  assert.equal(portalRequest.tone('submitted'), 'success');
  assert.equal(portalLateness.tone('late'), 'danger');
  assert.equal(statusPill(portalLateness, 'late').label, 'Late');
});

test('a word nobody registered reads neutral with a readable label', () => {
  assert.deepEqual(statusPill(portalRequest, 'on_hold'), { tone: 'neutral', label: 'On hold' });
  assert.deepEqual(statusPill(portalQuestionnaire, null), statusPill(portalQuestionnaire, undefined));
});
