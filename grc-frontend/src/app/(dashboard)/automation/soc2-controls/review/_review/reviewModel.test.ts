// node --test "src/app/(dashboard)/automation/soc2-controls/review/_review/reviewModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canRetarget, identity, matchWords, nextKey, openKey, questionFor, queueWords, type QueueItem } from './reviewModel.ts';
import { confidenceTone, mappingVerdict } from '../../../../../../lib/statuses/controls.ts';

const item = (code: string, scf = 'IAC-06', slug = 'iso'): QueueItem => ({
  source_slug: slug, framework: 'ISO', requirement_code: code, reference: code, requirement_title: null, scf_id: scf, confidence: 0.4, match_mode: 'exact', provenance: 'resolver', fan_out: 3, is_material: false,
});
const a = item('A'); const b = item('B'); const c = item('C'); const d = item('D');

test('the identity of a decision is the mapping, never a row number', () => {
  assert.equal(identity(a), 'iso|A|IAC-06');
  assert.notEqual(identity(item('A', 'IAC-07')), identity(a));
  assert.notEqual(identity(item('A', 'IAC-06', 'nist')), identity(a));
});

test('once an item is decided the person lands on the one that took its place, else the one before, else the first', () => {
  assert.equal(nextKey([a, b, c], [a, c, d], identity(b)), identity(c), 'the next one in the list');
  assert.equal(nextKey([a, b, c], [a, b, d], identity(c)), identity(d), 'a new one filled the end of the queue');
  assert.equal(nextKey([a, b, c], [a, b], identity(c)), identity(b), 'it was the last one: the one before it');
  assert.equal(nextKey([a], [], identity(a)), null, 'nothing left');
  assert.equal(nextKey([a, b], [c, d], identity(a)), identity(c), 'the whole queue was replaced');
});

test('the open item is the chosen one while it is still in the queue, else the first', () => {
  assert.equal(openKey([a, b], identity(b)), identity(b));
  assert.equal(openKey([a, b], identity(c)), identity(a));
  assert.equal(openKey([a, b], null), identity(a));
  assert.equal(openKey([], identity(a)), null);
});

test('suppressing and moving ask first, and say what is kept; confirming asks nothing', () => {
  assert.equal(questionFor('confirmed', a), null);
  assert.match(questionFor('suppressed', a)!.title, /Suppress A → IAC-06\?/);
  assert.match(questionFor('suppressed', a)!.message, /across SCF releases/);
  assert.match(questionFor('retargeted', a, 'IAC-17')!.title, /Move A from IAC-06 to IAC-17\?/);
  assert.equal(questionFor('retargeted', a)!.confirmLabel, 'Move mapping');
});

test('a move needs a control that is not the one it already has', () => {
  assert.equal(canRetarget('IAC-17', a), true);
  assert.equal(canRetarget(' iac-06 ', a), false);
  assert.equal(canRetarget('', a), false);
  assert.equal(canRetarget(null, a), false);
});

test('the words of a match and of the queue', () => {
  assert.equal(matchWords('exact'), 'Exact match');
  assert.equal(matchWords('child'), 'Matched by a child code');
  assert.equal(matchWords('some_new'), 'Some new');
  const fmt = (n: number) => n.toLocaleString('en-US');
  assert.equal(queueWords(50, 1204, fmt), '50 of 1,204 waiting');
  assert.equal(queueWords(12, 12, fmt), '12 waiting');
  assert.equal(queueWords(0, 0, fmt), 'Nothing is waiting');
});

test('confidence reads as the bands the page has always used, and every verdict has a word', () => {
  assert.equal(confidenceTone(a.confidence), 'danger');
  assert.equal(confidenceTone(0.7), 'warning');
  assert.equal(confidenceTone(0.9), 'success');
  for (const v of ['confirmed', 'suppressed', 'retargeted']) assert.ok(mappingVerdict.has(v));
});
