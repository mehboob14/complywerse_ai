// node --test src/lib/statuses/statutory.test.ts   (or the whole suite: npm test)
// Every word Statutory Audit can show has a tone and a readable label; the words are the ones the server writes (the backend's lists are re-read here, so a word the
// server starts writing fails until it is registered); the organisation's own status levels win over the platform's words; an unknown word is neutral and readable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TONE } from '../status.ts';
import { activityKind, levelPill, levelTone, observationPriority, observationStatus, observationType, slaState } from './statutory.ts';

const BACKEND = fileURLToPath(new URL('../../../../backend/grc/', import.meta.url));
const read = (rel: string) => readFileSync(`${BACKEND}${rel}`, 'utf8');
const set = (src: string, name: string): string[] => {
  const m = new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`).exec(src);
  assert.ok(m, `${name} not found`);
  return Array.from(m[1].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]);
};

test('every registered word has a tone that exists and a label that reads as words', () => {
  for (const reg of [observationStatus, observationPriority, observationType, slaState, activityKind]) {
    assert.ok(reg.words.length > 0, reg.record);
    reg.words.forEach((w) => {
      assert.ok(reg.tone(w) in TONE, `${reg.record}: ${w}`);
      assert.match(reg.label(w), /^[A-Z][a-z]/, `${reg.record}: ${w} -> ${reg.label(w)}`);
      assert.doesNotMatch(reg.label(w), /_/, `${reg.record}: ${w}`);
    });
  }
});

test('the words are the ones the server writes', () => {
  const server = read('modules/auditor_portal/routers/statutory_audit.py');
  assert.deepEqual(set(server, 'STATUSES').sort(), [...observationStatus.words].sort());
  assert.deepEqual(set(server, 'PRIORITIES').sort(), [...observationPriority.words].sort());
  assert.deepEqual(set(server, 'OBS_TYPES').sort(), [...observationType.words].sort());
  const settings = read('services/module_settings.py');
  const block = /"statutory_audit": \{[\s\S]*?"sla": _audit_sla/.exec(settings)?.[0] ?? '';
  const shipped = Array.from(block.matchAll(/_status\("([a-z_]+)", "([^"]+)"/g)).map((m) => [m[1], m[2]]);
  assert.equal(shipped.length, 5, 'the five shipped levels');
  shipped.forEach(([key, label]) => {
    assert.ok(observationStatus.has(key), key);
    assert.equal(observationStatus.label(key).toLowerCase(), label.toLowerCase(), `${key}: the platform says what the Settings page says`);
  });
  const states = Array.from(settings.matchAll(/"state": "([a-z_]+)"/g)).map((m) => m[1]);
  const written = Array.from(settings.matchAll(/state\.update\(state="([a-z_]+)"/g)).map((m) => m[1]).concat(states, ['closed', 'paused']);
  new Set(written).forEach((w) => assert.ok(slaState.has(w), `an SLA state the server writes: ${w}`));
  const kinds = Array.from(server.matchAll(/_log_activity\([^"]*?"([a-z_]+)"/g)).map((m) => m[1]);
  new Set(kinds).forEach((k) => assert.ok(activityKind.has(k), `an activity the server writes: ${k}`));
});

test('the tones of Settings are the platform tones, an unknown tone is neutral', () => {
  assert.equal(levelTone('amber'), 'warning');
  assert.equal(levelTone('blue'), 'progress');
  assert.equal(levelTone('emerald'), 'success');
  assert.equal(levelTone('rose'), 'danger');
  assert.equal(levelTone('violet'), 'pending');
  assert.equal(levelTone('slate'), 'neutral');
  assert.equal(levelTone('chartreuse'), 'neutral');
  assert.equal(levelTone('constructor'), 'neutral', 'an inherited property is not a tone');
  assert.equal(levelTone(undefined), 'neutral');
});

test('the organisation\'s own level wins: its label and tone; a word it never listed falls back to the platform\'s', () => {
  const levels = [{ key: 'open', label: 'Raised', tone: 'blue' }, { key: 'in_remediation', label: 'Being fixed', tone: 'amber' }, { key: 'plain', label: '  ' }];
  assert.deepEqual(levelPill(levels, 'open'), { tone: 'progress', label: 'Raised' });
  assert.deepEqual(levelPill(levels, 'in_remediation'), { tone: 'warning', label: 'Being fixed' });
  assert.deepEqual(levelPill(levels, 'plain'), { tone: 'neutral', label: 'Plain' }, 'a blank label reads as the word, never as nothing');
  assert.deepEqual(levelPill(levels, 'complied'), { tone: 'success', label: 'Complied' });
  assert.deepEqual(levelPill(undefined, 'closed'), { tone: 'neutral', label: 'Closed' });
});

test('an unknown word is neutral with a readable label, and no word at all is a dash', () => {
  assert.deepEqual(levelPill([], 'awaiting_regulator'), { tone: 'neutral', label: 'Awaiting regulator' });
  assert.equal(observationPriority.tone('urgent'), 'neutral');
  assert.equal(observationStatus.label(null), '—');
  assert.equal(observationPriority.tone('constructor'), 'neutral');
});
