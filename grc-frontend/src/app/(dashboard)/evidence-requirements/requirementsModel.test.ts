// node --test "src/app/(dashboard)/evidence-requirements/requirementsModel.test.ts"
// The rules of the Evidence Requirements catalogue. What moved here from page.tsx is compared with a frozen copy of the old code.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_FILTERS, applyStep, catalogueTiles, confidenceOf, controlLabel, countLine, filterRequirements, formatLabel, isFiltered, matchesSearch, nextSkips, readable, stepsFor, typeChoices,
  type Catalogue, type ParsedControl, type Requirement,
} from './requirementsModel.ts';

// ── the old code, verbatim ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const oldSearch = (req: Requirement, control: ParsedControl | undefined, searchTerm: string) => {              // page.tsx filteredRequirements
  if (!searchTerm) return true;
  const term = searchTerm.toLowerCase();
  const controlId = control?.control_id || control?.original_reference || '';
  const controlTitle = control?.title || '';
  return req.evidence_title.toLowerCase().includes(term) || controlId.toLowerCase().includes(term) || controlTitle.toLowerCase().includes(term);
};
const oldFormat = (f: string) => { const fmt = f.toString().toLowerCase().replace(/^\./, ''); return ['pdf', 'doc', 'docx', 'docs', 'xls', 'xlsx'].includes(fmt) ? 'Document' : f; };
const oldConfidence = (c: number) => (c >= 0.8 ? 'text-emerald-600' : c >= 0.5 ? 'text-amber-600' : 'text-rose-600');

let seq = 0;
const req = (over: Partial<Requirement> = {}): Requirement => ({
  id: ++seq, parsed_control_id: 100 + (seq % 3), evidence_title: `Evidence ${seq}`, evidence_description: 'd', evidence_type: 'policy', evidence_format: 'PDF', exact_requirements: null,
  acceptance_criteria: null, sample_evidence: null, collection_guidance: null, collection_frequency: 'annually', retention_period: null, priority: 'high', is_mandatory: true,
  status: 'draft', ai_confidence: null, created_at: null, submitted_at: null, reviewed_at: null, approved_at: null, ...over,
});
const controls = new Map<number, ParsedControl>([
  [100, { id: 100, control_id: '2.1', title: 'Other Permissible Purposes', original_reference: 'Article 2' }],
  [101, { id: 101, control_id: 'M1.1.1', title: 'Understanding the Entity', original_reference: 'M1.1.1' }],
]);
const rows = [
  req({ parsed_control_id: 100, evidence_title: 'Cross-Border Transfer Purpose Register', evidence_type: 'procedure', status: 'draft', priority: 'high' }),
  req({ parsed_control_id: 101, evidence_title: 'Interested parties register', evidence_type: 'document', status: 'submitted', priority: 'medium' }),
  req({ parsed_control_id: 102, evidence_title: 'Legal Basis Assessment', evidence_type: 'document', status: 'pending_review', priority: 'low', control_id: '7.7', control_title: 'Unlisted control' }),
  req({ parsed_control_id: 100, evidence_title: 'Board resolution', evidence_type: 'attestation', status: 'approved', priority: 'high' }),
  req({ parsed_control_id: 101, evidence_title: 'Rejected thing', evidence_type: 'document', status: 'rejected', priority: 'medium' }),
];

test('the search finds everything the old search found, and now also the reference the Control column shows', () => {
  for (const term of ['', 'register', 'REGISTER', 'cross', '2.1', 'm1', 'understanding', 'other perm', 'nothing', 'a']) {
    for (const r of rows) {
      const c = controls.get(r.parsed_control_id);
      if (oldSearch(r, c, term)) assert.equal(matchesSearch(r, c, term), true, `${term} / ${r.evidence_title}`);
    }
  }
  assert.equal(matchesSearch(rows[0], controls.get(100), 'Article 2'), true, 'the reference printed in the Control column');
  assert.equal(oldSearch(rows[0], controls.get(100), 'Article 2'), false, 'the old search could not find it');
  assert.equal(matchesSearch(rows[2], undefined, '7.7'), true, 'a control past the lookup is found by the id the requirement carries');
  assert.equal(matchesSearch(rows[2], undefined, 'unlisted'), true);
  assert.equal(matchesSearch(rows[0], controls.get(100), '   '), true);
});

