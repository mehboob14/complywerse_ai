// node --test "src/components/issue-management/embedWords.test.ts"
// The words of an issue on a record's page: every word the server writes has a tone and a label (the lists are read from the model's comments), kinds are not coloured, and an unknown
// word reads neutral with a readable label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { statusPill, TONE } from '../../lib/status.ts';
import { optionsOf, severity } from '../../lib/statuses/monitoring.ts';
import { LEVELS, SEVERITY_WORDS, issueCategory, issueState, issueType } from './embedWords.ts';

const model = readFileSync(fileURLToPath(new URL('../../../../backend/grc/models/_12_governance.py', import.meta.url)), 'utf8');
const commentOf = (re: RegExp): string[] => re.exec(model)![1].split(',').map((s) => s.trim());
const ISSUE = /class Issue\(Base\)[\s\S]*?/;

test('every word the server writes is registered (the model\'s comments are the lists)', () => {
  commentOf(new RegExp(`${ISSUE.source}workflow_state = Column\\(String\\(40\\), nullable=True, default="new", index=True\\)\\s+# ([^\\n]+)`)).forEach((w) => assert.ok(issueState.has(w), `state ${w}`));
  commentOf(new RegExp(`${ISSUE.source}issue_type = Column\\(String\\(40\\), nullable=True\\)\\s+# ([^\\n]+)`)).forEach((w) => assert.ok(issueType.has(w), `type ${w}`));
  commentOf(new RegExp(`${ISSUE.source}category = Column\\(String\\(40\\), nullable=True\\)\\s+# ([^\\n]+)`)).forEach((w) => assert.ok(issueCategory.has(w), `category ${w}`));
  commentOf(new RegExp(`${ISSUE.source}severity = Column\\(String\\(50\\), default="medium"\\)\\s+# ([^\\n]+)`)).forEach((w) => assert.ok(SEVERITY_WORDS.includes(w as never), `severity ${w}`));
});

test('every word has one of the six tones and a readable label', () => {
  for (const registry of [issueState, issueType, issueCategory]) for (const word of registry.words) {
    assert.ok(Object.keys(TONE).includes(registry.tone(word)), `${registry.record}.${word}`);
    assert.ok(/^[A-Z]/.test(registry.label(word)), `${registry.record}.${word}: ${registry.label(word)}`);
  }
});

test('the states keep their meaning: closure review waits for a person (pending), moving is progress, done is success; kinds are not coloured', () => {
  assert.deepEqual(issueState.words.map((w) => issueState.tone(w)), ['neutral', 'neutral', 'progress', 'progress', 'pending', 'success', 'neutral']);
  for (const kind of [issueType, issueCategory]) for (const w of kind.words) assert.equal(kind.tone(w), 'neutral', `${kind.record}.${w}`);
  assert.equal(issueState.label('closure_review'), 'Closure review');
  assert.equal(issueType.label('capa'), 'CAPA');
  assert.equal(issueType.label('non_conformance'), 'Non-conformance');
});

test('severity is the platform\'s one scale; "informational" reads neutral with its own word, and an unknown word is neutral too', () => {
  assert.deepEqual(statusPill(severity, 'critical'), { tone: 'danger', label: 'Critical' });
  assert.deepEqual(statusPill(severity, 'informational'), { tone: 'neutral', label: 'Informational' });
  assert.deepEqual(statusPill(issueState, 'under_watch'), { tone: 'neutral', label: 'Under watch' });
  assert.equal(statusPill(issueState, undefined).label, '—');
});

test('the options of a select are the registry\'s words in order', () => {
  assert.deepEqual(optionsOf(issueType).map((o) => o.value), ['incident', 'audit_finding', 'non_conformance', 'vendor_breach', 'process_gap', 'capa', 'other']);
  assert.deepEqual([...LEVELS], ['high', 'medium', 'low']);
});
