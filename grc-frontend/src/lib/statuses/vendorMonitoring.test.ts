// node --test "src/lib/statuses/vendorMonitoring.test.ts"
// The words of Monitoring: every word a page can show has a tone of the platform's families and a readable label; the stages are the server's (read from tpra/alerts.py); a word nobody registered reads
// neutral with a readable label; the outside-in grade names its scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { TONE, statusPill } from '../status.ts';
import { ALERT_KINDS, KIND_ORDER, SEVERITY_ORDER, STAGE_ORDER, alertStage, outsideInGrade, signalKind, signalSeverity } from './vendorMonitoring.ts';

const ALL = [alertStage, signalKind, signalSeverity, outsideInGrade];

test('every word has a tone of the platform\'s families and a readable label', () => {
  for (const reg of ALL) for (const w of reg.words) {
    assert.ok(Object.keys(TONE).includes(reg.tone(w)), `${reg.record}.${w}`);
    assert.ok(reg.label(w).length > 1 && reg.label(w) !== '—', `${reg.record}.${w}`);
  }
  STAGE_ORDER.forEach((w) => assert.ok(alertStage.words.includes(w), `stage ${w}`));
  KIND_ORDER.forEach((w) => assert.ok(signalKind.words.includes(w), `kind ${w}`));
  SEVERITY_ORDER.forEach((w) => assert.ok(signalSeverity.words.includes(w), `severity ${w}`));
});

test('the stages are the ones the server writes, in the order a signal moves through them', () => {
  assert.deepEqual(STAGE_ORDER, ['new', 'acknowledged', 'investigating', 'confirmed', 'not_relevant', 'closed']);
  const src = new URL('../../../../backend/grc/modules/vendor_risk/tpra/alerts.py', import.meta.url);
  if (!existsSync(src)) return;
  const code = readFileSync(src, 'utf8');
  const stages = /STAGES = \(([^)]+)\)/.exec(code)?.[1].match(/"([a-z_]+)"/g)?.map((w) => w.replace(/"/g, ''));
  assert.deepEqual(stages, Array.from(STAGE_ORDER), 'alerts.py STAGES and lib/statuses/vendorMonitoring.ts say the same words');
  const kinds = /ALERT_TYPES = \(([^)]+)\)/.exec(code)?.[1].match(/"([a-z_]+)"/g)?.map((w) => w.replace(/"/g, ''));
  assert.deepEqual(kinds, Array.from(ALERT_KINDS));
});

test('acknowledged is not closed: two words, two tones, said in words', () => {
  assert.notEqual(alertStage.label('acknowledged'), alertStage.label('closed'));
  assert.equal(alertStage.tone('acknowledged'), 'pending');
  assert.equal(alertStage.tone('confirmed'), 'danger');
  assert.equal(alertStage.tone('new'), 'warning');
  assert.equal(statusPill(alertStage, 'not_relevant').label, 'Not relevant');
});

test('the outside-in grade names its scale, and a word nobody registered reads neutral with a readable label', () => {
  assert.equal(outsideInGrade.label('B'), 'Outside-in B');
  assert.equal(outsideInGrade.tone('A'), 'success');
  assert.equal(outsideInGrade.tone('F'), 'danger');
  assert.equal(outsideInGrade.label('none'), 'Not rated');
  assert.equal(signalKind.tone('something_new'), 'neutral');
  assert.equal(signalKind.label('something_new'), 'Something new');
  assert.equal(signalSeverity.label('INFO'), 'Info');
});
