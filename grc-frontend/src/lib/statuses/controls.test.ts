// node --test "src/lib/statuses/controls.test.ts"
// The Controls Automation words: every word the pages can show has a tone and a label, the words are the ones the server writes (the backend files are re-read), one word has
// one tone in every registry it appears in, and an unknown word is neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { statusPill, TONE, type Statuses } from '../status.ts';
import {
  CONTROL_REGISTRIES, CONTROL_STATUS_ORDER, applicabilityRequest, auditPeriod, checkResult, collectionHealth, confidenceTone, connection, controlLifecycle,
  controlStatus, designation, evidenceFile, evidenceNeed, mappingVerdict, ownership, stepResult, testResult, testRun, workProgress,
} from './controls.ts';

const BACKEND = new URL('../../../../backend/grc/', import.meta.url);
const read = (rel: string) => {
  const url = new URL(rel, BACKEND);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};
const have = read('modules/automation/router.py') != null;

test('every registry has a tone that exists and a label for every word', () => {
  for (const reg of Object.values(CONTROL_REGISTRIES) as Statuses[]) {
    assert.ok(reg.words.length > 0, `${reg.record} has words`);
    for (const word of reg.words) {
      assert.ok(reg.tone(word) in TONE, `${reg.record}: ${word} has a tone`);
      assert.ok(reg.label(word).length > 1 && reg.label(word) !== '—', `${reg.record}: ${word} has a label`);
    }
  }
});

test('the control status order lists every control status word once', () => {
  assert.deepEqual([...CONTROL_STATUS_ORDER].sort(), [...controlStatus.words].sort());
});

test('the control status words are the ones the server writes (automation/router.py)', { skip: !have }, () => {
  const router = read('modules/automation/router.py') as string;
  for (const word of ['failed', 'collection_failed', 'error', 'running', 'expired', 'passed', 'partial', 'not_run', 'connect_one', 'unbound', 'manual']) {
    assert.ok(controlStatus.has(word), `${word} is registered`);
    assert.ok(router.includes(`"${word}"`), `${word} is a word of automation/router.py`);
  }
});