test('the three choices and the search compose over the whole framework; nothing chosen keeps every row in order', () => {
  const ids = (f: Partial<typeof NO_FILTERS>) => filterRequirements(rows, { ...NO_FILTERS, ...f }, controls).map((r) => r.evidence_title);
  assert.equal(ids({}).length, 5);
  assert.deepEqual(ids({ status: ['draft', 'approved'] }), ['Cross-Border Transfer Purpose Register', 'Board resolution']);
  assert.deepEqual(ids({ priority: ['medium'] }), ['Interested parties register', 'Rejected thing']);
  assert.deepEqual(ids({ types: ['document'] }), ['Interested parties register', 'Legal Basis Assessment', 'Rejected thing']);
  assert.deepEqual(ids({ types: ['document'], status: ['submitted', 'rejected'], priority: ['medium'], q: 'rejected' }), ['Rejected thing']);
  assert.deepEqual(ids({ q: 'article 2', status: ['approved'] }), ['Board resolution']);
  assert.equal(isFiltered(NO_FILTERS), false);
  assert.equal(isFiltered({ ...NO_FILTERS, priority: ['high'] }), true);
});

test('the Type filter offers the types that exist, most common first (the old fixed list lacked "document" and "certificate")', () => {
  assert.deepEqual(typeChoices(rows), [
    { value: 'document', label: 'Document', count: 3 },
    { value: 'attestation', label: 'Attestation', count: 1 },
    { value: 'procedure', label: 'Procedure', count: 1 },
  ]);
  assert.deepEqual(typeChoices([]), []);
});

test('the label of a control: reference, id, the requirement\'s own id, then the number; the title the same', () => {
  assert.deepEqual(controlLabel(rows[0], controls.get(100)), { reference: 'Article 2', title: 'Other Permissible Purposes' });
  assert.deepEqual(controlLabel(rows[1], { id: 101, control_id: 'M1', title: 'T', original_reference: null }), { reference: 'M1', title: 'T' });
  assert.deepEqual(controlLabel(rows[2], undefined), { reference: '7.7', title: 'Unlisted control' });
  assert.deepEqual(controlLabel({ parsed_control_id: 55, control_id: null, control_title: null }, undefined), { reference: 'Control #55', title: 'Unknown control' });
});

test('the tiles are the framework\'s own counts, they add up, and the filters never change them', () => {
  const t = catalogueTiles({ draft: 53, submitted: 3, pending_review: 3, approved: 3, rejected: 2 }, 64);
  assert.deepEqual(t, { total: 64, draft: 53, inReview: 6, approved: 3, rejected: 2 });
  assert.equal(t.draft + t.inReview + t.approved + t.rejected, t.total);
  assert.deepEqual(catalogueTiles({}, 0), { total: 0, draft: 0, inReview: 0, approved: 0, rejected: 0 });
  assert.equal(catalogueTiles({ draft: 2, approved: 1 }, undefined).total, 3);
  assert.deepEqual(catalogueTiles(undefined, undefined), { total: 0, draft: 0, inReview: 0, approved: 0, rejected: 0 });
});

test('the steps: draft is submitted, submitted is reviewed, pending is approved or rejected, nothing else; a person who may not edit has none', () => {
  assert.deepEqual(stepsFor('draft', true).map((s) => s.key), ['submit']);
  assert.deepEqual(stepsFor('submitted', true).map((s) => s.key), ['review']);
  assert.deepEqual(stepsFor('pending_review', true).map((s) => s.key), ['approve', 'reject']);
  for (const s of ['approved', 'rejected', 'weird']) assert.deepEqual(stepsFor(s, true), [], s);
  for (const s of ['draft', 'submitted', 'pending_review']) assert.deepEqual(stepsFor(s, false), [], `${s}: not allowed to edit`);
  assert.equal(stepsFor('submitted', true)[0].label, 'Start review');
});

