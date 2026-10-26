import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILT_IN_VIEWS, DEFAULT_SORT, DEFAULT_STATE, NO_DEPARTMENT, NO_FILTERS, NO_FRAMEWORK, NO_LOOKUPS, NO_OWNER,
  attestationBucket, classificationOptions, compareDocs, exportColumnsFor, filterCount, fold, frameworkDisplay, frameworkList, frameworkOptions,
  fromParams, haystack, health, kpis, matchesFilters, nextSort, nextStatuses, openFromParams, reviewState, reviewable, sameState, toCsv, toParams,
  versionNumber, viewMatching, withLibraryParams,
  type Filters, type LibDoc, type Lookups, type MatchContext,
} from './libraryModel.ts';

const NOW = new Date('2026-10-26T09:00:00Z');
let n = 0;
const doc = (over: Partial<LibDoc> = {}): LibDoc => ({
  id: ++n, title: `Doc ${n}`, document_code: null, description: null, doc_type: 'policy', status: 'published', classification: 'internal',
  owner_id: 1, owner_name: 'Olivia Owner', author_id: 2, author_name: 'Rana Author', department_id: 10, framework_ids: [], applicable_framework_ids: [],
  tags: [], next_review_date: null, version_in_force: '1.0', current_version: '1.0', created_at: '2026-01-01T00:00:00', updated_at: '2026-10-25T10:00:00',
  file_name: null, ...over,
});
const FW: Lookups['frameworks'] = {
  '1': { short: 'NCA', name: 'NCA Essential Cybersecurity Controls' },
  '2': { short: 'ISO 27001', name: 'ISO/IEC 27001:2022' },
  '3': { short: 'PDPL', name: 'Personal Data Protection Law' },
  '4': { short: 'SOC 2', name: 'SOC 2 Type II' },
};
const LK: Lookups = { departments: { '10': 'Information Security', '11': 'Operations' }, frameworks: FW, coverage: { 1: 100, 2: 40, 3: 0 }, me: 2 };
const ctx: MatchContext = { ...LK, now: NOW };
const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });

// ── review dates ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a review is owed on a document in force or approved, not on a draft, a withdrawn or an archived one', () => {
  assert.equal(reviewable({ status: 'published', version_in_force: '1.0' }), true);
  assert.equal(reviewable({ status: 'approved', version_in_force: null }), true);
  assert.equal(reviewable({ status: 'pending_review', version_in_force: '1.0' }), true);     // a newer version on its way over a published one
  assert.equal(reviewable({ status: 'pending_review', version_in_force: null }), false);
  assert.equal(reviewable({ status: 'draft', version_in_force: null }), false);
  assert.equal(reviewable({ status: 'archived', version_in_force: '1.0' }), false);
  assert.equal(reviewable({ status: 'expired', version_in_force: '1.0' }), false);
});

test('the state of a review date: overdue, due soon, up to date, not scheduled, or none owed', () => {
  const at = (date: string | null, over: Partial<LibDoc> = {}) => reviewState(doc({ next_review_date: date, ...over }), NOW);
  assert.deepEqual([at('2026-10-21T00:00:00').bucket, at('2026-10-21T00:00:00').label, at('2026-10-21T00:00:00').long], ['overdue', '5 d overdue', 'Overdue by 5 days']);
  assert.deepEqual([at('2026-10-25T00:00:00').label, at('2026-10-25T00:00:00').long], ['1 d overdue', 'Overdue by 1 day']);
  assert.equal(at('2026-10-26T00:00:00').label, 'Overdue today');                       // midnight today has passed: the overview says overdue too
  assert.equal(at('2026-10-26T00:00:00').bucket, 'overdue');
  assert.deepEqual([at('2026-10-27T00:00:00').bucket, at('2026-10-27T00:00:00').label, at('2026-10-27T00:00:00').long], ['due_soon', 'Tomorrow', 'Due tomorrow']);
  assert.equal(at('2026-10-26T18:00:00').label, 'Due today');                           // later today: not yet late
  assert.deepEqual([at('2026-11-05T00:00:00').label, at('2026-11-05T00:00:00').long], ['in 10 d', 'Due in 10 days']);
  assert.equal(at('2026-11-25T00:00:00').bucket, 'due_soon');                           // 30 days out is still "due soon"
  assert.equal(at('2026-11-26T00:00:00').bucket, 'ok');
  assert.deepEqual([at('2027-02-26T00:00:00').label, at('2027-02-26T00:00:00').long], ['in 4 mo', 'In 4 months']);
  assert.deepEqual([at('2026-06-01T00:00:00').label, at('2026-06-01T00:00:00').long], ['5 mo overdue', 'Overdue by 5 months']);
  assert.deepEqual([at('2028-04-26T00:00:00').label, at('2028-04-26T00:00:00').long], ['in 1.5 y', 'In 1.5 years']);
  assert.deepEqual([at(null).bucket, at(null).label, at(null).long], ['unscheduled', 'No date', 'Not scheduled']);
  assert.deepEqual([at('2026-10-01T00:00:00', { status: 'draft', version_in_force: null }).bucket, at('2026-10-01T00:00:00', { status: 'draft', version_in_force: null }).label], [null, '']);
  assert.deepEqual([at(null, { status: 'archived' }).bucket, at(null, { status: 'archived' }).label], [null, '']);
});

