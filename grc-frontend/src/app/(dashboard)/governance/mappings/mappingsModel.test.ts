// node --test "src/app/(dashboard)/governance/mappings/mappingsModel.test.ts"
// The Mappings page's rules, apart from React. Two kinds of test: (1) the page's own rules were MOVED out of a 1,452-line file, not changed, so a frozen
// copy of that code (OLD, below, as it stood at wt/ux1 c880d6e5) is compared with the moved functions on generated data (a seeded generator, so a failure
// reproduces); (2) what is new: the documents' true total, the "mapped" figure that is only a figure when it was counted, the address, the toolbar rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CoverageFramework, DocumentItem, GapRecommendedFinding, InternalControl, RecommendedControl } from './_types.ts';
import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import {
  DOC_ADDRESS, DOCUMENT_TYPES, LINK_LIST_LIMIT, coverageTone, filterControls, frameworkGroups, gapFindingsToRecs, groupTotals, keyOf, linkedControlIds, mappedFigure, matchPct,
  optionAfter, readDocuments, relinkOf, typeLabel, uniqueGapRecs, upperCode,
} from './mappingsModel.ts';

// ── OLD: the page's code before it was split (frozen; do not "tidy") ─────────────────────────────────────────────────────────────────────────────

const OLD_GAP_KIND_RANK: Record<string, number> = { internal: 4, normalized: 3, framework: 2, parsed: 1 };
const OLD_GAP_REASON_RANK: Record<string, number> = { framework_link: 4, normalized_link: 3, framework_clause: 2, fuzzy_match: 1 };
const OLD_GAP_COVERAGE: Record<string, string> = { partially_compliant: 'partial', not_addressed: 'gap' };

