// node --test "src/app/(dashboard)/frameworks/\[id\]/_tabs/templateSequence.test.ts"
// The order of a framework's registers and documents in the Registers tab: the compliance lifecycle (scope, inventory, gap, risk ... audit), the first
// matching keyword group wins, what matches nothing comes last in alphabetical order, and a tie keeps the order the list had.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { orderDocuments, orderRegisters } from './templateSequence.ts';

const reg = (...labels: string[]) => labels.map((label) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label }));

test('registers go scope, inventory, gap, risk, applicability, readiness, roadmap, questionnaire, evidence, audit', () => {
  const out = orderRegisters(reg('Internal Audit', 'Evidence Request Tracker', 'Risk Assessment', 'Gap Analysis', 'Cardholder Data Inventory', 'Scope Boundary', 'Readiness Roadmap'));
  assert.deepEqual(out.map((r) => r.label), ['Scope Boundary', 'Cardholder Data Inventory', 'Gap Analysis', 'Risk Assessment', 'Readiness Roadmap', 'Evidence Request Tracker', 'Internal Audit']);
});

test('documents go scope, core policy, risk, domain policies, procedures, plans', () => {
  const out = orderDocuments(reg('Incident Response Plan', 'Access Control Policy', 'Information Security Policy', 'ISMS Scope Statement', 'Network Security Policy', 'Audit Procedure', 'Risk Treatment Method'));
  assert.deepEqual(out.map((d) => d.label), ['ISMS Scope Statement', 'Information Security Policy', 'Risk Treatment Method', 'Access Control Policy', 'Network Security Policy', 'Incident Response Plan', 'Audit Procedure']);
});

test('what matches nothing comes last, alphabetically; the same rank keeps its alphabetical order; the list is not changed', () => {
  const list = reg('Zebra', 'Apple', 'Gap Analysis');
  const out = orderRegisters(list);
  assert.deepEqual(out.map((r) => r.label), ['Gap Analysis', 'Apple', 'Zebra']);
  assert.deepEqual(list.map((r) => r.label), ['Zebra', 'Apple', 'Gap Analysis']);
  assert.deepEqual(orderRegisters([]), []);
});

test('the id is read as well as the label (a generated register keeps its keyword in its type)', () => {
  const out = orderRegisters([{ id: 'soc2__soc2_risk_assessment_template', label: 'Template A' }, { id: 'soc2__readiness', label: 'Template B' }, { id: 'zzz', label: 'Other' }]);
  assert.deepEqual(out.map((r) => r.id), ['soc2__soc2_risk_assessment_template', 'soc2__readiness', 'zzz']);
});
