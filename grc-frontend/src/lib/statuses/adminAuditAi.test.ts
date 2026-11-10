// node --test "src/lib/statuses/adminAuditAi.test.ts"
// The words of the audit log, AI usage / governance and the scheduled jobs: every word has a tone and a readable label, the verbs the audit log really writes are
// registered (read from audit_logger.py), the colours keep their meaning, and a word nobody registered reads neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statusPill, TONE, type Statuses } from '../status.ts';
import { aiCall, auditAction, auditChange, budgetUse, protectionLevel, scheduledJob } from './adminAuditAi.ts';

const ALL: Statuses[] = [auditAction, auditChange, aiCall, budgetUse, protectionLevel, scheduledJob];

test('every word has one of the six tones and a readable label', () => {
  for (const registry of ALL) for (const word of registry.words) {
    assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}`);
    assert.ok(/^[A-Z]/.test(registry.label(word)), `${registry.record}.${word}: ${registry.label(word)}`);
  }
});

test('the verbs the audit log writes for requests are registered, with the failed form of each', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../../backend/grc/audit_logger.py', import.meta.url)), 'utf8');
  for (const verb of ['create', 'update', 'delete', 'read']) {
    assert.match(src, new RegExp(`"${verb}"`), `audit_logger.py writes ${verb}`);
    assert.ok(auditAction.has(verb), verb);
  }
  for (const verb of ['create', 'update', 'delete']) assert.ok(auditAction.has(`${verb}_failed`), `${verb}_failed`);
  assert.equal(auditAction.label('create_failed'), 'Create refused');
});

test('the colours keep their meaning: added is green, changed blue, removed red; a refused request is amber; a viewed row is not coloured', () => {
  assert.deepEqual(['create', 'update', 'delete', 'read', 'update_failed'].map((w) => auditAction.tone(w)), ['success', 'progress', 'danger', 'neutral', 'warning']);
  assert.deepEqual(['created', 'updated', 'deleted'].map((w) => auditChange.tone(w)), ['success', 'progress', 'danger']);
  assert.deepEqual(['succeeded', 'failed', 'blocked'].map((w) => aiCall.tone(w)), ['success', 'danger', 'warning']);
  assert.deepEqual(['ok', 'watch', 'over'].map((w) => budgetUse.tone(w)), ['success', 'warning', 'danger']);
  assert.deepEqual(['on_schedule', 'overdue', 'never', 'failing'].map((w) => scheduledJob.tone(w)), ['success', 'warning', 'neutral', 'danger']);
});

test('the protection levels run from calm to careful: L0 and L1 green, L2 blue, L3 amber, L4 red', () => {
  assert.deepEqual(['L0', 'L1', 'L2', 'L3', 'L4'].map((w) => protectionLevel.tone(w)), ['success', 'success', 'progress', 'warning', 'danger']);
});

test('the call words of both AI ledgers fold into one: success / completed / ok read Succeeded, error / failed read Failed', () => {
  assert.deepEqual(['success', 'completed', 'ok', 'succeeded'].map((w) => aiCall.label(w)), ['Succeeded', 'Succeeded', 'Succeeded', 'Succeeded']);
  assert.deepEqual(['error', 'failed'].map((w) => aiCall.label(w)), ['Failed', 'Failed']);
});

test('a word nobody registered reads neutral with a readable label, and no word is a bare colour', () => {
  assert.deepEqual(statusPill(auditAction, 'sent_for_review'), { tone: 'neutral', label: 'Sent for review' });
  assert.deepEqual(statusPill(aiCall, 'timed_out'), { tone: 'neutral', label: 'Timed out' });
  assert.equal(auditAction.label(null), '—');
});