function oldPickBestGapControl(controls: GapRecommendedFinding['controls']): GapRecommendedFinding['controls'][number] | null {
  if (!controls.length) return null;
  return [...controls].sort((a, b) => {
    const kindDelta = (OLD_GAP_KIND_RANK[b.kind] ?? 0) - (OLD_GAP_KIND_RANK[a.kind] ?? 0);
    if (kindDelta !== 0) return kindDelta;
    return (OLD_GAP_REASON_RANK[b.match_reason] ?? 0) - (OLD_GAP_REASON_RANK[a.match_reason] ?? 0);
  })[0];
}
function oldGapRationale(f: GapRecommendedFinding, c: GapRecommendedFinding['controls'][number]): string {
  const reasoning = (f.ai_reasoning || '').trim();
  if (reasoning) return reasoning;
  for (const raw of [f.gap_description, f.missing_requirement, f.remediation_recommendation, f.clause_requirement_text]) {
    const t = (raw || '').trim();
    if (t) return t;
  }
  const ctrlDesc = (c.description || '').trim();
  if (ctrlDesc) return ctrlDesc;
  const clause = (f.clause_reference || c.code || '').trim();
  return clause ? `Recommended from gap analysis for clause ${clause}` : 'Recommended from gap analysis';
}
function oldGapFindingsToRecs(findings: GapRecommendedFinding[]): RecommendedControl[] {
  const out: RecommendedControl[] = [];
  const seenClause = new Set<string>();
  const seenControl = new Set<string>();
  for (const f of findings) {
    const c = oldPickBestGapControl(f.controls);
    if (!c) continue;
    const fw = (c.framework_name || f.framework_name || '').trim().toLowerCase();
    const clause = (f.clause_reference || c.code || '').trim().toLowerCase();
    const clauseKey = `${fw}::${clause}`;
    if (clause && seenClause.has(clauseKey)) continue;
    if (clause) seenClause.add(clauseKey);
    const ctrlKey = `${c.kind}::${c.id}`;
    if (seenControl.has(ctrlKey)) continue;
    seenControl.add(ctrlKey);
    const description = (c.description || f.clause_requirement_text || null);
    out.push({
      control_kind: c.kind, control_code: c.code, control_title: c.title || f.clause_title, framework_name: c.framework_name || f.framework_name, domain: c.domain || null,
      coverage_type: OLD_GAP_COVERAGE[f.compliance_status] || null, link_source: 'gap', max_confidence: typeof f.confidence_score === 'number' ? f.confidence_score : null,
      statement_count: 0, control_ref_id: c.id, clause_reference: f.clause_reference || c.code, description, is_linked: c.already_linked, statements: [],
      uploaded_framework_id: f.uploaded_framework_id, rationale: oldGapRationale(f, c), finding_id: f.finding_id, source: 'gap', compliance_status: f.compliance_status,
      gap_description: f.gap_description || null, missing_requirement: f.missing_requirement || null, remediation: f.remediation_recommendation || null, risk_severity: f.risk_severity || null,
    });
  }
  return out;
}
/** the `mappingKeys` + `uniqueGapRecs` memos of RecommendedControlsSection */
function oldUniqueGapRecs(gapRecs: RecommendedControl[], recs: RecommendedControl[]): RecommendedControl[] {
  const mappingKeys = (() => {
    const byControl = new Set<string>();
    const byClause = new Set<string>();
    recs.forEach((r) => {
      byControl.add(`${r.control_kind}::${r.control_code ?? ''}`.toLowerCase());
      if (r.control_ref_id != null) byControl.add(`${r.control_kind}::id:${r.control_ref_id}`);
      const code = (r.control_code || r.clause_reference || '').trim().toLowerCase();
      if (code) {
        byControl.add(`code::${code}`);
        const fw = (r.framework_name || '').trim().toLowerCase();
        byClause.add(`${fw}::${code}`);
      }
    });
    return { byControl, byClause };
  })();
  const filtered = gapRecs.filter((r) => {
    const byCode = `${r.control_kind}::${r.control_code ?? ''}`.toLowerCase();
    const byId = r.control_ref_id != null ? `${r.control_kind}::id:${r.control_ref_id}` : '';
    const codeAlone = (r.control_code || r.clause_reference || '').trim().toLowerCase();
    const clauseKey = `${(r.framework_name || '').trim().toLowerCase()}::${codeAlone}`;
    if (mappingKeys.byControl.has(byCode)) return false;
    if (byId && mappingKeys.byControl.has(byId)) return false;
    if (codeAlone && mappingKeys.byControl.has(`code::${codeAlone}`)) return false;
    if (codeAlone && mappingKeys.byClause.has(clauseKey)) return false;
    return true;
  });
  return filtered.sort((a, b) => Number(a.is_linked) - Number(b.is_linked));
}
/** the `groups` memo */
function oldGroups(recs: RecommendedControl[], uniqueGapRecsList: RecommendedControl[], coverage: CoverageFramework[], search: string) {
  const OTHER = 'Other';
  const fwNameOf = (r: RecommendedControl) => r.framework_name || OTHER;
  const q = search.trim().toLowerCase();
  type FwGroup = { name: string; cov: CoverageFramework | null; mapped: RecommendedControl[]; recommended: RecommendedControl[] };
  const byName = new Map<string, FwGroup>();
  const ensure = (name: string) => {
    let g = byName.get(name);
    if (!g) { g = { name, cov: null, mapped: [], recommended: [] }; byName.set(name, g); }
    return g;
  };
  coverage.forEach((c) => { ensure(c.framework_name).cov = c; });
  recs.forEach((r) => { ensure(fwNameOf(r)).mapped.push(r); });
  uniqueGapRecsList.forEach((r) => { ensure(fwNameOf(r)).recommended.push(r); });
  let list = Array.from(byName.values());
  if (q) {
    list = list.map((g) => {
      const nameHit = g.name.toLowerCase().includes(q);
      if (nameHit) return g;
      const matchRec = (r: RecommendedControl) => `${r.clause_reference ?? ''} ${r.control_code ?? ''} ${r.control_title ?? ''}`.toLowerCase().includes(q);
      const mapped = g.mapped.filter(matchRec);
      const recommended = g.recommended.filter(matchRec);
      const cov = g.cov
        ? { ...g.cov, missing_controls: g.cov.missing_controls.filter((c) => `${c.reference ?? ''} ${c.title ?? ''}`.toLowerCase().includes(q)) }
        : null;
      return { ...g, mapped, recommended, cov };
    }).filter((g) => g.name.toLowerCase().includes(q) || g.mapped.length > 0 || g.recommended.length > 0 || (g.cov?.missing_controls.length ?? 0) > 0);
  }
  list.sort((a, b) => {
    const ap = a.cov?.coverage_pct ?? 999;
    const bp = b.cov?.coverage_pct ?? 999;
    if (ap !== bp) return ap - bp;
    const aCount = a.mapped.length + a.recommended.length;
    const bCount = b.mapped.length + b.recommended.length;
    if (bCount !== aCount) return bCount - aCount;
    return a.name.localeCompare(b.name);
  });
  return list;
}
/** the `filteredControls` memo */
function oldFilteredControls(allControlsData: InternalControl[] | undefined, controlSearchTerm: string, linkedControlIdsSet: Set<number>) {
  if (!allControlsData) return [];
  return allControlsData.filter((control) => {
    const matchesSearch = !controlSearchTerm
      || control.control_id.toLowerCase().includes(controlSearchTerm.toLowerCase())
      || control.name.toLowerCase().includes(controlSearchTerm.toLowerCase())
      || control.description?.toLowerCase().includes(controlSearchTerm.toLowerCase());
    const notAlreadyLinkedToSelectedDocument = !linkedControlIdsSet.has(control.id);
    return matchesSearch && notAlreadyLinkedToSelectedDocument;
  }).sort((left, right) => {
    const leftMapped = left.source_document_id ? 1 : 0;
    const rightMapped = right.source_document_id ? 1 : 0;
    if (leftMapped !== rightMapped) return leftMapped - rightMapped;
    return left.control_id.localeCompare(right.control_id);
  });
}
/** the `coverageSummary` memo */
function oldCoverageSummary(documents: DocumentItem[], allControlsData: InternalControl[] | undefined) {
  const totalDocs = documents.length;
  const mappedDocIds = new Set<number>();
  (allControlsData || []).forEach((control) => { if (control.source_document_id != null) mappedDocIds.add(control.source_document_id); });
  const docsWithMappings = documents.reduce((count, doc) => (mappedDocIds.has(doc.id) ? count + 1 : count), 0);
  const coveragePct = totalDocs > 0 ? Math.round((docsWithMappings / totalDocs) * 100) : 0;
  return { totalDocs, docsWithMappings, coveragePct };
}