test('words: the file format as the page said it, the AI confidence bands, readable words, the count line', () => {
  for (const f of ['pdf', 'PDF', '.docx', 'XLSX', 'xls', 'docs', 'PNG', 'JSON', 'CSV', 'document']) assert.equal(formatLabel(f), oldFormat(f), f);
  assert.equal(formatLabel(null), '');
  for (const c of [0, 0.3, 0.49, 0.5, 0.79, 0.8, 0.85, 1]) {
    const word = confidenceOf(c)?.word;
    assert.equal({ high: 'text-emerald-600', medium: 'text-amber-600', low: 'text-rose-600' }[word as 'high'], oldConfidence(c), String(c));
  }
  assert.deepEqual(confidenceOf(0.425), { pct: 43, word: 'low' });
  assert.equal(confidenceOf(null), null);
  assert.deepEqual(['annually', 'on-change', 'one_time', '', null].map(readable), ['Annually', 'On change', 'One time', '', '']);
  assert.equal(countLine(64, 64), '64 requirements');
  assert.equal(countLine(1, 1), '1 requirement');
  assert.equal(countLine(12, 1070), '12 of 1,070 requirements');
});

test('a confirmed step updates the one requirement and the framework counts from the server\'s own answer, and touches nothing else', () => {
  const cat: Catalogue = { framework_id: 25, framework_name: 'F', total: 5, status_counts: { draft: 3, submitted: 1, pending_review: 1 }, requirements: [
    req({ id: 1, status: 'draft' }), req({ id: 2, status: 'draft' }), req({ id: 3, status: 'draft' }), req({ id: 4, status: 'submitted' }), req({ id: 5, status: 'pending_review' }),
  ] };
  const a = applyStep(cat, 1, 'submit', { status: 'submitted', submitted_at: '2026-11-01T10:00:00' });
  assert.deepEqual(a.status_counts, { draft: 2, submitted: 2, pending_review: 1 });
  assert.equal(a.requirements[0].status, 'submitted');
  assert.equal(a.requirements[0].submitted_at, '2026-11-01T10:00:00');
  assert.equal(a.requirements[1], cat.requirements[1], 'the other rows are the same objects');
  assert.equal(cat.requirements[0].status, 'draft', 'the loaded catalogue is not changed in place');
  assert.equal(a.total, 5);
  const b = applyStep(cat, 4, 'review', { status: 'pending_review', reviewed_at: '2026-11-01T11:00:00' });
  assert.deepEqual(b.status_counts, { draft: 3, submitted: 0, pending_review: 2 });
  const c = applyStep(cat, 5, 'approve', { status: 'approved', approved_at: '2026-11-01T12:00:00' });
  assert.deepEqual([c.status_counts.approved, c.status_counts.pending_review, c.requirements[4].approved_at], [1, 0, '2026-11-01T12:00:00']);
  const d = applyStep(cat, 5, 'reject', { status: 'rejected', rejection_reason: 'No population stated.' });
  assert.deepEqual([d.requirements[4].status, d.requirements[4].rejection_reason, d.status_counts.rejected], ['rejected', 'No population stated.', 1]);
  assert.equal(applyStep(cat, 99, 'submit', { status: 'submitted' }), cat, 'an id that is not loaded changes nothing');
  assert.equal(applyStep(cat, 2, 'submit', {}).requirements[1].status, 'submitted', 'an answer without a status takes the step\'s own next one');
  assert.equal(applyStep(cat, 4, 'review', { status: 'submitted' }).status_counts.submitted, 1, 'the same status moves no count');
});

test('the follow-up pages of a framework: every skip still to fetch, never more than the cap', () => {
  assert.deepEqual(nextSkips(500, 1070, 500), [500, 1000]);
  assert.deepEqual(nextSkips(64, 64, 500), []);
  assert.deepEqual(nextSkips(500, 500, 500), []);
  assert.deepEqual(nextSkips(500, 501, 500), [500]);
  assert.equal(nextSkips(1, 1_000_000, 1, 60).length, 60, 'a server that keeps answering short pages cannot loop for ever');
  assert.deepEqual(nextSkips(0, 3, 0).length, 3, 'a page size of 0 still ends');
});
