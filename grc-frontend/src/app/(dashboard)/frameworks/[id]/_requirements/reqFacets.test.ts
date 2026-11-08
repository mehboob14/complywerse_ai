// node --test "src/app/(dashboard)/frameworks/\[id\]/_requirements/reqFacets.test.ts"
// The Requirements tab's facets: the engine held to the plain filter (and each option's count is what choosing it would show), a requirement out of scope kept out until the Scope
// facet asks, the rail's options, the chips, and the address round trip (a link opens the same view; a value the tab cannot be in is the default).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CertificationControl } from '../../../../../types/index.ts';
import { countOf, evaluate } from '../../../../../components/records/facetEngine.ts';
import { readAddress, writeAddress } from '../../../../../lib/addressState.ts';
import { DEFAULT_SORT, NONE, toRows, type ReqRow, type Viewer } from './reqModel.ts';
import {
  NO_FILTERS, chosenOf, facetWorthShowing, filterChips, filterCount, indexReqs, orderedOptions, railOptions, removeChip, ruleOf, type Filters,
} from './reqFacets.ts';
import { REQ_SCHEMA, filtersPatch, pageOf, type ReqAddress } from './reqAddress.ts';

let n = 0;
const c = (over: Record<string, unknown> = {}): CertificationControl => {
  n += 1;
  return {
    id: n, journey_id: 1, framework_control_id: null, parsed_control_id: 500 + n, control_code: `C.${n}`, control_name: `Control ${n}`, control_statement: `The entity shall ${n}.`, domain_name: 'D1 General',
    status: 'not_started', is_applicable: true, sub_controls: [], evidence_requirements: [], evidence: [], evidence_count: 0, required_evidence_count: 2, approved_evidence_count: 0, ...over,
  } as unknown as CertificationControl;
};
const ME: Viewer = { me: 7 };
const ROWS: ReqRow[] = toRows([
  c({ domain_name: 'A Org', status: 'implemented', evidence_count: 2, approved_evidence_count: 2, evidence: [{ id: 1, review_status: 'approved' }, { id: 2, review_status: 'approved' }], assigned_user_ids: [7], assignees: [{ id: 7, display_name: 'Sara', email: '' }], priority_tier: 'P1' }),
  c({ domain_name: 'A Org', status: 'in_progress', evidence_count: 1, evidence: [{ id: 3, review_status: 'pending' }], assigned_user_ids: [8], assignees: [{ id: 8, display_name: 'Khalid', email: '' }], is_critical: true }),
  c({ domain_name: 'B People', status: 'not_started' }),
  c({ domain_name: 'B People', status: 'not_started', is_applicable: false, assigned_user_ids: [7], assignees: [{ id: 7, display_name: 'Sara', email: '' }] }),
  c({ domain_name: 'B People', status: 'verified', evidence_count: 2, approved_evidence_count: 2, evidence: [{ id: 4, review_status: 'approved' }, { id: 5, review_status: 'approved' }], priority_tier: 'P2' }),
]);

test('a requirement that is out of scope stays out of every list and count until the Scope facet asks for it', () => {
  const idx = indexReqs(ROWS);
  const base = evaluate(idx, chosenOf(NO_FILTERS), ruleOf(NO_FILTERS, ME));
  assert.equal(base.matches.length, 4, 'one of the five is out of scope');
  assert.ok(base.matches.every((r) => r.inScope));
  assert.equal(countOf(base.counts, 'scope', 'out'), 1, 'but the facet can say there is one, so choosing it is possible');
  const asked: Filters = { ...NO_FILTERS, scope: ['out'] };
  const only = evaluate(idx, chosenOf(asked), ruleOf(asked, ME));
  assert.deepEqual(only.matches.map((r) => r.inScope), [false]);
});

test('the facet engine agrees with the plain filter, and each option\'s count is what choosing it would show', () => {
  const idx = indexReqs(ROWS);
  const f: Filters = { ...NO_FILTERS, status: ['not_started', 'in_progress'], section: ['0'] };
  const got = evaluate(idx, chosenOf(f), ruleOf(f, ME));
  const plain = ROWS.filter((r) => r.inScope && ['not_started', 'in_progress'].includes(r.status) && r.sectionKey === '0').map((r) => r.id);
  assert.deepEqual(got.matches.map((r) => r.id), plain);
  assert.equal(countOf(got.counts, 'status', 'implemented'), 1, 'choosing "implemented" as well would add the first row');
  assert.equal(countOf(got.counts, 'section', '1'), 1, 'in the other section, with the status unchanged, one not-started requirement would show');
  const mine = evaluate(idx, chosenOf(NO_FILTERS), ruleOf({ ...NO_FILTERS, quick: 'mine' }, ME));
  assert.deepEqual(mine.matches.map((r) => r.control.control_code), [ROWS[0].code], 'mine: the one in scope; the out-of-scope one is not shown');
  const waiting = evaluate(idx, chosenOf(NO_FILTERS), ruleOf({ ...NO_FILTERS, quick: 'review' }, ME));
  assert.deepEqual(waiting.matches.map((r) => r.evidenceKey), ['review']);
});