// ── generated data ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function prng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

const KINDS = ['internal', 'normalized', 'framework', 'parsed', 'weird'];
const REASONS = ['framework_link', 'normalized_link', 'framework_clause', 'fuzzy_match', 'other'];
const FWS = ['ISO/IEC 27001:2022', 'SAMA Cyber Security Framework', 'NIST CSF 2.0', 'UAE IA', 'Other', null, 'iso/iec 27001:2022'];
const CODES = ['A.5.1', 'a.5.1', 'A.6.2', 'ID.AM-1', '1.3', null, '', 'GOV-02', 'gov-02'];
const TITLES = ['Policies for information security', 'Access control', 'Backup', 'Asset inventory', null, 'Segregation of duties'];

function genRecs(r: () => number, n: number): RecommendedControl[] {
  return Array.from({ length: n }, (): RecommendedControl => ({
    control_kind: pick(r, ['normalized', 'framework', 'parsed', 'internal']), control_code: pick(r, CODES), control_title: pick(r, TITLES), framework_name: pick(r, FWS), domain: null, coverage_type: null,
    link_source: 'ai', max_confidence: r() < 0.2 ? null : r(), statement_count: Math.floor(r() * 5), control_ref_id: r() < 0.3 ? null : Math.floor(r() * 6), clause_reference: pick(r, CODES),
    description: null, is_linked: r() < 0.4, statements: [], source: r() < 0.3 ? 'gap' : 'mapping',
  }));
}
function genFindings(r: () => number, n: number): GapRecommendedFinding[] {
  return Array.from({ length: n }, (_, i): GapRecommendedFinding => ({
    finding_id: i + 1, clause_reference: pick(r, CODES), clause_title: pick(r, TITLES), clause_requirement_text: pick(r, [null, '', 'Access shall be restricted.']),
    compliance_status: pick(r, ['partially_compliant', 'not_addressed', 'compliant']), gap_description: pick(r, [null, ' ', 'A gap.']), missing_requirement: pick(r, [null, 'A step.']),
    remediation_recommendation: pick(r, [null, 'Add it.']), ai_reasoning: pick(r, [null, '', 'Because.']), confidence_score: r() < 0.3 ? null : r(), risk_severity: pick(r, [null, 'high']),
    framework_name: pick(r, FWS), uploaded_framework_id: r() < 0.3 ? null : Math.floor(r() * 4),
    controls: Array.from({ length: Math.floor(r() * 4) }, (_, k) => ({
      kind: pick(r, KINDS), id: Math.floor(r() * 8) + k, code: pick(r, CODES), title: pick(r, TITLES), match_reason: pick(r, REASONS), already_linked: r() < 0.3,
      framework_name: pick(r, FWS), description: pick(r, [null, '', 'A control.']), domain: pick(r, [null, 'Identity']),
    })),
  }));
}
function genCoverage(r: () => number): CoverageFramework[] {
  const names = Array.from(new Set(Array.from({ length: 1 + Math.floor(r() * 4) }, () => pick(r, FWS.filter((f): f is string => !!f)))));
  return names.map((name, i): CoverageFramework => {
    const total = 10 + Math.floor(r() * 90);
    const mapped = Math.floor(r() * total);
    return {
      framework_id: i + 1, framework_name: name, total_controls: total, mapped_count: mapped, missing_count: total - mapped, coverage_pct: r() < 0.25 ? 12 : Math.round((mapped / total) * 100),
      missing_controls: Array.from({ length: Math.floor(r() * 6) }, (_, k) => ({ id: k, reference: pick(r, CODES) ?? '', title: pick(r, TITLES) ?? '', domain: null })),
    };
  });
}

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);

