// node --test "src/app/(dashboard)/evidence/[id]/_record/linkModel.test.ts"
// What is linked to a file and what is suggested: every number is the length of a list, no id is ever a title, the suggestions are one list, best first.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMMEDIATE, LINKABLE, LINK_TYPES, PICK_SHOWN, STRONG, auditObservationId, bandOf, coverageSummary, frameworkNames, linkCounts, linkedIdsOf, linkedItems, linkedTotal, matchItems, matchPct, offered,
  strongByTarget, suggestionCounts, type Suggestion,
} from './linkModel.ts';
import type { AllLinks, ControlsResponse } from './recordTypes.ts';

const controls: ControlsResponse = {
  evidence_id: 1, total_mappings: 4,
  normalized_controls: [
    { id: 10, clause_reference: 'Access review', coverage_type: 'full', normalized_control: { id: 5, code: 'SCF-IAC-01', scf_id: 'IAC-01', name: 'Identity and access', requirements: [{ key: 'iso', label: 'ISO 27001', codes: ['A.5.1', 'A.5.2'] }, { key: 'nca', label: 'NCA', codes: ['1-1'] }] } },
    { id: 11, coverage_type: 'partial', is_locked: true, normalized_control: { id: 6, code: 'SCF-BCD-01', scf_id: 'BCD-01', name: 'Continuity', requirements: [{ key: 'iso', label: 'ISO 27001', codes: ['A.5.2', 'A.5.3'] }] } },
  ],
  by_framework: [
    { framework_id: 1, framework_name: 'PCI DSS', framework_code: 'PCI', controls: [{ id: 12, coverage_type: 'full', framework_control: { id: 3, code: '8.2', name: 'Identify users' } }, { id: 10, normalized_control: { id: 5, code: 'x', name: 'y' } }] },
    { framework_id: 7, framework_name: 'NCA ECC', framework_code: 'NCA', controls: [{ id: 13, parsed_control: { id: 70, control_id: 'NCA-2', title: 'A parsed control' } }] },
  ],
  unresolved: [{ id: 14, control_code: 'OLD-1', framework_name: 'Old framework', clause_reference: 'Clause 4' }],
};
const links: AllLinks = {
  evidence_id: 1,
  risks: { total: 2, links: [{ id: 1, risk_id: 9, risk: { title: 'Data loss', status: 'open', inherent_score: 20, residual_score: 8 } }, { id: 2, risk_id: 10, risk: null }] },
  assets: { total: 1, links: [{ id: 3, asset_id: 4, link_type: 'source', asset: { name: 'Core banking', asset_type: 'application', criticality: 'high' } }] },
  incidents: { total: 1, links: [{ id: 4, incident_id: 5, link_type: null, incident: null }] },
  policy_statements: { total: 1, links: [{ id: 5, policy_statement_id: 6, link_type: null, policy_statement: { statement_code: 'POL-1', statement_summary: 'x'.repeat(200), document_id: 8, document_title: 'Access policy', source_section: '4.1' } }] },
  assessments: { total: 1, links: [{ id: 6, assessment_id: 12, assessment_name: 'NCA assessment', item_number: '2-1', area_domain: 'Identity', control_description: 'd', link_status: 'linked' }] },
  audit_observations: { total: 2, links: [{ id: 7, kind: 'issue', record_id: 31, link_type: null, code: 'ISS-31', title: 'Finding', status: 'open', priority: 'high', source: 'Internal audit' }, { id: 8, kind: 'observation', record_id: 40, link_type: null, code: null, title: null, status: null, priority: null, source: null }] },
};

test('every kind is listed, the counts are the lists, and the Linked tab\'s number is all of them', () => {
  const items = linkedItems(controls, links);
  assert.deepEqual(Object.keys(items), [...LINK_TYPES]);
  const counts = linkCounts(controls, links);
  assert.deepEqual(counts, { common_controls: 2, framework_controls: 3, policy_statements: 1, assessments: 1, audit_observations: 2, risks: 2, assets: 1, incidents: 1 });
  assert.equal(linkedTotal(counts), 13);
  assert.deepEqual(linkCounts(undefined, undefined), { common_controls: 0, framework_controls: 0, policy_statements: 0, assessments: 0, audit_observations: 0, risks: 0, assets: 0, incidents: 0 });
});