test('the health card counts the documents a review is owed on', () => {
  const docs = [
    doc({ next_review_date: '2026-10-01T00:00:00' }),                                    // overdue
    doc({ next_review_date: '2026-10-20T00:00:00' }),                                    // overdue
    doc({ next_review_date: '2026-11-10T00:00:00' }),                                    // due soon
    doc({ next_review_date: '2027-05-01T00:00:00' }),                                    // up to date
    doc({ next_review_date: null }),                                                      // no date
    doc({ status: 'draft', version_in_force: null, next_review_date: '2026-10-01T00:00:00' }),   // owes none
    doc({ status: 'archived', next_review_date: '2026-10-01T00:00:00' }),
  ];
  assert.deepEqual(health(docs, NOW), { reviewable: 5, upToDate: 1, dueSoon: 1, overdue: 2, unscheduled: 1 });
});

// ── the summary cards ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('the status cards: archived documents are counted apart, in review is both review stages, new ones are those of the last 30 days', () => {
  const docs = [
    doc({ status: 'draft', version_in_force: null, created_at: '2026-10-20T00:00:00' }),
    doc({ status: 'pending_review', version_in_force: null }),
    doc({ status: 'pending_approval', version_in_force: null }),
    doc({ status: 'approved' }),
    doc({ status: 'published', created_at: '2026-09-27T00:00:00' }),                      // 29 days ago: counts
    doc({ status: 'published', created_at: '2026-09-25T00:00:00' }),                      // 31 days ago: not
    doc({ status: 'archived', created_at: '2026-10-20T00:00:00' }),
    doc({ status: 'expired', version_in_force: null }),
  ];
  const k = kpis(docs, NOW);
  assert.deepEqual([k.all, k.draft, k.inReview, k.approved, k.published, k.archived, k.addedLast30], [7, 1, 2, 1, 2, 1, 2]);
});

// ── frameworks in a cell ──────────────────────────────────────────────────────────────────────────────────────────────────

