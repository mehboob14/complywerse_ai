// node --test "src/app/(dashboard)/erm/analytics/scenario/scenarioModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appetiteVerdict, formatMoney, frequencyInput, frequencyLabel, frequencyPayload, parseAmount, scenarioActions, stepStates,
} from './scenarioModel.ts';

test('the steps run draft, estimated, reviewed, approved; approved has every step done', () => {
  assert.deepEqual(stepStates('draft'), ['current', 'todo', 'todo', 'todo']);
  assert.deepEqual(stepStates('reviewed'), ['done', 'done', 'current', 'todo']);
  assert.deepEqual(stepStates('approved'), ['done', 'done', 'done', 'done']);
});

test('what the person may do follows the status and the server says who approves', () => {
  assert.deepEqual(scenarioActions({ status: 'draft', can_approve: false }, true), ['edit', 'run', 'addAction']);
  assert.deepEqual(scenarioActions({ status: 'estimated', can_approve: false }, true), ['edit', 'run', 'review', 'sendBack', 'addAction']);
  assert.deepEqual(scenarioActions({ status: 'reviewed', can_approve: false }, true), ['sendBack', 'addAction'], 'the estimator or reviewer');
  assert.deepEqual(scenarioActions({ status: 'reviewed', can_approve: true }, true), ['approve', 'sendBack', 'addAction']);
  assert.deepEqual(scenarioActions({ status: 'approved', can_approve: false }, true), ['reopen'], 'approved is read-only');
  assert.deepEqual(scenarioActions({ status: 'draft', can_approve: true }, false), [], 'a reader');
});

test('a loss is shown in its own currency, whole units, and nothing recorded is a dash', () => {
  assert.equal(formatMoney(1234567.4, 'GBP'), '£1,234,567');
  assert.equal(formatMoney(2500, 'USD'), 'US$2,500');
  assert.equal(formatMoney(null, 'GBP'), '—');
  assert.equal(formatMoney(0, 'EUR'), '€0');
});

test('the frequency reads as the workshop said it, and the form gives the server one of its two fields', () => {
  assert.equal(frequencyLabel(0.2), '1 in 5 years');
  assert.equal(frequencyLabel(0.04), '1 in 25 years');
  assert.equal(frequencyLabel(3), '3 a year');
  assert.equal(frequencyLabel(null), '—');
  assert.deepEqual(frequencyInput(0.2), { mode: 'one_in', value: '5' });
  assert.deepEqual(frequencyInput(2), { mode: 'per_year', value: '2' });
  assert.deepEqual(frequencyPayload('one_in', '5'), { one_in_years: 5 });
  assert.deepEqual(frequencyPayload('per_year', '0.5'), { frequency_per_year: 0.5 });
  assert.deepEqual(frequencyPayload('one_in', ''), {});
});

test('amounts accept thousands separators; blank or negative is nothing', () => {
  assert.equal(parseAmount('4,000,000'), 4_000_000);
  assert.equal(parseAmount('250 000'), 250_000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('abc'), null);
});

test('the appetite line says within, above, or why there is no comparison', () => {
  assert.deepEqual(appetiteVerdict({ category: 'operational', tolerance: null, reason: 'No loss tolerance set' }),
    { text: 'No loss tolerance set', tone: 'neutral' });
  assert.equal(appetiteVerdict({ category: 'operational', tolerance: 5e5, within: false }).text, 'Above tolerance');
  assert.equal(appetiteVerdict({ category: 'operational', tolerance: 5e5, within: true }).tone, 'success');
});
