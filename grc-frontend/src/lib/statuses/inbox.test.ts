// node --test "src/lib/statuses/inbox.test.ts"
// The words Needs my action adds to a request: every word the rows can carry (lib/inbox/inboxView.ts chipsOf) has a tone and a label, nothing else is registered, and a word nobody registered reads
// neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statusPill } from '../status.ts';
import { inboxChip } from './inbox.ts';
import { chipsOf, type ChipWord } from '../inbox/inboxView.ts';

const WORDS: ChipWord[] = ['escalated', 'asked_again', 'archived', 'can_decide'];

test('every word a row can carry is registered with a tone and a readable label, and nothing else is', () => {
  const reachable = new Set<string>(chipsOf({ escalation: 2, docStatus: 'archived', again: {} as never, counted: false, section: 'decision' }));
  assert.deepEqual(Array.from(reachable).sort(), [...WORDS].sort());
  assert.deepEqual([...inboxChip.words].sort(), ['archived', 'asked_again', 'can_decide', 'escalated']);
  for (const word of WORDS) {
    assert.ok(inboxChip.has(word), word);
    assert.ok(inboxChip.label(word).length > 3, word);
  }
});

test('the labels are the words people read, the tones keep their meaning: late is red, asked again is purple, the rest at rest', () => {
  assert.deepEqual(WORDS.map((w) => inboxChip.label(w)), ['Escalated', 'Asked again', 'Archived', 'You can decide']);
  assert.deepEqual(WORDS.map((w) => inboxChip.tone(w)), ['danger', 'pending', 'neutral', 'neutral']);
});

test('a word nobody registered is neutral with its own readable label, never a guess', () => {
  assert.deepEqual(statusPill(inboxChip, 'on_hold'), { tone: 'neutral', label: 'On hold' });
  assert.deepEqual(statusPill(inboxChip, undefined), { tone: 'neutral', label: '—' });
});