test('the other words are the ones the server writes', { skip: !have }, () => {
  const router = read('modules/automation/router.py') as string;
  const assurance = read('modules/automation/assurance.py') as string;
  const owner = read('modules/scf/ownership.py') as string;
  const custom = read('modules/scf/custom_controls.py') as string;
  const scf = read('modules/scf/router.py') as string;
  const model = read('models/_56_scf_catalog_models.py') as string;
  for (const word of collectionHealth.words) assert.ok(router.includes(`"${word}"`), `collection state ${word}`);
  for (const word of testRun.words) assert.ok(assurance.includes(`"${word}"`), `test status ${word}`);
  for (const word of ownership.words) assert.ok(owner.includes(`"${word}"`), `ownership ${word}`);
  const lifecycle = /VALID_LIFECYCLE = \{([^}]*)\}/.exec(custom)?.[1] ?? '';
  for (const word of lifecycle.split(',').map((w) => w.trim().replace(/"/g, '')).filter(Boolean)) assert.ok(controlLifecycle.has(word), `lifecycle ${word} is registered`);
  for (const word of ['pending_review', 'approved', 'rejected']) assert.ok(scf.includes(`"${word}"`) && applicabilityRequest.has(word), `applicability ${word}`);
  assert.match(model, /status = Column\(String\(12\), default="open"\)\s+# open \| fieldwork \| closed/);
  assert.deepEqual([...auditPeriod.words], ['open', 'fieldwork', 'closed']);
  for (const word of mappingVerdict.words) assert.ok(model.includes(word), `mapping verdict ${word}`);
  for (const word of ['satisfactory', 'partial', 'deficient', 'not_assessed']) assert.ok(designation.has(word), `designation ${word}`);
});

test('the same word keeps the same tone in every registry it appears in', () => {
  const seen = new Map<string, string>();
  for (const reg of Object.values(CONTROL_REGISTRIES) as Statuses[]) {
    for (const word of reg.words) {
      // the same word is allowed a different tone only when it is a different thing; these pairs are the ones that must agree
      if (!['partial', 'expired', 'stale', 'not_applicable', 'pending_review', 'in_progress', 'approved', 'rejected', 'active', 'failing'].includes(word)) continue;
      const key = `${word}`;
      const tone = reg.tone(word);
      const before = seen.get(key);
      if (before === undefined) seen.set(key, `${tone}:${reg.record}`);
      else if (!before.startsWith(`${tone}:`)) assert.fail(`"${word}" is ${before} and ${tone}:${reg.record}`);
    }
  }
});

test('the tones keep the meaning of the old colours', () => {
  assert.equal(controlStatus.tone('passed'), 'success');
  assert.equal(controlStatus.tone('failed'), 'danger');
  assert.equal(controlStatus.tone('partial'), 'warning');
  // "a connector that cannot authenticate reads Not collected, never Failing"
  assert.notEqual(controlStatus.tone('collection_failed'), 'danger');
  assert.equal(controlStatus.label('collection_failed'), 'Not collected');
  assert.notEqual(controlStatus.tone('expired'), 'danger');
  assert.deepEqual(['effective', 'partially_effective', 'ineffective', 'not_tested'].map((w) => testResult.tone(w)), ['success', 'warning', 'danger', 'neutral']);
  assert.deepEqual(['satisfactory', 'partial', 'deficient', 'not_assessed'].map((w) => designation.tone(w)), ['success', 'warning', 'danger', 'neutral']);
  assert.deepEqual(['satisfied', 'pending_review', 'failing', 'stale', 'missing'].map((w) => evidenceNeed.tone(w)), ['success', 'pending', 'danger', 'warning', 'warning']);
  assert.deepEqual(['approved', 'pending', 'stale', 'rejected'].map((w) => evidenceFile.tone(w)), ['success', 'pending', 'warning', 'danger']);
  assert.deepEqual(['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'].map((w) => workProgress.tone(w)), ['neutral', 'progress', 'pending', 'success', 'neutral']);
  assert.deepEqual(['pass', 'exception', 'not_applicable'].map((w) => stepResult.tone(w)), ['success', 'danger', 'neutral']);
  assert.deepEqual(['pass', 'fail', 'error', 'not_run', 'expired'].map((w) => checkResult.tone(w)), ['success', 'danger', 'pending', 'neutral', 'warning']);
  assert.deepEqual(['healthy', 'stale', 'failing', 'never_run'].map((w) => collectionHealth.tone(w)), ['success', 'warning', 'danger', 'neutral']);
  assert.deepEqual(['ok', 'overdue', 'unowned'].map((w) => ownership.tone(w)), ['success', 'danger', 'warning']);
  assert.deepEqual(['connected', 'not_connected'].map((w) => connection.tone(w)), ['success', 'neutral']);
});

test('a pill always has its word, written the way the page says it', () => {
  assert.deepEqual(statusPill(controlStatus, 'passed'), { tone: 'success', label: 'Passing' });
  assert.deepEqual(statusPill(controlStatus, 'unbound'), { tone: 'neutral', label: 'No check yet' });
  assert.deepEqual(statusPill(testRun, 'completed'), { tone: 'pending', label: 'Awaiting sign-off' });
  assert.deepEqual(statusPill(testRun, 'reviewed'), { tone: 'success', label: 'Signed off' });
  assert.deepEqual(statusPill(designation, 'na'), { tone: 'neutral', label: 'Not applicable' });
  assert.deepEqual(statusPill(testResult, null), { tone: 'neutral', label: '—' });
  assert.deepEqual(statusPill(controlStatus, 'Not Run'), { tone: 'neutral', label: 'Not run' });
});

test('the server\'s "pending" is not a control status of its own; the list reads it as running', () => {
  assert.equal(controlStatus.has('pending'), false);
  assert.deepEqual(statusPill(controlStatus, 'pending'), { tone: 'neutral', label: 'Pending' });
});

test('a word nobody registered is neutral with a readable label, never a guess', () => {
  assert.deepEqual(statusPill(controlStatus, 'in_remediation'), { tone: 'neutral', label: 'In remediation' });
  assert.deepEqual(statusPill(auditPeriod, 'constructor'), { tone: 'neutral', label: 'Constructor' });
  assert.deepEqual(statusPill(ownership, undefined), { tone: 'neutral', label: '—' });
});

test('the mapping confidence bands are 0.85 and 0.6', () => {
  assert.equal(confidenceTone(0.85), 'success');
  assert.equal(confidenceTone(0.99), 'success');
  assert.equal(confidenceTone(0.84), 'warning');
  assert.equal(confidenceTone(0.6), 'warning');
  assert.equal(confidenceTone(0.59), 'danger');
  assert.equal(confidenceTone(0), 'danger');
  assert.equal(confidenceTone(null), 'neutral');
  assert.equal(confidenceTone(Number.NaN), 'neutral');
});
