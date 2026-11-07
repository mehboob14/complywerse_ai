// node --test "src/lib/statuses/monitoring.test.ts"
// The words of the Risk Management monitoring pages: every word the server writes has a tone and a label (the server's lists are read from the model's comments), nothing
// else is registered by accident, the colours keep their meaning, and a word nobody registered reads neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statusPill, TONE, type Statuses } from '../status.ts';
import { appetiteLevel, dependencyType, incidentStatus, kriStatus, mitigationStatus, optionsOf, severity, treatmentType } from './monitoring.ts';
import { INCIDENT_STATUSES } from '../erm/incident.ts';
import { ACTION_STATUSES } from '../erm/mitigation.ts';

const ALL: Statuses[] = [kriStatus, incidentStatus, mitigationStatus, treatmentType, severity, appetiteLevel, dependencyType];
const model = readFileSync(fileURLToPath(new URL('../../../../backend/grc/models/_11_enterprise_risk_management.py', import.meta.url)), 'utf8');
const commentOf = (re: RegExp): string[] => re.exec(model)![1].split(',').map((s) => s.trim());

test('every word has one of the six tones and a readable label', () => {
  for (const registry of ALL) for (const word of registry.words) {
    assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}`);
    assert.ok(/^[A-Z]/.test(registry.label(word)), `${registry.record}.${word}: ${registry.label(word)}`);
  }
});

test('every word the server writes is registered (the model\'s comments are the lists)', () => {
  const incident = commentOf(/class RiskIncident[\s\S]*?status = Column\(String\(50\), default="open"\)\s+# ([^\n]+)/);
  incident.forEach((w) => assert.ok(incidentStatus.has(w), `incident ${w}`));
  commentOf(/class RiskIncident[\s\S]*?severity = Column\(String\(50\), default="medium"\)\s+# ([^\n]+)/).forEach((w) => assert.ok(severity.has(w), `severity ${w}`));
  commentOf(/class RiskMitigationAction[\s\S]*?status = Column\(String\(50\), default="open"\)\s+# ([^\n]+)/).forEach((w) => assert.ok(mitigationStatus.has(w), `action ${w}`));
  commentOf(/class RiskMitigationAction[\s\S]*?action_type = Column\(String\(50\), default="mitigate"\)\s+# ([^\n]+)/).forEach((w) => assert.ok(treatmentType.has(w), `treatment ${w}`));
  commentOf(/class RiskMitigationAction[\s\S]*?priority = Column\(String\(20\), default="medium"\)\s+# ([^\n]+)/).forEach((w) => assert.ok(severity.has(w), `priority ${w}`));
  commentOf(/appetite_level = Column\(String\(50\), default="moderate"\)\s+# ([^\n]+)/).forEach((w) => assert.ok(appetiteLevel.has(w), `appetite ${w}`));
  commentOf(/class RiskDependency[\s\S]*?dependency_type = Column\(String\(50\), default="causes"\)\s+# ([^\n]+)/).forEach((w) => assert.ok(dependencyType.has(w), `dependency ${w}`));
  Array.from(INCIDENT_STATUSES).forEach((w) => assert.ok(incidentStatus.has(w), w));
  Array.from(ACTION_STATUSES).forEach((w) => assert.ok(mitigationStatus.has(w), w));
});

test('the colours keep their meaning: open is red, being looked at amber, moving blue, done green; late is red; a kind is not coloured', () => {
  assert.deepEqual(['open', 'investigating', 'mitigating', 'resolved', 'closed'].map((w) => incidentStatus.tone(w)), ['danger', 'warning', 'progress', 'success', 'neutral']);
  assert.deepEqual(ACTION_STATUSES.map((w) => mitigationStatus.tone(w)), ['pending', 'progress', 'success', 'danger', 'neutral']);
  assert.deepEqual(['red', 'amber', 'green', 'unrated', 'no_value'].map((w) => kriStatus.tone(w)), ['danger', 'warning', 'success', 'neutral', 'neutral']);
  assert.deepEqual(['red', 'amber', 'green'].map((w) => kriStatus.label(w)), ['Off target', 'Watch', 'On track'], 'the rag words of the KRI report, unchanged');
  for (const kind of [treatmentType, dependencyType]) for (const w of kind.words) assert.equal(kind.tone(w), 'neutral', `${kind.record}.${w}`);
  assert.deepEqual(severity.words.map((w) => severity.tone(w)), ['danger', 'warning', 'progress', 'neutral']);
});

test('an unknown word is neutral with a readable label, and the labels say what the code writes', () => {
  assert.deepEqual(statusPill(incidentStatus, 'under_watch'), { tone: 'neutral', label: 'Under watch' });
  assert.equal(statusPill(mitigationStatus, undefined).label, '—');
  assert.equal(mitigationStatus.label('in_progress'), 'In progress');
  assert.equal(dependencyType.label('caused_by'), 'Is caused by');
  assert.deepEqual(optionsOf(mitigationStatus, ['open', 'in_progress', 'cancelled']), [{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'cancelled', label: 'Cancelled' }]);
});
