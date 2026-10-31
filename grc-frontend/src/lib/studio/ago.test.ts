// node --test src/lib/studio/ago.test.ts
// "3 min ago" in the AI Studio (your work, the revisions, who changed what, the sent-to-owner bar): relative for a week, then the platform's date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago } from './text.ts';
import { formatDate } from '../format.ts';

const naive = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19);     // how the server writes a time: UTC, no zone

test('a missing time says nothing', () => {
  assert.equal(ago(null), '');
  assert.equal(ago(undefined), '');
  assert.equal(ago(''), '');
});

test('the first week is relative: just now, minutes, hours, days', () => {
  assert.equal(ago(naive(10_000)), 'just now');
  assert.equal(ago(naive(5 * 60_000)), '5 min ago');
  assert.equal(ago(naive(3 * 3_600_000)), '3 h ago');
  assert.equal(ago(naive(2 * 86_400_000)), '2 d ago');
});

test('older than a week is the platform date ("12 Nov 2026"), not the browser locale\'s (8/2/2026)', () => {
  const old = naive(30 * 86_400_000);
  assert.equal(ago(old), formatDate(old));
  assert.match(ago(old), /^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
});
