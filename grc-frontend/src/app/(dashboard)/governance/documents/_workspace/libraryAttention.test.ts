// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryAttention.test.ts"
// The Attention filter (`?attn=stuck|on_hold|late_approvals|late_acknowledgements`): what the Documents Overview opens for the figures no other filter can find. The
// server names the documents (GET /governance/document-overview/ids); the library keeps those. What it is in the address, how it counts as a filter, how it is matched
// while the server has or has not answered, its chip (with the server's count) and how the chip comes off - and that nothing that used to work has changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { filterChips, removeChip, type FilterOptions } from './libraryFiltersLogic.ts';
import {
  ATTENTION_KINDS, ATTENTION_LABEL, BUILT_IN_VIEWS, DEFAULT_SORT, NO_FILTERS, PARAM_KEYS, attentionDepartment, filterCount, fromParams, isFiltering, matchesFilters,
  sameState, toParams, viewMatching, withLibraryParams,
  type Filters, type LibDoc, type MatchContext,
} from './libraryModel.ts';

const q = (s: string) => new URLSearchParams(s);
const NOW = new Date('2026-11-04T12:00:00Z');
const doc = (id: number, over: Partial<LibDoc> = {}): LibDoc => ({
  id, title: `Doc ${id}`, document_code: null, doc_type: 'policy', status: 'pending_review', owner_id: 1, owner_name: 'Olivia', department_id: 11,
  next_review_date: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-11-01T00:00:00', ...over,
});
const ctx = (attention?: ReadonlySet<number> | null): MatchContext => ({ departments: {}, frameworks: {}, coverage: {}, me: 1, now: NOW, attention });
const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });
const OPTIONS: FilterOptions = { types: [], statuses: [], owners: [], departments: [{ value: '11', label: 'Support' }], frameworks: [], classifications: [] };

test('the four kinds are the Overview\'s, in the words of its Issues', () => {
  assert.deepEqual([...ATTENTION_KINDS], ['stuck', 'on_hold', 'late_approvals', 'late_acknowledgements']);
  assert.deepEqual(ATTENTION_KINDS.map((k) => ATTENTION_LABEL[k]), ['Stuck in a stage', 'On hold', 'Late approvals', 'Late acknowledgements']);
  assert.ok(PARAM_KEYS.includes('attn'), 'the library owns the key: its own address writer keeps it and takes it off');
});

test('`?attn=` turns the filter on, any other kind is ignored, and the address is written back as the same one parameter', () => {
  for (const kind of ATTENTION_KINDS) {
    assert.equal(fromParams(q(`attn=${kind}`)).filters.attention, kind);
    assert.equal(toParams(fromParams(q(`attn=${kind}`))).toString(), `attn=${kind}`);
  }
  for (const off of ['', 'attn=', 'attn=nonsense', 'attn=STUCK', 'attn=stuck,on_hold', 'attn=constructor', 'attn=__proto__']) assert.equal(fromParams(q(off)).filters.attention, null, off);
  assert.equal(fromParams(q('dept=11&attn=late_approvals&sort=title:asc')).filters.departments[0], '11');
  assert.equal(toParams({ filters: f({ attention: 'stuck', departments: ['11'], types: ['policy'] }), sort: { key: 'review', dir: 'asc' } }).toString(), 'type=policy&dept=11&attn=stuck&sort=review%3Aasc');
  // the address the Overview writes is read back as the view it meant: a department and a kind
  const link = fromParams(new URLSearchParams('dept=11&status=pending_review&attn=stuck'));
  assert.deepEqual([link.filters.departments, link.filters.statuses, link.filters.attention], [['11'], ['pending_review'], 'stuck']);
});

test('it is a filter like the others: it counts, it makes the library "filtering", and Clear takes it off with the rest', () => {
  assert.equal(NO_FILTERS.attention, null);
  assert.equal(filterCount(f({ attention: 'on_hold' })), 1);
  assert.equal(filterCount(f({ attention: 'on_hold', mine: true, search: 'x' })), 3);
  assert.equal(isFiltering(f({ attention: 'on_hold' })), true);
  assert.equal(isFiltering(NO_FILTERS), false);
  assert.equal(filterCount(NO_FILTERS), 0);
  assert.equal(sameState({ filters: f({ attention: 'stuck' }), sort: DEFAULT_SORT }, { filters: NO_FILTERS, sort: DEFAULT_SORT }), false);
  assert.equal(viewMatching(BUILT_IN_VIEWS, { filters: f({ attention: 'stuck' }), sort: DEFAULT_SORT }), null, 'no built-in view is for it');
  assert.equal(filterCount({ ...NO_FILTERS }), 0, 'the Clear button sets NO_FILTERS: that is no attention');
});

