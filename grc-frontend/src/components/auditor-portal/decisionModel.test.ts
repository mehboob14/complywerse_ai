// node --test "src/components/auditor-portal/decisionModel.test.ts"
// The Decision sheet's rules: turning down needs a note (approving does not, unless the page says so), a note longer than the server takes is named, an earlier
// decision is said with who and when, and the sheet's own source follows the kit and sends exactly what the model cleaned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../ui/ds/kitRules.ts';
import { DEFAULT_RULE, cleanRemarks, previousLine, remarksProblem, remarksRequired, ruleOf } from './decisionModel.ts';

const label = (w: string) => (w === 'rejected' ? 'Turned down' : w === 'approved' ? 'Approved' : w);

test('turning down needs a note and approving does not, by default', () => {
  assert.equal(remarksRequired('rejected', DEFAULT_RULE), true);
  assert.equal(remarksRequired('approved', DEFAULT_RULE), false);
  assert.match(remarksProblem('rejected', '   ')!, /Say why it is turned down/);
  assert.equal(remarksProblem('approved', ''), null);
  assert.equal(remarksProblem('rejected', ' too slow '), null);
});

test('the page can ask for the note on both decisions, or on neither', () => {
  const both = ruleOf({ requiredFor: 'both' });
  assert.match(remarksProblem('approved', '', both)!, /Add a note/);
  assert.match(remarksProblem('rejected', '', both)!, /Say why/);
  const none = ruleOf({ requiredFor: 'none' });
  assert.equal(remarksProblem('rejected', '', none), null);
  assert.equal(ruleOf(null).max, 4000, 'the server takes 4,000 characters (reviews.py)');
  assert.equal(ruleOf({ max: 0 }).max, 4000, 'a limit of nothing is the default');
});

test('a note longer than the limit is named with both numbers, and the note is sent trimmed', () => {
  const long = 'x'.repeat(4001);
  assert.equal(remarksProblem('approved', long), 'Keep the note to 4,000 characters or fewer (it is 4,001).');
  assert.equal(remarksProblem('approved', 'x'.repeat(4000)), null);
  assert.equal(cleanRemarks('  see the policy \n'), 'see the policy');
  assert.equal(cleanRemarks(null), '');
});

test('an earlier decision says who and when, leaves out what is not recorded, and is nothing when nothing was decided', () => {
  assert.equal(previousLine({ decision: 'rejected', by: 'Ada Admin', at: '2026-11-12T09:30:00' }, label)?.startsWith('Turned down by Ada Admin on '), true);
  assert.equal(previousLine({ decision: 'approved' }, label), 'Approved');
  assert.equal(previousLine({ decision: 'approved', by: 'Ada Admin' }, label), 'Approved by Ada Admin');
  assert.equal(previousLine(null, label), null);
  assert.equal(previousLine({ decision: '' }, label), null);
});

test('the sheet follows the kit, uses no native dialog, and sends the cleaned note', () => {
  const src = readFileSync(new URL('./DecisionSheet.tsx', import.meta.url), 'utf8');
  assert.deepEqual(findViolations(src).map((v) => `${v.line} ${v.rule}`), []);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /\bwindow\.(confirm|alert|prompt)\b/);
  assert.match(src, /onDecide\(decision, cleanRemarks\(note\)\)/, 'what is sent is the cleaned note');
  assert.match(src, /import \{[^}]*\bSheet\b[^}]*\} from '@\/components\/ui\/ds'/, 'built on the kit sheet');
  assert.match(src, /dirty=\{/, 'a typed note is not thrown away silently');
});