test('a mapping that a common control already covers is not listed a second time as a framework requirement; the framework ones and the broken ones are', () => {
  const rows = linkedItems(controls, links).framework_controls;
  assert.deepEqual(rows.map((r) => [r.code, r.title, r.subtitle]), [['8.2', 'Identify users', 'PCI DSS'], ['NCA-2', 'A parsed control', 'NCA ECC'], ['OLD-1', 'Clause 4', 'Old framework']]);
  assert.deepEqual(rows.map((r) => r.unlink?.id), [12, 13, 14]);
});

test('a common control carries its requirements as counted chips, opens its details, links to its page, and a test sample cannot be unlinked here', () => {
  const [first, second] = linkedItems(controls, links).common_controls;
  assert.equal(first.code, 'IAC-01');
  assert.deepEqual(first.chips, [{ label: 'ISO 27001', count: 2 }, { label: 'NCA', count: 1 }]);
  assert.equal(first.control?.scfId, 'IAC-01');
  assert.equal(first.href, '/automation/soc2-controls/IAC-01');
  assert.equal(first.subtitle, 'Linked as “Access review”');
  assert.deepEqual(first.unlink, { kind: 'control', id: 10 });
  assert.equal(second.unlink, undefined);
  assert.match(second.locked ?? '', /test sample/);
});