test('a framework cell never grows: 0 shows nothing, up to the limit shows all, more show the first two and "+N"', () => {
  const show = (ids: number[], opts = {}) => { const d = frameworkDisplay(ids, FW, opts); return [d.chips.map((c) => c.label), d.hidden.length, d.total]; };
  assert.deepEqual(show([]), [[], 0, 0]);
  assert.deepEqual(show([1]), [['NCA'], 0, 1]);
  assert.deepEqual(show([1, 2]), [['NCA', 'ISO 27001'], 0, 2]);
  assert.deepEqual(show([1, 2, 3]), [['NCA', 'ISO 27001'], 1, 3]);
  assert.deepEqual(show([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), [['NCA', 'ISO 27001'], 10, 12]);
  assert.deepEqual(show([1, 2, 3], { max: 3 }), [['NCA', 'ISO 27001', 'PDPL'], 0, 3]);
  assert.deepEqual(show(null as unknown as number[]), [[], 0, 0]);
});

test('frameworks are de-duplicated, an unknown id is still counted, and the ones being filtered on come first', () => {
  assert.deepEqual(frameworkDisplay([1, 1, 2, 2], FW).total, 2);
  const unknown = frameworkDisplay([99], FW);
  assert.deepEqual([unknown.chips[0].label, unknown.chips[0].known], ['#99', false]);
  const d = frameworkDisplay([1, 2, 3, 4], FW, { prefer: ['4', '3'] });
  assert.deepEqual(d.chips.map((c) => c.label), ['PDPL', 'SOC 2']);                         // the document's own order within the preferred ones
  assert.deepEqual(d.hidden.map((c) => c.label), ['NCA', 'ISO 27001']);
});

test('the popover lists every framework A to Z and narrows by what is typed, on the short label or the full name', () => {
  assert.deepEqual(frameworkList([3, 1, 4, 2], FW).map((c) => c.label), ['ISO 27001', 'NCA', 'PDPL', 'SOC 2']);
  assert.deepEqual(frameworkList([1, 2, 3, 4], FW, 'protection').map((c) => c.label), ['PDPL']);
  assert.deepEqual(frameworkList([1, 2, 3, 4], FW, ' soc').map((c) => c.label), ['SOC 2']);
  assert.deepEqual(frameworkList([1, 2], FW, 'zzz'), []);
});

test('the Framework filter offers the frameworks some document is mapped to, after "No framework"', () => {
  const docs = [doc({ framework_ids: [3] }), doc({ applicable_framework_ids: [1, 3] }), doc()];
  assert.deepEqual(frameworkOptions(docs, FW).map((o) => o.value), [NO_FRAMEWORK, '1', '3']);
});

// ── filters ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ids = (docs: LibDoc[], filters: Filters) => docs.filter((d) => matchesFilters(d, filters, ctx)).map((d) => d.id);

test('within one filter any value keeps a document; across filters all must hold', () => {
  const a = doc({ doc_type: 'policy', status: 'published', owner_id: 1 });
  const b = doc({ doc_type: 'standard', status: 'draft', owner_id: 2, version_in_force: null });
  const c = doc({ doc_type: 'standard', status: 'published', owner_id: 2 });
  const all = [a, b, c];
  assert.deepEqual(ids(all, f({ types: ['policy', 'standard'] })), [a.id, b.id, c.id]);
  assert.deepEqual(ids(all, f({ types: ['standard'], statuses: ['published'] })), [c.id]);
  assert.deepEqual(ids(all, f({ statuses: ['draft', 'published'], owners: ['2'] })), [b.id, c.id]);
  assert.deepEqual(ids(all, NO_FILTERS), [a.id, b.id, c.id]);
});

test('no owner, no department and no framework are things to filter on', () => {
  const a = doc({ owner_id: null, owner_name: null, department_id: null });
  const b = doc({ framework_ids: [1] });
  assert.deepEqual(ids([a, b], f({ owners: [NO_OWNER] })), [a.id]);
  assert.deepEqual(ids([a, b], f({ departments: [NO_DEPARTMENT] })), [a.id]);
  assert.deepEqual(ids([a, b], f({ departments: ['10', NO_DEPARTMENT] })), [a.id, b.id]);
  assert.deepEqual(ids([a, b], f({ frameworks: [NO_FRAMEWORK] })), [a.id]);
  assert.deepEqual(ids([a, b], f({ frameworks: ['1'] })), [b.id]);
});

test('archived documents show only when asked for, and then on their own', () => {
  const live = doc();
  const gone = doc({ status: 'archived' });
  assert.deepEqual(ids([live, gone], NO_FILTERS), [live.id]);
  assert.deepEqual(ids([live, gone], f({ statuses: ['archived'] })), [gone.id]);
  assert.deepEqual(nextStatuses([], ['archived']), ['archived']);
  assert.deepEqual(nextStatuses(['draft'], ['draft', 'archived']), ['archived']);                  // archived just picked: it replaces the rest
  assert.deepEqual(nextStatuses(['archived'], ['archived', 'draft']), ['draft']);                  // another picked while archived: archived goes
  assert.deepEqual(nextStatuses(['draft'], ['draft', 'published']), ['draft', 'published']);
});

test('the Review filter uses the review state; a draft is in no bucket', () => {
  const overdue = doc({ next_review_date: '2026-10-01T00:00:00' });
  const fine = doc({ next_review_date: '2027-06-01T00:00:00' });
  const draft = doc({ status: 'draft', version_in_force: null, next_review_date: '2026-10-01T00:00:00' });
  assert.deepEqual(ids([overdue, fine, draft], f({ review: ['overdue'] })), [overdue.id]);
  assert.deepEqual(ids([overdue, fine, draft], f({ review: ['overdue', 'ok'] })), [overdue.id, fine.id]);
});

test('the Attestation filter and "owned or written by me"', () => {
  const [a, b, c, d] = [doc({ id: 1, owner_id: 9, author_id: 9 }), doc({ id: 2 }), doc({ id: 3 }), doc({ id: 4, owner_id: 2, author_id: 5 })];
  assert.deepEqual([1, 2, 3, 4, 77].map((id) => attestationBucket(LK.coverage[id])), ['complete', 'in_progress', 'not_started', 'none', 'none']);
  assert.deepEqual(ids([a, b, c, d], f({ attestation: ['complete', 'none'] })), [1, 4]);
  assert.deepEqual(ids([a, b, c, d], f({ mine: true })), [2, 3, 4]);                      // me = 2: author of b and c, owner of d
});

test('the search needs every word, and looks at the title, code, people, department, frameworks, tags and file', () => {
  const a = doc({ title: 'Data Governance Policy', document_code: 'POL-014', framework_ids: [3], tags: ['privacy'], file_name: 'dg-final.docx' });
  const b = doc({ title: 'Remote Work Policy', owner_name: 'Zoë Müller', department_id: 11 });
  const s = (q: string) => ids([a, b], f({ search: q }));
  assert.deepEqual(s('data policy'), [a.id]);
  assert.deepEqual(s('pol-014'), [a.id]);
  assert.deepEqual(s('personal data protection'), [a.id]);                                // a framework's full name
  assert.deepEqual(s('privacy'), [a.id]);
  assert.deepEqual(s('dg-final'), [a.id]);
  assert.deepEqual(s('zoe muller'), [b.id]);                                              // accents folded
  assert.deepEqual(s('operations'), [b.id]);                                              // the department's name
  assert.deepEqual(s('draft'), []);                                                       // no document is a draft
  assert.deepEqual(s('policy nothing'), []);
  assert.equal(fold('Zürich'), 'zurich');
  assert.ok(haystack(a, LK).includes('published'));                                       // the status word is searchable
});

test('how many things are being filtered on', () => {
  assert.equal(filterCount(NO_FILTERS), 0);
  assert.equal(filterCount(f({ search: '  ', types: [] })), 0);
  assert.equal(filterCount(f({ search: 'x', types: ['policy', 'standard'], mine: true })), 3);
});

test('the classifications offered are the ones the documents carry', () => {
  assert.deepEqual(classificationOptions([doc({ classification: 'Internal' }), doc({ classification: 'confidential' }), doc({ classification: '' })]).map((o) => o.value), ['confidential', 'internal']);
});

// ── sorting ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a header cycles through its first direction, the other, then the default order', () => {
  let s = DEFAULT_SORT;
  s = nextSort(s, 'title'); assert.deepEqual(s, { key: 'title', dir: 'asc' });
  s = nextSort(s, 'title'); assert.deepEqual(s, { key: 'title', dir: 'desc' });
  s = nextSort(s, 'title'); assert.deepEqual(s, DEFAULT_SORT);
  s = nextSort(s, 'frameworks'); assert.deepEqual(s, { key: 'frameworks', dir: 'desc' });     // most first
  s = nextSort(s, 'review'); assert.deepEqual(s, { key: 'review', dir: 'asc' });              // soonest first
});

