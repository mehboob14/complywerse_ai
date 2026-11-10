// node --test "src/lib/statuses/issues.test.ts"
// The words of issues and corrective actions: every word the server writes has a tone and a label (the model's comments and the creators' source strings are the lists), the
// severities are the Incidents register's (one "Critical" pill in both), the colours keep their meaning, and a word nobody registered reads neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statusPill, TONE, type Statuses } from '../status.ts';
import { severity } from './monitoring.ts';
import { actionStatus, actionType, issueCategory, issueSeverity, issueSource, issueState, issueType, lateness } from './issues.ts';

const ALL: Statuses[] = [issueState, issueSeverity, actionStatus, lateness, actionType, issueType, issueCategory, issueSource];
const BACKEND = fileURLToPath(new URL('../../../../backend/grc/', import.meta.url));
const read = (rel: string) => readFileSync(`${BACKEND}${rel}`, 'utf8');
const models = read('models/_12_governance.py');
/** the words in the comment that follows a column (on the same line or the next one) inside one class of the model file */
const listAfter = (cls: string, column: RegExp): string[] => {
  const body = new RegExp(`class ${cls}\\b[\\s\\S]*?(?=\\nclass |$)`).exec(models)![0];
  const m = new RegExp(`${column.source}[^\\n]*\\n?\\s*#\\s*([a-z_, ]+)`).exec(body);
  assert.ok(m, `${cls}: no comment after ${column}`);
  return m![1].split(',').map((s) => s.trim()).filter(Boolean);
};

test('every word has one of the six tones and a readable label', () => {
  for (const registry of ALL) for (const word of registry.words) {
    assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}`);
    assert.ok(/^[A-Z]/.test(registry.label(word)), `${registry.record}.${word}: ${registry.label(word)}`);
  }
});

test('every word the server writes is registered (the model\'s comments are the lists)', () => {
  listAfter('Issue', /severity = Column\(String\(50\)/).forEach((w) => assert.ok(issueSeverity.has(w), `severity ${w}`));
  listAfter('Issue', /issue_type = Column\(String\(40\)/).forEach((w) => assert.ok(issueType.has(w), `type ${w}`));
  listAfter('Issue', /category = Column\(String\(40\)/).forEach((w) => assert.ok(issueCategory.has(w), `category ${w}`));
  listAfter('Issue', /workflow_state = Column\(String\(40\)/).forEach((w) => assert.ok(issueState.has(w), `state ${w}`));
  listAfter('IssueAction', /action_type = Column\(String\(30\)/).forEach((w) => assert.ok(actionType.has(w), `action type ${w}`));
  listAfter('IssueAction', /status = Column\(String\(30\)/).forEach((w) => assert.ok(actionStatus.has(w), `action status ${w}`));
  assert.deepEqual(issueState.words.slice(), ['new', 'triage', 'in_progress', 'resolution', 'closure_review', 'closed', 'cancelled'], 'in the order of the life cycle');
});

test('every place an issue is raised from has a word (the model comment, the auto-create list and what the platform\'s own creators write)', () => {
  listAfter('Issue', /source_type = Column\(String\(40\)/).forEach((w) => assert.ok(issueSource.has(w), `model ${w}`));
  const supported = /SUPPORTED_SOURCES = \{([\s\S]*?)\}/.exec(read('modules/issue_management/routers/auto_create.py'))![1];
  Array.from(supported.matchAll(/"([a-z_]+)"/g)).forEach((m) => assert.ok(issueSource.has(m[1]), `auto-create ${m[1]}`));
  for (const file of ['modules/bcm/routers/_common.py', 'modules/vendor_risk/routers/monitoring.py', 'modules/erm/routers/kris.py',
    'modules/workflow_engine/services/action_handlers.py', 'modules/issue_management/routers/import_export.py', 'modules/issue_management/audit_register/demo.py']) {
    const found = Array.from(read(file).matchAll(/source_type="([a-z_]+)"/g)).map((m) => m[1]);
    found.forEach((w) => assert.ok(issueSource.has(w), `${file}: ${w}`));
  }
  assert.ok(issueSource.has('workflow'), 'the workflow action\'s default source');
});

test('the severities are the Incidents register\'s: one "Critical" pill in both, plus the fifth an issue can carry', () => {
  severity.words.forEach((w) => {
    assert.equal(issueSeverity.tone(w), severity.tone(w), w);
    assert.equal(issueSeverity.label(w), severity.label(w), w);
  });
  assert.deepEqual(issueSeverity.words.slice(), [...severity.words, 'informational']);
});

test('the colours keep their meaning: waiting amber, moving blue, done green, late red; a kind or a place is not coloured', () => {
  assert.deepEqual(['new', 'triage', 'in_progress', 'resolution', 'closure_review', 'closed', 'cancelled'].map((w) => issueState.tone(w)), ['neutral', 'pending', 'progress', 'progress', 'warning', 'success', 'neutral']);
  assert.deepEqual(['planned', 'in_progress', 'blocked', 'completed', 'verified', 'cancelled'].map((w) => actionStatus.tone(w)), ['pending', 'progress', 'warning', 'success', 'success', 'neutral']);
  assert.equal(lateness.tone('overdue'), 'danger');
  for (const kind of [actionType, issueType, issueCategory, issueSource]) for (const w of kind.words) assert.equal(kind.tone(w), 'neutral', `${kind.record}.${w}`);
});

test('the labels say what the person reads, in full', () => {
  assert.equal(issueState.label('closure_review'), 'Closure review');
  assert.equal(issueState.label('in_progress'), 'In progress');
  assert.equal(issueType.label('non_conformance'), 'Non-conformance');
  assert.equal(issueType.label('capa'), 'Corrective action');
  assert.equal(issueSource.label('manual'), 'Raised by hand');
  assert.equal(issueSource.label('bcm_finding'), 'Continuity finding');
  assert.equal(issueSource.label('incident_report'), 'Vendor incident');
  assert.equal(lateness.label('overdue'), 'Overdue');
});

test('an unknown word is neutral with a readable label, and no word is a bare technical key', () => {
  assert.deepEqual(statusPill(issueState, 'under_watch'), { tone: 'neutral', label: 'Under watch' });
  assert.equal(statusPill(actionStatus, undefined).label, '—');
  for (const registry of ALL) for (const word of registry.words) assert.doesNotMatch(registry.label(word), /_|^[a-z]/, `${registry.record}.${word}: ${registry.label(word)}`);
});
