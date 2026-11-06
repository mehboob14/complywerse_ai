import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clampPage, fileKind, fileSizeLabel, rangeLabel, relativeTime, reviewCycleLabel } from './libraryFormat.ts';

const NOW = new Date('2026-10-26T12:00:00Z');

test('how long ago: minutes, hours, days, then the date; the server\'s naive UTC times are read as UTC', () => {
  assert.equal(relativeTime('2026-10-26T11:59:40', NOW), 'just now');
  assert.equal(relativeTime('2026-10-26T12:05:00', NOW), 'just now');          // a clock a little ahead
  assert.equal(relativeTime('2026-10-26T11:15:00', NOW), '45 min ago');
  assert.equal(relativeTime('2026-10-26T09:00:00', NOW), '3 h ago');
  assert.equal(relativeTime('2026-10-24T10:00:00', NOW), '2 d ago');
  assert.equal(relativeTime('2026-10-12T10:00:00', NOW), '12 Oct 2026');
  assert.equal(relativeTime(null, NOW), '');
  assert.equal(relativeTime('not a date', NOW), '');
});

test('the kind of file, and none for a document written on the platform', () => {
  assert.equal(fileKind({ has_file: false }), null);
  assert.equal(fileKind({ has_file: true, file_type: 'pdf' }), 'pdf');
  assert.equal(fileKind({ has_file: true, file_type: '.DOCX' }), 'word');
  assert.equal(fileKind({ has_file: true, file_type: null, file_name: 'Register.xlsx' }), 'excel');
  assert.equal(fileKind({ has_file: true, file_name: 'deck.pptx' }), 'powerpoint');
  assert.equal(fileKind({ has_file: true, file_name: 'notes.md' }), 'text');
  assert.equal(fileKind({ has_file: true, file_name: 'archive.zip' }), 'other');
  assert.equal(fileKind({ has_file: true }), 'other');
  assert.equal(fileKind({}), null);
});

test('sizes and review cycles read as people say them', () => {
  assert.deepEqual([null, 0, 900, 2048, 5 * 1024 * 1024].map(fileSizeLabel), ['—', '0 B', '900 B', '2 KB', '5.0 MB']);
  assert.deepEqual([null, 0, 1, 6, 12, 18, 24, 36].map(reviewCycleLabel),
    ['Not set', 'Not set', 'Every month', 'Every 6 months', 'Every year', 'Every 18 months', 'Every 2 years', 'Every 3 years']);
});

test('a page of a list: its range, and the page to be on after the list shrank', () => {
  assert.equal(rangeLabel(1, 25, 48), '1–25 of 48');
  assert.equal(rangeLabel(2, 25, 48), '26–48 of 48');
  assert.equal(rangeLabel(1, 25, 0), '0');
  assert.equal(clampPage(5, 25, 48), 2);
  assert.equal(clampPage(0, 25, 48), 1);
  assert.equal(clampPage(3, 25, 0), 1);
});
