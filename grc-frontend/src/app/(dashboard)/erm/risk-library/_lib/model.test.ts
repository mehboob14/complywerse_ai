// node --test "src/app/(dashboard)/erm/risk-library/_lib/model.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES, addedText, addressOf, apiParams, bandOf, filtersFrom, inherentScore, linkable, problem, rangeText, requestBody, startForm,
  toggleControl, type AddForm, type LibraryRisk,
} from './model.ts';

const RISK: LibraryRisk = {
  id: 'uae_ia:M2.3:03', framework_key: 'uae_ia', title: 'Too high residual risks', description: 'A relevant threat...', family_id: 'M2',
  family_name: 'Information Security Risk Management', family_kind: 'Management', objective_id: 'M2.3', objective_title: 'Information Security Risk Treatment',
  objective: 'To identify and plan appropriate risk treatment.', suggested_category: 'operational',
  controls: [{ control_id: 'M2.3.1', title: 'Options' }], in_register: null,
};

const filled = (change: Partial<AddForm> = {}): AddForm => ({ ...startForm(RISK), owner_id: '9', inherent_likelihood: '4', inherent_impact: '3', ...change });

test('the pop-up opens with the library words and the suggested category, and asks for the rest', () => {
  const form = startForm(RISK);
  assert.deepEqual([form.title, form.description, form.category], ['Too high residual risks', 'A relevant threat...', 'operational']);
  assert.equal(problem(form), 'Choose who owns the risk');
  assert.ok(CATEGORIES.some((c) => c.value === form.category));
});

test('it can be sent once the owner, the likelihood and the impact are chosen', () => {
  assert.equal(problem(filled()), null);
  assert.equal(problem(filled({ title: '  ' })), 'Give the risk a title');
  assert.equal(problem(filled({ inherent_likelihood: '' })), 'Choose how likely it is');
  assert.equal(problem(filled({ inherent_impact: '' })), 'Choose how severe it would be');
  assert.equal(problem(filled({ residual_likelihood: '2' })), 'Give both residual answers, or neither');
  assert.equal(problem(filled({ residual_likelihood: '2', residual_impact: '2' })), null);
});

test('the score and its band follow the register dashboard', () => {
  assert.equal(inherentScore(filled()), 12);
  assert.equal(inherentScore(filled({ inherent_impact: '' })), null);
  assert.deepEqual([null, 0, 1, 5, 6, 11, 12, 19, 20, 25].map((s) => bandOf(s)),
    [null, null, 'low', 'low', 'medium', 'medium', 'high', 'high', 'critical', 'critical']);
});

test('the request leaves empty optional answers out and numbers the rest', () => {
  const body = requestBody(filled({ treatment_plan: ' Reduce it ', review_date: '2027-01-15' }), false);
  assert.deepEqual(body, {
    title: 'Too high residual risks', description: 'A relevant threat...', category: 'operational', owner_id: 9, business_owner_id: undefined,
    team_id: undefined, inherent_likelihood: 4, inherent_impact: 3, residual_likelihood: undefined, residual_impact: undefined,
    treatment_plan: 'Reduce it', review_date: '2027-01-15T00:00:00', custom_values: undefined, control_codes: ['M2.3.1'],
    allow_duplicate: undefined,
  });
  assert.equal(requestBody(filled(), true).allow_duplicate, true);
});

test('the organisation own field values and the ticked controls go with the request', () => {
  const body = requestBody(filled({ controls: [] }), false, { business_line: 'Treasury' });
  assert.deepEqual([body.status, body.custom_values, body.control_codes], [undefined, { business_line: 'Treasury' }, []]);   // a library risk starts as a draft: no status is sent
});

test('every control the organisation holds is ticked at first, and the ones it lacks cannot be', () => {
  const risk: LibraryRisk = { ...RISK, controls: [
    { control_id: 'M2.3.1', title: 'A', installed: true }, { control_id: 'M2.3.2', title: 'B', installed: false }, { control_id: 'M2.3.3', title: 'C' }] };
  assert.deepEqual(linkable(risk), ['M2.3.1', 'M2.3.3']);
  assert.deepEqual(startForm(risk).controls, ['M2.3.1', 'M2.3.3']);
  const all = risk.controls.map((c) => c.control_id);
  assert.deepEqual(toggleControl(all, ['M2.3.1', 'M2.3.3'], 'M2.3.1'), ['M2.3.3']);
  assert.deepEqual(toggleControl(all, ['M2.3.3'], 'M2.3.1'), ['M2.3.1', 'M2.3.3']);   // ticked again: back in the objective's order
});

test('the toast says how many controls were linked', () => {
  const risk = { id: 7, title: 'Too high residual risks' };
  assert.equal(addedText({ risk, linked_controls: [] }), 'Risk #7: Too high residual risks');
  assert.equal(addedText({ risk, linked_controls: ['M2.3.1'] }), 'Risk #7: Too high residual risks · 1 control linked');
  assert.equal(addedText({ risk, linked_controls: ['M2.3.1', 'M2.3.2'] }), 'Risk #7: Too high residual risks · 2 controls linked');
});

test('the filters live in the address and come back from it', () => {
  const none = filtersFrom(() => null);
  assert.deepEqual(none, { framework: '', family: '', objective: '', q: '', view: 'all', page: 1 });
  assert.equal(addressOf(none), '');
  const some = { framework: 'uae_ia', family: 'T5', objective: 'T5.2', q: ' phishing ', view: 'open' as const, page: 3 };
  assert.equal(addressOf(some), '?framework=uae_ia&family=T5&objective=T5.2&q=phishing&view=open&page=3');
  const back = filtersFrom((k) => new URLSearchParams(addressOf(some)).get(k));
  assert.deepEqual(back, { ...some, q: 'phishing' });
  assert.equal(filtersFrom((k) => (k === 'view' ? 'weird' : k === 'page' ? '-4' : null)).view, 'all');
  assert.equal(filtersFrom((k) => (k === 'page' ? 'x' : null)).page, 1);
});

test('the API query pages by 25 and maps the view to the register mark', () => {
  assert.deepEqual(apiParams({ framework: '', family: '', objective: '', q: '', view: 'all', page: 1 }), { skip: 0, limit: 25 });
  assert.deepEqual(apiParams({ framework: 'uae_ia', family: 'M2', objective: '', q: 'risk', view: 'added', page: 2 }),
    { skip: 25, limit: 25, framework: 'uae_ia', family: 'M2', q: 'risk', in_register: true });
  assert.equal(apiParams({ framework: '', family: '', objective: '', q: '', view: 'open', page: 1 }).in_register, false);
  assert.deepEqual([rangeText(1, 159), rangeText(7, 159), rangeText(1, 0)], ['1-25 of 159', '151-159 of 159', '0 of 0']);
});