test('rows with nothing in the sorted column go last in either direction; 2.10 follows 2.9', () => {
  const a = doc({ id: 1, next_review_date: '2026-11-01T00:00:00' });
  const b = doc({ id: 2, next_review_date: null });
  const c = doc({ id: 3, next_review_date: '2026-12-01T00:00:00' });
  const sorted = (dir: 'asc' | 'desc') => [a, b, c].sort(compareDocs({ key: 'review', dir })).map((d) => d.id);
  assert.deepEqual(sorted('asc'), [1, 3, 2]);
  assert.deepEqual(sorted('desc'), [3, 1, 2]);
  assert.equal(versionNumber('2.10')! > versionNumber('2.9')!, true);
  assert.equal(versionNumber('v1.0'), 1000);
  assert.equal(versionNumber(null), null);
  const owners = [doc({ id: 5, owner_name: 'Zed' }), doc({ id: 6, owner_name: null }), doc({ id: 7, owner_name: 'abe' })];
  assert.deepEqual(owners.sort(compareDocs({ key: 'owner', dir: 'asc' })).map((d) => d.id), [7, 5, 6]);
  const fw = [doc({ id: 8, framework_ids: [1] }), doc({ id: 9, framework_ids: [1, 2, 3] })];
  assert.deepEqual(fw.sort(compareDocs({ key: 'frameworks', dir: 'desc' }, LK)).map((d) => d.id), [9, 8]);
});