test('the gap-analysis recommendations become the same rows as before, on 60 generated documents', () => {
  for (const seed of SEEDS) {
    const r = prng(seed);
    const findings = genFindings(r, Math.floor(r() * 12));
    assert.deepStrictEqual(gapFindingsToRecs(findings), oldGapFindingsToRecs(findings), `seed ${seed}`);
  }
});

test('the recommendations still to link (deduped against what is mapped, unlinked first) are the same, on 60 generated documents', () => {
  for (const seed of SEEDS) {
    const r = prng(seed);
    const recs = genRecs(r, Math.floor(r() * 10));
    const gap = gapFindingsToRecs(genFindings(r, Math.floor(r() * 12)));
    assert.deepStrictEqual(uniqueGapRecs(gap, recs), oldUniqueGapRecs(gap, recs), `seed ${seed}`);
  }
});

test('the framework groups are the same (coverage worst first, then most rows, then name; a search keeps the matching ones), on 60 generated documents x 5 searches', () => {
  for (const seed of SEEDS) {
    const r = prng(seed);
    const recs = genRecs(r, Math.floor(r() * 12));
    const gap = gapFindingsToRecs(genFindings(r, Math.floor(r() * 12)));
    const unique = oldUniqueGapRecs(gap, recs);
    const coverage = r() < 0.5 ? genCoverage(r) : [];
    for (const q of ['', '  ', 'a.5', 'access', 'sama']) assert.deepStrictEqual(frameworkGroups(recs, unique, coverage, q), oldGroups(recs, unique, coverage, q), `seed ${seed} q=${q}`);
  }
});