test('the library keeps the documents the server named, and nothing while it has not answered or named none', () => {
  const docs = [doc(1), doc(2), doc(3)];
  const kept = (attention: ReadonlySet<number> | null | undefined, filters = f({ attention: 'stuck' })) => docs.filter((d) => matchesFilters(d, filters, ctx(attention))).map((d) => d.id);
  assert.deepEqual(kept(new Set([2, 3])), [2, 3]);
  assert.deepEqual(kept(new Set([2, 99])), [2], 'an id the library has not loaded is no document of it');
  assert.deepEqual(kept(new Set()), []);
  assert.deepEqual(kept(null), [], 'not answered yet: the table waits (the page shows it loading), it never shows everything under that chip');
  assert.deepEqual(kept(undefined), []);
  // without the filter the server's answer is not read at all
  assert.deepEqual(kept(new Set([2]), NO_FILTERS), [1, 2, 3]);
  assert.deepEqual(kept(null, NO_FILTERS), [1, 2, 3]);
  // together with the other filters: all of them have to hold
  assert.deepEqual(kept(new Set([1, 2, 3]), f({ attention: 'stuck', types: ['standard'] })), []);
  assert.deepEqual(kept(new Set([1, 2, 3]), f({ attention: 'stuck', statuses: ['draft'] })), []);
  assert.deepEqual(kept(new Set([1, 2]), f({ attention: 'stuck', statuses: ['pending_review'] })), [1, 2]);
});

test('the server is asked for the one department the library is filtered to, and for its own default otherwise', () => {
  assert.equal(attentionDepartment(f({ departments: ['11'] })), '11');
  assert.equal(attentionDepartment(f({ departments: ['none'] })), 'none');
  assert.equal(attentionDepartment(NO_FILTERS), '');
  assert.equal(attentionDepartment(f({ departments: ['11', '12'] })), '', 'two departments: the whole scope, the library narrows it');
});

test('the chip says the kind and, once the server has answered, how many; it comes off by itself and with Clear', () => {
  const on = f({ attention: 'late_approvals', departments: ['11'] });
  assert.deepEqual(filterChips(on, OPTIONS).map((c) => c.label), ['Department: Support', 'Late approvals']);
  assert.deepEqual(filterChips(on, OPTIONS, { attentionTotal: 4 }).map((c) => c.label), ['Department: Support', 'Late approvals · 4']);
  assert.deepEqual(filterChips(on, OPTIONS, { attentionTotal: 0 }).map((c) => c.label), ['Department: Support', 'Late approvals · 0'], 'none is a count too');
  assert.deepEqual(filterChips(on, OPTIONS, { attentionTotal: null }).map((c) => c.label), ['Department: Support', 'Late approvals']);
  assert.deepEqual(filterChips(NO_FILTERS, OPTIONS), [], 'no filter, no chip');
  const chip = filterChips(on, OPTIONS).find((c) => c.facet === 'attention')!;
  assert.deepEqual(chip, { key: 'attention', facet: 'attention', value: 'late_approvals', label: 'Late approvals' });
  assert.deepEqual(removeChip(on, chip), f({ departments: ['11'] }));
  assert.equal(removeChip(on, chip).attention, null);
  for (const kind of ATTENTION_KINDS) assert.equal(filterChips(f({ attention: kind }), OPTIONS)[0].label, ATTENTION_LABEL[kind]);
});

test('the library\'s own address writer keeps `attn` while the filter is on, drops it when it is off, and leaves other keys alone', () => {
  const on = withLibraryParams(q('aiDraftTitle=x&q=old&attn=stuck'), { filters: f({ attention: 'on_hold', search: 'new' }), sort: DEFAULT_SORT }, null);
  assert.equal(on.toString(), 'aiDraftTitle=x&q=new&attn=on_hold');
  const off = withLibraryParams(q('aiDraftTitle=x&attn=stuck&dept=11'), { filters: f({ departments: ['11'] }), sort: DEFAULT_SORT }, 9);
  assert.equal(off.toString(), 'aiDraftTitle=x&dept=11&open=9');
});

test('the data layer asks the server for the ids of one kind, with the department only when there is one', () => {
  const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  assert.ok(api.includes("apiClient.get('/governance/document-overview/ids', { params: { kind, ...(department ? { department_id: department } : {}) } })"));
  const workspace = readFileSync(new URL('./DocumentsWorkspace.tsx', import.meta.url), 'utf8');
  assert.ok(workspace.includes('fetchAttention(attnKind as string, attentionDepartment(filters))') && workspace.includes('enabled: attnKind != null'));
  assert.ok(workspace.includes('attention: attnIds') && workspace.includes('|| attnWaiting') && workspace.includes('attentionTotal={attn.data?.total ?? null}'));
  // a failed read is said (with Retry where it can help), never a table of everything under the chip
  assert.ok(workspace.includes('attnFailed && attnKind ?') && workspace.includes('Couldn\'t load “${ATTENTION_LABEL[attnKind]}”'));
});

test('the ids the server answers are the ones the Overview counts (the backend that writes them is read when it is beside the frontend)', () => {
  const url = new URL('../../../../../../../backend/grc/modules/governance/documents_overview.py', import.meta.url);
  if (!existsSync(url)) return;
  const source = readFileSync(url, 'utf8');
  const kinds = /KINDS = \(([^)]*)\)/.exec(source)?.[1].match(/"([a-z_]+)"/g)?.map((s) => s.replace(/"/g, '')) ?? [];
  assert.deepEqual([...kinds].sort(), [...ATTENTION_KINDS].sort(), 'the server answers other kinds than the library filters on');
});