// ── the address ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the default state has a bare address and every other state survives a round trip through it', () => {
  assert.equal(toParams(DEFAULT_STATE).toString(), '');
  const state = {
    filters: f({ search: 'data policy', types: ['policy'], statuses: ['pending_review', 'pending_approval'], owners: ['3', NO_OWNER], departments: ['10'],
      frameworks: ['1', '2'], review: ['overdue'], attestation: ['none'], classifications: ['internal'], mine: true }),
    sort: { key: 'review' as const, dir: 'asc' as const },
  };
  assert.deepEqual(fromParams(new URLSearchParams(toParams(state).toString())), state);
});

test('an address with things the page does not know is read without an error', () => {
  const s = fromParams(new URLSearchParams('review=overdue,soon,&att=bogus&sort=nope:up&type=policy,,policy&status=draft,archived&zzz=1'));
  assert.deepEqual(s.filters.review, ['overdue']);
  assert.deepEqual(s.filters.attestation, []);
  assert.deepEqual(s.filters.types, ['policy']);
  assert.deepEqual(s.filters.statuses, ['archived']);
  assert.deepEqual(s.sort, DEFAULT_SORT);
});

test('the built-in views are found when their filters are on, and only then', () => {
  assert.equal(viewMatching(BUILT_IN_VIEWS, DEFAULT_STATE)?.id, 'all');
  assert.equal(viewMatching(BUILT_IN_VIEWS, { filters: f({ mine: true }), sort: DEFAULT_SORT })?.id, 'mine');
  assert.equal(viewMatching(BUILT_IN_VIEWS, { filters: f({ mine: true, types: ['policy'] }), sort: DEFAULT_SORT }), null);
  assert.equal(sameState(DEFAULT_STATE, { filters: NO_FILTERS, sort: { key: 'title', dir: 'asc' } }), false);
});

// ── the export ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the CSV names the columns, quotes what needs it, lists every framework and starts with the mark Excel reads UTF-8 by', () => {
  const d = doc({ title: 'Data, "Governance" Policy', owner_name: 'Zoë Müller', framework_ids: [2, 1], next_review_date: '2027-01-05T00:00:00', current_version: '2.1', department_id: 10 });
  const csv = toCsv([d], ['title', 'owner', 'department', 'frameworks', 'review', 'version', 'status'], { ...NO_LOOKUPS, ...LK });
  const [head, row] = csv.slice(1).split('\r\n');
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(head, 'Title,Owner,Department,Frameworks,Next review,Version,Status');
  assert.equal(row, '"Data, ""Governance"" Policy",Zoë Müller,Information Security,ISO/IEC 27001:2022; NCA Essential Cybersecurity Controls,2027-01-05,2.1,Published');
});

test('the address keeps the links others put in it, and says which document is open', () => {
  const state = { filters: f({ types: ['policy'] }), sort: DEFAULT_SORT };
  const out = withLibraryParams(new URLSearchParams('aiDraftTitle=Foo&q=old&open=3&status=draft'), state, 12);
  assert.equal(out.get('aiDraftTitle'), 'Foo');                      // not ours: kept
  assert.equal(out.get('q'), null);                                  // ours, no longer in the state: gone
  assert.equal(out.get('status'), null);
  assert.equal(out.get('type'), 'policy');
  assert.equal(out.get('open'), '12');
  assert.equal(withLibraryParams(new URLSearchParams('open=3'), DEFAULT_STATE, null).toString(), '');
  assert.equal(openFromParams(new URLSearchParams('open=12')), 12);
  assert.equal(openFromParams(new URLSearchParams('id=7')), 7);                      // the review calendar's link
  assert.equal(withLibraryParams(new URLSearchParams('id=7'), DEFAULT_STATE, 7).toString(), 'open=7');   // rewritten as open
  assert.equal(openFromParams(new URLSearchParams('open=abc')), null);
  assert.equal(openFromParams(new URLSearchParams('open=-4')), null);
  assert.equal(openFromParams(new URLSearchParams('')), null);
});

test('the CSV follows the table: a column switched off is left out, the department goes with the owner', () => {
  assert.deepEqual(exportColumnsFor([]), ['title', 'code', 'type', 'status', 'owner', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated']);
  assert.deepEqual(exportColumnsFor(['department']), ['title', 'code', 'type', 'status', 'owner', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated']);
  assert.deepEqual(exportColumnsFor(['owner', 'department', 'type', 'updated']), ['title', 'code', 'status', 'frameworks', 'attestation', 'review', 'version']);
  assert.deepEqual(exportColumnsFor(['owner']), ['title', 'code', 'type', 'status', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated']);
});