test('the link panel offers the same controls in the same order (not yet linked to this document, unmapped first, then by id), on 60 generated tenants x 4 searches', () => {
  for (const seed of SEEDS) {
    const r = prng(seed);
    const controls: InternalControl[] = Array.from({ length: Math.floor(r() * 40) }, (_, i) => ({
      id: i + 1, control_id: `IC-${String(Math.floor(r() * 90) + 10).padStart(4, '0')}`, name: pick(r, TITLES) ?? 'x', description: pick(r, [undefined, 'Backups are tested', '']),
      source_document_id: r() < 0.4 ? Math.floor(r() * 4) + 1 : null,
    }));
    const links = controls.filter((c) => c.source_document_id === 2).map((c) => ({ internal_control_id: c.id, normalized_control_id: c.id }));
    const linked = linkedControlIds(links);
    for (const q of ['', 'ic-00', 'backup', 'zzz']) assert.deepStrictEqual(filterControls(controls, q, linked), oldFilteredControls(controls, q, linked), `seed ${seed} q=${q}`);
  }
  assert.deepStrictEqual(filterControls(undefined, '', new Set()), [], 'no controls loaded: nothing to offer');
});

test('the mapped-documents figure is the same arithmetic as before whenever both lists answered, on 60 generated tenants', () => {
  for (const seed of SEEDS) {
    const r = prng(seed);
    const docs: DocumentItem[] = Array.from({ length: Math.floor(r() * 120) }, (_, i) => ({ id: i + 1, document_code: null, title: `D${i}`, doc_type: 'policy', status: 'draft' }));
    const controls: InternalControl[] = Array.from({ length: Math.floor(r() * 60) }, (_, i) => ({ id: i + 1, control_id: `IC-${i}`, name: 'c', source_document_id: r() < 0.5 ? null : Math.floor(r() * 150) + 1 }));
    const old = oldCoverageSummary(docs, controls);
    const now = mappedFigure({ documents: { status: 'ready', items: docs }, controls: { status: 'ready', items: controls } });
    assert.equal(now.kind, 'value');
    if (now.kind !== 'value') continue;
    assert.equal(now.mapped, old.docsWithMappings, `seed ${seed}`);
    assert.equal(now.of, old.totalDocs);
    assert.equal(now.pct, old.totalDocs > 0 ? old.coveragePct : null, 'the old 0% for no documents is "no share" now: there is nothing to take a share of');
  }
});

// ── what is new ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const doc = (id: number): DocumentItem => ({ id, document_code: null, title: `D${id}`, doc_type: 'policy', status: 'draft' });
const control = (id: number, source: number | null): InternalControl => ({ id, control_id: `IC-${id}`, name: 'c', source_document_id: source });

test('the documents the server sends and how many it has: its total is the true count, never less than what came, and the list is cut when it has more', () => {
  const a = readDocuments({ items: [doc(1), doc(2)], total: 174, skip: 0, limit: 100 });
  assert.equal(a.items.length, 2);
  assert.equal(a.total, 174);
  assert.equal(a.cut, true);
  const b = readDocuments({ items: [doc(1), doc(2)], total: 2 });
  assert.deepEqual([b.total, b.cut], [2, false]);
  // a total that is missing, not a number or smaller than what came is not believed
  for (const bad of [undefined, null, 'many', Number.NaN, 1]) {
    const c = readDocuments({ items: [doc(1), doc(2)], total: bad });
    assert.deepEqual([c.total, c.cut], [2, false], String(bad));
  }
  // the older bare array, nothing, and junk
  assert.deepEqual(readDocuments([doc(1)]), { items: [doc(1)], total: 1, cut: false });
  for (const nothing of [undefined, null, {}, { items: 'x' }, 7]) assert.deepEqual(readDocuments(nothing), { items: [], total: 0, cut: false }, String(nothing));
  assert.equal(readDocuments({ items: [], total: 3 }).cut, true, 'an empty page of a list that has three is cut, not empty');
});