test('the owner facet counts a requirement under each of its owners and under Unassigned when it has none', () => {
  const two = toRows([c({ assigned_user_ids: [1, 2], assignees: [{ id: 1, display_name: 'A', email: '' }, { id: 2, display_name: 'B', email: '' }] }), c()]);
  const got = evaluate(indexReqs(two), chosenOf(NO_FILTERS), ruleOf(NO_FILTERS, ME));
  assert.deepEqual(['1', '2', NONE].map((v) => countOf(got.counts, 'owner', v)), [1, 1, 1]);
});

test('the search covers every requirement, every word has to be found', () => {
  const find = (q: string) => evaluate(indexReqs(ROWS), chosenOf(NO_FILTERS), ruleOf({ ...NO_FILTERS, search: q }, ME)).matches.map((r) => r.code);
  assert.deepEqual(find('sara'), [ROWS[0].code], 'by owner');
  assert.deepEqual(find('b people control'), [ROWS[2].code, ROWS[4].code], 'by section and name; the out-of-scope one is not offered');
  assert.deepEqual(find('nothing like this'), []);
});

test('the rail offers the words the model knows and the sections, people and tiers the requirements have; a single option is not worth a group', () => {
  const o = railOptions(ROWS);
  assert.deepEqual(o.status.map((x) => x.label), ['Not implemented', 'In progress', 'Implemented', 'Verified'], 'not applicable only when a requirement has it');
  assert.deepEqual(o.section.map((x) => x.label), ['A Org', 'B People'], 'in the framework\'s order');
  assert.deepEqual(o.owner.map((x) => x.label), ['Khalid', 'Sara', 'Unassigned']);
  assert.deepEqual(o.priority.map((x) => x.value), ['P1', 'P2', NONE]);
  assert.deepEqual(o.category.map((x) => x.value), ['People', 'Other'], 'the four themes of ISO 27001 Annex A, by the domain\'s name, and the rest');
  assert.deepEqual(railOptions(ROWS.slice(0, 2)).category.map((x) => x.value), ['Other'], 'an ordinary framework has one category, which the rail does not list');
  const kept = orderedOptions(o.status, ['verified'], (v) => (v === 'implemented' ? 1 : 0));
  assert.deepEqual(kept.map((x) => x.value), ['implemented', 'verified'], 'a chosen option with a 0 stays, the others with a 0 go');
  assert.equal(facetWorthShowing(1, 0), false);
  assert.equal(facetWorthShowing(1, 1), true);
  assert.equal(facetWorthShowing(2, 0), true);
});

test('chips say what is on and take it off; the count of filters includes the search and the quick view', () => {
  const f: Filters = { ...NO_FILTERS, search: ' sara ', quick: 'mine', status: ['implemented'], owner: ['7'] };
  assert.equal(filterCount(f), 4);
  const chips = filterChips(f, railOptions(ROWS));
  assert.deepEqual(chips.map((x) => x.label), ['Search: sara', 'Assigned to me', 'Status: Implemented', 'Owner: Sara']);
  let g = f;
  chips.forEach((x) => { g = removeChip(g, x); });
  assert.deepEqual(g, NO_FILTERS);
});

test('the address round-trips: a link opens the same view, the journey page\'s own params are left alone, a bad value is the default', () => {
  const search = 'tab=controls&req=42&q=access&status=not_started,in_progress&evidence=none&section=0,2&owner=7,none&quick=mine&view=board&sort=status:asc';
  const a = readAddress(REQ_SCHEMA, search) as unknown as ReqAddress;
  const page = pageOf(a);
  assert.deepEqual(page.filters, { ...NO_FILTERS, search: 'access', status: ['not_started', 'in_progress'], evidence: ['none'], section: ['0', '2'], owner: ['7', 'none'], quick: 'mine' });
  assert.equal(page.view, 'board');
  assert.deepEqual(page.sort, { key: 'status', dir: 'asc' });
  // writing keeps tab and req exactly as they were
  const written = new URLSearchParams(writeAddress(REQ_SCHEMA, search, { ...a, status: [] }));
  assert.equal(written.get('tab'), 'controls');
  assert.equal(written.get('req'), '42');
  assert.equal(written.get('status'), null);
  const bad = pageOf(readAddress(REQ_SCHEMA, 'quick=everything&view=grid&sort=colour:up') as unknown as ReqAddress);
  assert.equal(bad.filters.quick, null);
  assert.equal(bad.view, 'list');
  assert.deepEqual(bad.sort, DEFAULT_SORT);
  assert.equal(writeAddress(REQ_SCHEMA, 'tab=controls', { ...(readAddress(REQ_SCHEMA, '') as unknown as ReqAddress) }), 'tab=controls', 'the defaults have the plain address');
  assert.deepEqual(Object.keys(filtersPatch(page.filters)).sort(), ['category', 'critical', 'evidence', 'owner', 'priority', 'q', 'quick', 'scope', 'section', 'status']);
});