test('no id is ever a title: an unnamed record reads "A risk", "An asset", "An incident"; a long summary is cut', () => {
  const items = linkedItems(controls, links);
  assert.deepEqual(items.risks.map((r) => r.title), ['Data loss', 'A risk']);
  assert.equal(items.incidents[0].title, 'An incident');
  assert.equal(items.assets[0].title, 'Core banking');
  assert.equal(items.audit_observations[1].title, 'An audit observation');
  assert.ok(items.policy_statements[0].title.length <= 121 && items.policy_statements[0].title.endsWith('…'));
  for (const list of Object.values(items)) for (const it of list) assert.doesNotMatch(it.title, /#\d/);
});

test('links open the record they name, and unlinking says which request to send', () => {
  const items = linkedItems(controls, links);
  assert.equal(items.risks[0].href, '/erm/risks/9');
  assert.equal(items.assets[0].href, '/cyber-assurance/assets/4');
  assert.equal(items.policy_statements[0].href, '/governance/documents/8');
  assert.equal(items.assessments[0].href, '/compliance/assessments/12');
  assert.equal(items.audit_observations[0].href, '/issues/31');
  assert.equal(items.audit_observations[1].href, '/auditor-portal/statutory-audit/40');
  assert.deepEqual(items.audit_observations[0].unlink, { kind: 'audit', id: 7, auditKind: 'issue' });
  assert.equal(items.assessments[0].unlink, undefined, 'an assessment item links its evidence itself: read-only here');
});

test('the people can link six kinds from this page; assessments and framework requirements come from elsewhere', () => {
  assert.deepEqual([...LINKABLE], ['common_controls', 'policy_statements', 'audit_observations', 'risks', 'assets', 'incidents']);
});

test('coverage adds each framework requirement once however many controls fulfil it; no framework in scope says nothing', () => {
  assert.equal(coverageSummary(controls), 'Together these fulfil 4 framework requirements: ISO 27001 3 · NCA 1.');
  assert.equal(coverageSummary({ ...controls, normalized_controls: [] }), null);
  assert.equal(coverageSummary(undefined), null);
});

test('the frameworks a file answers are those of its controls, each once, in order', () => {
  assert.deepEqual(frameworkNames(controls), ['ISO 27001', 'NCA', 'NCA ECC', 'PCI DSS']);
  assert.deepEqual(frameworkNames(undefined), []);
});

test('a match is a whole 0-100 number from either scale; strong starts at 80', () => {
  assert.equal(matchPct(0.83), 83);
  assert.equal(matchPct(83), 83);
  assert.equal(matchPct(null), 0);
  assert.equal(STRONG, 80);
  assert.deepEqual([bandOf(80), bandOf(79), bandOf(70), bandOf(69)], ['strong', 'fair', 'fair', 'weak']);
});

const rec = (id: number, confidence: number, extra: Partial<Suggestion> = {}): Suggestion => ({ id, confidence, title: `S${id}`, ...extra });

test('suggestions are one list: the best match first, ties in the order the kinds are asked, without what is linked or dismissed', () => {
  const list = offered([
    { target: 'common_controls', recs: [rec(1, 0.7), rec(2, 90)], linked: new Set([9]) },
    { target: 'risks', recs: [rec(3, 90), rec(9, 99)], linked: new Set([9]) },
    { target: 'assets', recs: undefined, linked: new Set() },
    { target: 'incidents', recs: [rec(4, 0.95)], linked: new Set() },
  ], new Set(['incidents:4']));
  assert.deepEqual(list.map((o) => `${o.target}:${o.rec.id}`), ['common_controls:2', 'risks:3', 'common_controls:1']);
  assert.deepEqual(suggestionCounts(list), { common_controls: 2, risks: 1 });
});

test('the strong ones are grouped by kind for one request each', () => {
  const list = offered([{ target: 'common_controls', recs: [rec(1, 85), rec(2, 60)], linked: new Set() }, { target: 'risks', recs: [rec(3, 0.8)], linked: new Set() }], new Set());
  const strong = strongByTarget(list);
  assert.deepEqual(Array.from(strong.keys()), ['common_controls', 'risks']);
  assert.deepEqual(strong.get('common_controls')?.map((s) => s.id), [1]);
});

test('what a kind subtracts from its suggestions is what is linked, by the id the recommender uses; the common-control one runs without a rating', () => {
  assert.deepEqual(Array.from(linkedIdsOf('common_controls', controls, links)), [5, 6]);
  assert.deepEqual(Array.from(linkedIdsOf('audit_observations', controls, links)), [-31, 40]);
  assert.equal(auditObservationId('issue', 31), -31);
  assert.deepEqual(Array.from(linkedIdsOf('risks', controls, links)), [9, 10]);
  assert.deepEqual(Array.from(linkedIdsOf('assets', controls, links)), [4]);
  assert.deepEqual(Array.from(linkedIdsOf('incidents', controls, links)), [5]);
  assert.deepEqual(Array.from(linkedIdsOf('policy_statements', controls, links)), [6]);
  assert.deepEqual([...IMMEDIATE], ['common_controls']);
});

test('the link sheet search needs every word, ignores case and accents, and draws the first hundred with the true number of matches', () => {
  const items = [
    { value: '1', label: 'Identity and access management', sub: 'IAC-01' },
    { value: '2', label: 'Gestión de identidades', sub: 'Spanish' },
    { value: '3', label: 'Backup', sub: undefined },
  ];
  assert.deepEqual(matchItems(items, '  ').shown.map((i) => i.value), ['1', '2', '3']);
  assert.deepEqual(matchItems(items, 'IDENTITY access').shown.map((i) => i.value), ['1']);
  assert.deepEqual(matchItems(items, 'gestion identidades').shown.map((i) => i.value), ['2'], 'accents are ignored');
  assert.deepEqual(matchItems(items, 'iac-01').shown.map((i) => i.value), ['1'], 'the line under the label is searched too');
  assert.deepEqual(matchItems(items, 'nothing like it'), { shown: [], total: 0 });
  const many = Array.from({ length: 412 }, (_, i) => ({ value: String(i), label: `Risk ${i}` }));
  const m = matchItems(many, '');
  assert.deepEqual([m.shown.length, m.total, PICK_SHOWN], [100, 412, 100]);
});