test('"mapped" is only a figure when it was counted: loading, failed and not-allowed are said, never 0', () => {
  const docs = [doc(1), doc(2), doc(3), doc(4)];
  const ready = { status: 'ready' as const, items: docs };
  const controls = { status: 'ready' as const, items: [control(1, 1), control(2, 1), control(3, 3), control(4, null)] };
  assert.deepEqual(mappedFigure({ documents: ready, controls }), { kind: 'value', mapped: 2, of: 4, pct: 50 });
  assert.deepEqual(mappedFigure({ documents: ready, controls: { status: 'ready', items: [] } }), { kind: 'value', mapped: 0, of: 4, pct: 0 }, 'a true zero is a figure');
  assert.deepEqual(mappedFigure({ documents: { status: 'ready', items: [] }, controls }), { kind: 'value', mapped: 0, of: 0, pct: null }, 'no documents: no share');
  assert.deepEqual(mappedFigure({ documents: { status: 'loading', items: [] }, controls }), { kind: 'loading' });
  assert.deepEqual(mappedFigure({ documents: { status: 'error', items: [] }, controls }), { kind: 'error', source: 'documents' });
  assert.deepEqual(mappedFigure({ documents: ready, controls: { status: 'denied', items: [] } }), { kind: 'not-counted' });
  assert.deepEqual(mappedFigure({ documents: ready, controls: { status: 'error', items: [] } }), { kind: 'error', source: 'controls' });
  assert.deepEqual(mappedFigure({ documents: ready, controls: { status: 'loading', items: [] } }), { kind: 'loading' });
  // the order of the answers: a failed document list is said first, then a missing right, then a failed controls list
  assert.deepEqual(mappedFigure({ documents: { status: 'error', items: [] }, controls: { status: 'denied', items: [] } }), { kind: 'error', source: 'documents' });
  assert.deepEqual(mappedFigure({ documents: { status: 'loading', items: [] }, controls: { status: 'error', items: [] } }), { kind: 'loading' });
  assert.deepEqual(mappedFigure({ documents: ready, controls: { status: 'denied', items: [control(1, 1)] } }), { kind: 'not-counted' }, 'what a person may not read is not counted even if some of it came');
});

test('the open document lives in the address as ?doc=: read, written, and every other param left alone; junk is "none"', () => {
  assert.deepEqual(readAddress(DOC_ADDRESS, ''), { doc: 0 });
  assert.deepEqual(readAddress(DOC_ADDRESS, '?doc=8'), { doc: 8 });
  for (const junk of ['?doc=', '?doc=abc', '?doc=-3', '?doc=0', '?doc=2.5', '?doc=12abc', '?doc=1e3', '?doc=%20']) assert.deepEqual(readAddress(DOC_ADDRESS, junk), { doc: 0 }, junk);
  assert.deepEqual(readAddress(DOC_ADDRESS, '?doc=7&doc=9'), { doc: 7 }, 'the first one decides');
  assert.equal(writeAddress(DOC_ADDRESS, '', { doc: 8 }), 'doc=8');
  assert.equal(writeAddress(DOC_ADDRESS, '?doc=8', { doc: 0 }), '', 'none is the plain address, so every existing URL keeps working');
  assert.equal(writeAddress(DOC_ADDRESS, '?utm=x&doc=8#frag', { doc: 12 }), 'utm=x&doc=12', 'what is not the page\'s stays');
});

test('the toolbar is decided by every framework, not by the ones a search leaves; the counts above the groups are the same', () => {
  const rec = (n: number) => genRecs(prng(n), n);
  const gap = [] as RecommendedControl[];
  assert.equal(groupTotals(rec(3), gap, [], 1).toolbar, false, 'a short list of one framework needs none');
  assert.equal(groupTotals(rec(3), gap, [], 2).toolbar, true, 'two frameworks');
  assert.equal(groupTotals(rec(7), gap, [], 1).toolbar, true, 'more than six rows');
  assert.equal(groupTotals(rec(1), genRecs(prng(5), 1), [], 1).toolbar, true, 'any recommendation');
  const cov: CoverageFramework[] = [{ framework_id: 1, framework_name: 'A', total_controls: 5, mapped_count: 4, missing_count: 1, coverage_pct: 80, missing_controls: [] }, { framework_id: 2, framework_name: 'B', total_controls: 5, mapped_count: 5, missing_count: 0, coverage_pct: 100, missing_controls: [] }];
  assert.deepEqual(groupTotals([], gap, cov, 2), { gaps: 1, recommended: 0, toolbar: true });
  assert.deepEqual(groupTotals([], gap, [], 0), { gaps: 0, recommended: 0, toolbar: false });
  // the bug it fixes: with two frameworks and a search that leaves one, the old rule (groups.length > 1 on the FILTERED list) dropped the search box
  const recs = [{ ...rec(1)[0], framework_name: 'A', clause_reference: 'A.1' }, { ...rec(1)[0], framework_name: 'B', clause_reference: 'B.1' }];
  const all = frameworkGroups(recs, [], [], '');
  const narrowed = frameworkGroups(recs, [], [], 'a.1');
  assert.equal(all.length, 2);
  assert.equal(narrowed.length, 1);
  assert.equal(groupTotals(recs, [], [], all.length).toolbar, true);
});

