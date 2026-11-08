// node --test "src/app/(dashboard)/erm/risk-assessments/_register/assessmentFacets.test.ts"
// The facet engine's answer for the Risk Assessments home is held to the plain filter, the counts are what choosing an option would show, and the chips say what is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate } from '../../../../../components/records/facetEngine.ts';
import { chosenOf, filterChips, indexAssessments, orderedOptions, railOptions, removeChip, ruleOf } from './assessmentFacets.ts';
import { NO_FILTERS, plainFilter, type AssessmentRow, type Filters } from './assessmentModel.ts';

const row = (o: Partial<AssessmentRow> & { id: number }): AssessmentRow => ({ kind: 'manual', name: `A${o.id}`, status: 'draft', total_items: 0, done_items: 0, blocked_items: 0, mine_items: 0, ...o });
const ROWS: AssessmentRow[] = [
  row({ id: 1, status: 'in_progress', owner_id: 7, owner_name: 'Sana', total_items: 14, done_items: 9 }),
  row({ id: 2, status: 'under_review', owner_id: 8, owner_name: 'Ali', total_items: 5 }),
  row({ id: 1, kind: 'framework', name: 'ISO 27005 2026', status: 'in_progress', owner_id: 8, owner_name: 'Ali', framework_name: 'ISO 27005', total_items: 40, blocked_items: 2, mine_items: 3 }),
  row({ id: 3, kind: 'framework', name: 'PCI Q12', status: 'completed', framework_name: 'PCI DSS', total_items: 20, done_items: 20 }),
  row({ id: 4, status: 'draft' }),
];
const CTX = { me: 7 };

const FILTERS: Filters[] = [
  NO_FILTERS,
  { ...NO_FILTERS, kind: ['framework'] },
  { ...NO_FILTERS, status: ['in_progress', 'approved'] },
  { ...NO_FILTERS, owner: ['8', 'none'] },
  { ...NO_FILTERS, framework: ['PCI DSS'], kind: ['framework'] },
  { ...NO_FILTERS, quick: 'blocked' },
  { ...NO_FILTERS, quick: 'mine', status: ['in_progress'] },
  { ...NO_FILTERS, search: 'iso 2026' },
  { ...NO_FILTERS, search: 'nothing like it' },
];

test('the engine\'s matches are the plain filter\'s, for every combination', () => {
  const index = indexAssessments(ROWS);
  for (const f of FILTERS) {
    const got = evaluate(index, chosenOf(f), ruleOf(f, CTX)).matches.map((r) => `${r.kind}${r.id}`);
    assert.deepEqual(got, plainFilter(ROWS, f, CTX).map((r) => `${r.kind}${r.id}`), JSON.stringify(f));
  }
});

test('the number beside an option is what choosing it would show, with the other filters as they are', () => {
  const index = indexAssessments(ROWS);
  const f: Filters = { ...NO_FILTERS, kind: ['manual'] };
  const { counts } = evaluate(index, chosenOf(f), ruleOf(f, CTX));
  assert.equal(counts.kind.get('framework'), 2);                         // choosing Framework alongside would show its two
  assert.equal(counts.status.get('in_progress'), 1);                      // one manual in progress
  assert.equal(counts.status.get('approved') ?? 0, 0);
  assert.equal(counts.owner.get('none'), 1);
});

test('the rail offers only what the rows have, an unowned one last, and keeps a chosen option with zero rows', () => {
  const o = railOptions(ROWS);
  assert.deepEqual(o.owner.map((x) => x.label), ['Ali', 'Sana', 'No owner']);
  assert.deepEqual(o.framework.map((x) => x.label), ['ISO 27005', 'PCI DSS', 'No framework']);
  assert.deepEqual(orderedOptions(o.status, [], (v) => (v === 'draft' ? 1 : 0)).map((x) => x.value), ['draft']);
  assert.deepEqual(orderedOptions(o.status, ['closed'], (v) => (v === 'draft' ? 1 : 0)).map((x) => x.value), ['draft', 'closed']);
});

test('the chips say what is on and each one can be taken off', () => {
  const f: Filters = { ...NO_FILTERS, search: 'iso', quick: 'blocked', status: ['in_progress'], owner: ['8'] };
  const chips = filterChips(f, railOptions(ROWS));
  assert.deepEqual(chips.map((c) => c.label), ['Search: iso', 'Blocked questions', 'Stage: In progress', 'Owner: Ali']);
  let left = f;
  chips.forEach((c) => { left = removeChip(left, c); });
  assert.deepEqual(left, NO_FILTERS);
});
