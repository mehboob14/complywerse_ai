// node --test "src/app/(dashboard)/vendor-risk/_ui/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TONE, tones, type Tone } from './tones.ts';
import { NOT_TIERED, SOFT, contrast, onColor, tierColor, tierKey, tierLabel } from './tiers.ts';
import { SEV_HEX } from '../_lib/tprmShared.ts';

const check = (fn: (s: string) => Tone, rows: Array<[string, Tone]>) => rows.forEach(([word, tone]) => assert.equal(fn(word), tone, word));

test('a vendor status word lands in Verity\'s family, whatever its spelling', () => {
  check(tones.lifecycle, [
    ['requested', 'pending'], ['under_review', 'progress'], ['onboarding', 'progress'], ['approved', 'success'], ['active', 'success'],
    ['flagged', 'danger'], ['on_hold', 'warning'], ['suspended', 'warning'], ['offboarding', 'warning'],
    ['offboarded', 'neutral'], ['terminated', 'neutral'], ['archived', 'neutral'],
    ['Under review', 'progress'], ['under-review', 'progress'], ['  UNDER_REVIEW ', 'progress'],
    ['not_started', 'pending'], ['in_progress', 'progress'], ['complete', 'success'], ['skipped', 'neutral'],      // a stage's words too
  ]);
});

test('a word nobody mapped, or none at all, is neutral: never a guess', () => {
  for (const fn of Object.values(tones)) {
    assert.equal(fn('whatever'), 'neutral');
    assert.equal(fn(''), 'neutral');
    assert.equal(fn(null), 'neutral');
    assert.equal(fn(undefined), 'neutral');
  }
});

test('findings, conditions, decisions, assessments', () => {
  check(tones.finding, [['open', 'danger'], ['in_remediation', 'progress'], ['accepted', 'pending'], ['closed', 'success']]);
  // "open" is the alarm on a finding and only a warning on a condition
  check(tones.condition, [['open', 'warning'], ['met', 'success'], ['overdue', 'danger'], ['waived', 'neutral']]);
  check(tones.decision, [
    ['approve', 'success'], ['approved', 'success'], ['approve_with_conditions', 'warning'], ['defer', 'pending'], ['reject', 'danger'],
    ['pending', 'pending'], ['auto_approved', 'success'], ['declined', 'danger'],                                  // how an intake request ends
  ]);
  check(tones.assessment, [
    ['pending', 'pending'], ['in_progress', 'progress'], ['submitted', 'progress'], ['expired', 'danger'], ['scored', 'success'],
  ]);
});

test('paperwork, contracts, urgency, screening', () => {
  check(tones.document, [['requested', 'pending'], ['received', 'progress'], ['reviewed', 'success'], ['expired', 'danger'], ['expiring', 'warning']]);
  check(tones.contract, [['draft', 'neutral'], ['active', 'success'], ['expired', 'danger'], ['terminated', 'neutral']]);
  check(tones.urgency, [['low', 'neutral'], ['normal', 'progress'], ['high', 'warning']]);
  check(tones.screening, [['pending', 'pending'], ['passed', 'success'], ['flagged', 'warning']]);
});

test('grades: A and B green, C blue, D amber, E and F red; case does not matter', () => {
  check(tones.grade, [['A', 'success'], ['B', 'success'], ['C', 'progress'], ['D', 'warning'], ['E', 'danger'], ['F', 'danger'], ['b', 'success']]);
});

test('every tone has four #rrggbb colours, and its words read on its tint (4.5:1)', () => {
  const names: Tone[] = ['success', 'danger', 'warning', 'progress', 'pending', 'neutral'];
  assert.deepEqual(Object.keys(TONE).sort(), [...names].sort());
  for (const name of names) {
    const c = TONE[name];
    for (const hex of [c.dot, c.text, c.tint, c.border]) assert.match(hex, /^#[0-9A-F]{6}$/i, `${name} ${hex}`);
    assert.ok(contrast(c.text, c.tint) >= 4.5, `${name} words on tint: ${contrast(c.text, c.tint).toFixed(2)}`);
  }
});

test('tier words: four tiers, everything else is "Not tiered"', () => {
  assert.equal(tierKey('Critical'), 'critical');
  assert.equal(tierKey(' high '), 'high');
  for (const none of [null, undefined, '', 'untiered', 'not_tiered', 'tier 1']) {
    assert.equal(tierKey(none), null, String(none));
    assert.equal(tierLabel(none), 'Not tiered');
    assert.equal(tierColor(none), NOT_TIERED.dot);
  }
  assert.equal(tierLabel('low'), 'Low');
  assert.equal(tierColor('critical'), SEV_HEX.critical);              // the ramp is Compliverse's own
  assert.equal(tierColor('medium'), SEV_HEX.medium);
});

test('a tier chip is readable: white ink only where white reads (the red), dark ink on the bright fills', () => {
  assert.equal(onColor(SEV_HEX.critical), '#FFFFFF');
  for (const tier of ['high', 'medium', 'low']) assert.equal(onColor(SEV_HEX[tier]), '#1F2933', tier);
  assert.equal(onColor(NOT_TIERED.fill), '#1F2933');
  for (const tier of ['critical', 'high', 'medium', 'low']) {
    const fill = SEV_HEX[tier];
    assert.ok(contrast(fill, onColor(fill)) >= 4.5, `${tier}: ${contrast(fill, onColor(fill)).toFixed(2)}`);
  }
  assert.ok(contrast('#000000', '#FFFFFF') > 20.9);                  // the scale itself: 21:1
  assert.ok(Math.abs(contrast('#FFFFFF', '#FFFFFF') - 1) < 1e-9);
});

test('the soft severity chip reads on its tint too', () => {
  for (const [name, soft] of Object.entries(SOFT)) assert.ok(contrast(soft.text, soft.tint) >= 4.5, `${name}: ${contrast(soft.text, soft.tint).toFixed(2)}`);
});