test('the words: a type, a code, a match, a bar\'s tone', () => {
  assert.deepEqual(DOCUMENT_TYPES.map((t) => t.value), ['policy', 'standard', 'procedure', 'guideline', 'charter', 'framework'], 'the filter lists the types in the order it always did');
  assert.equal(typeLabel('policy'), 'Policy');
  assert.equal(typeLabel('legacy_type'), 'Legacy type');
  assert.equal(typeLabel(null), '—');
  assert.equal(upperCode('a.5.1'), 'A.5.1');
  assert.equal(upperCode(null), '');
  assert.equal(matchPct({ max_confidence: 0.826 } as RecommendedControl), 83);
  assert.equal(matchPct({ max_confidence: null } as RecommendedControl), null);
  assert.deepEqual([100, 80, 79, 50, 49, 0].map(coverageTone), ['success', 'success', 'warning', 'warning', 'danger', 'danger']);
  assert.equal(keyOf({ source: 'gap', control_ref_id: 7, control_kind: 'internal', control_code: 'X' } as RecommendedControl), 'gap::internal::7');
  assert.equal(keyOf({ source: 'mapping', control_ref_id: 7, control_kind: 'parsed', control_code: null } as RecommendedControl), 'parsed::');
});

test('linking a control that belongs to another document is a re-link (the server needs force_relink and the person is asked first)', () => {
  assert.deepEqual(relinkOf(control(1, null), 5), { relink: false, fromDocumentId: null });
  assert.deepEqual(relinkOf(control(1, 5), 5), { relink: false, fromDocumentId: 5 }, 'already this document\'s (the panel hides those)');
  assert.deepEqual(relinkOf(control(1, 9), 5), { relink: true, fromDocumentId: 9 });
  assert.deepEqual(relinkOf({ ...control(1, null), source_document_id: undefined }, 5), { relink: false, fromDocumentId: null });
  assert.equal(LINK_LIST_LIMIT, 50, 'the panel has always drawn 50');
});

test('the keys of a list of options: arrows step, Page keys jump ten, Home and End go to the ends, and the list stops at its ends', () => {
  assert.equal(optionAfter(100, 4, 'ArrowDown'), 5);
  assert.equal(optionAfter(100, 4, 'ArrowUp'), 3);
  assert.equal(optionAfter(100, 99, 'ArrowDown'), 99, 'no wrap at the end');
  assert.equal(optionAfter(100, 0, 'ArrowUp'), 0, 'no wrap at the start');
  assert.equal(optionAfter(100, 4, 'PageDown'), 14);
  assert.equal(optionAfter(100, 95, 'PageDown'), 99);
  assert.equal(optionAfter(100, 4, 'PageUp'), 0);
  assert.equal(optionAfter(100, 50, 'Home'), 0);
  assert.equal(optionAfter(100, 50, 'End'), 99);
  assert.equal(optionAfter(100, -1, 'ArrowDown'), 0, 'from outside the list: the first');
  assert.equal(optionAfter(100, -1, 'ArrowUp'), 99, 'and the last');
  for (const other of ['Enter', ' ', 'a', 'Tab', 'Escape', 'ArrowLeft']) assert.equal(optionAfter(100, 4, other), null, other);
  assert.equal(optionAfter(0, -1, 'ArrowDown'), -1, 'nothing to move to');
  assert.equal(optionAfter(0, -1, 'a'), null);
  assert.equal(optionAfter(1, 0, 'ArrowDown'), 0);
});
