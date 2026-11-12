// node --test "src/app/(dashboard)/erm/risk-library/_lib/flow.test.ts"
// The identification step: propose to an owner, the owner's draft, the review's side by side, the list's chips and the tab address.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS_LABEL, draftBody, draftProblem, proposeBody, proposeLabel, proposeProblem, proposedText, sideBySide, startDraft, openedFrom, whereUsed,
  type LibraryRisk, type Proposal,
} from './model.ts';

const RISK: LibraryRisk = {
  id: 'uae_ia:M2.3:01', framework_key: 'uae_ia', title: 'Risks not treated', description: 'The library text.', family_id: 'M2',
  family_name: 'Risk Management', family_kind: 'Management', objective_id: 'M2.3', objective_title: 'Risk Treatment',
  objective: 'To treat risks.', suggested_category: 'operational', controls: [], in_register: null, proposals: [],
};

const PROPOSAL: Proposal = {
  id: 4, library_item_id: RISK.id, title: RISK.title, objective_id: 'M2.3', objective_title: 'Risk Treatment', business_unit_id: 1,
  unit_name: 'Retail', owner_id: 9, owner_name: 'Olu Owner', proposed_by: 8, proposed_by_name: 'Ana', proposed_at: null, note: null,
  status: 'proposed', drafted_by: null, drafted_at: null, decline_reason: null, reviewed_by: null, reviewed_by_name: null,
  reviewed_at: null, review_comment: null, risk: null, you: { may_draft: true, may_decline: true, may_challenge: false },
  library_risk: RISK,
};

test('the register action proposes first, then for another unit once it is in a register or proposed', () => {
  assert.equal(proposeLabel(RISK), 'Propose to owner');
  assert.equal(proposeLabel({ ...RISK, in_register: { risk_id: 1, title: 'x', status: 'open', times: 1, units: ['Retail'] } }), 'Propose for another unit');
  const mark = { id: 1, status: 'drafted' as const, business_unit_id: 1, unit_name: 'Retail', owner_id: 9, owner_name: null, risk_id: 3 };
  const proposed = { ...RISK, proposals: [mark, { ...mark, id: 2, unit_name: 'Treasury', status: 'proposed' as const }] };
  assert.equal(proposeLabel(proposed), 'Propose for another unit');
  assert.equal(proposedText(proposed), 'Proposed · Retail, Treasury');
  assert.equal(proposedText(RISK), null);
  assert.equal(proposedText({ ...RISK, proposals: [{ ...mark, unit_name: null }] }), 'Proposed');
  assert.deepEqual(whereUsed({ ...proposed, in_register: { risk_id: 1, title: 'x', status: 'open', times: 1, units: ['Ops'] } }),
    ['Ops (in register)', 'Retail (waiting for challenge)', 'Treasury (proposed)']);
});

test('a proposal needs the unit and the owner', () => {
  assert.equal(proposeProblem({ business_unit_id: '', owner_id: '9', note: '' }), 'Choose the unit');
  assert.equal(proposeProblem({ business_unit_id: '1', owner_id: '', note: '' }), 'Choose the risk owner');
  assert.equal(proposeProblem({ business_unit_id: '1', owner_id: '9', note: '' }), null);
  assert.deepEqual(proposeBody({ business_unit_id: '1', owner_id: '9', note: '  ' }), { business_unit_id: 1, owner_id: 9, note: undefined });
});

test('the owner drafts from the library words, or from their last draft after a return', () => {
  const fresh = startDraft(PROPOSAL, RISK);
  assert.deepEqual(fresh, { title: 'Risks not treated', description: 'The library text.', inherent_likelihood: '', inherent_impact: '' });
  assert.equal(draftProblem(fresh), 'Choose how likely it is');
  assert.equal(draftProblem({ ...fresh, inherent_likelihood: '4' }), 'Choose how severe it would be');
  assert.equal(draftProblem({ ...fresh, title: ' ' }), 'Give the risk a title');
  const returned = { ...PROPOSAL, status: 'returned' as const, risk: { id: 3, title: 'Our words', description: 'Ours', category: 'operational',
    status: 'draft', inherent_likelihood: 4, inherent_impact: 3, inherent_score: 12, priority: 'high' } };
  const again = startDraft(returned, RISK);
  assert.deepEqual(again, { title: 'Our words', description: 'Ours', inherent_likelihood: '4', inherent_impact: '3' });
  assert.deepEqual(draftBody({ ...again, title: ' Our words ' }), { title: 'Our words', description: 'Ours', inherent_likelihood: 4, inherent_impact: 3 });
});

test('the review puts the library beside the owner draft and marks what changed', () => {
  const drafted = { ...PROPOSAL, status: 'drafted' as const, risk: { id: 3, title: 'Risks not treated', description: 'Our reading',
    category: 'operational', status: 'draft', inherent_likelihood: 4, inherent_impact: 3, inherent_score: 12, priority: 'high' } };
  const rows = sideBySide(drafted);
  assert.deepEqual(rows.map((r) => [r.label, r.changed]),
    [['Risk', false], ['Description', true], ['Category', false], ['Before controls score', false]]);
  assert.equal(rows[3].draft, '12 (likelihood 4 × impact 3)');
  assert.equal(sideBySide(PROPOSAL)[3].draft, 'Not drafted');
  assert.equal(STATUS_LABEL.drafted, 'Waiting for challenge');
});

test('the unit and the proposal a notification opens live in the address', () => {
  assert.deepEqual(openedFrom(() => null), { unit: '', proposal: null });
  const q = new URLSearchParams('tab=proposals&proposal=12');
  assert.deepEqual(openedFrom((k) => q.get(k)), { unit: '', proposal: 12 });
  const s = new URLSearchParams('tab=suggestions&unit=3&proposal=x');
  assert.deepEqual(openedFrom((k) => s.get(k)), { unit: '3', proposal: null });
});
