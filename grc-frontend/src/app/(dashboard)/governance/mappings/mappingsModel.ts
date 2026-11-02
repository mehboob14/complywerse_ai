// Governance > Mappings as pure functions (mappingsModel.test.ts): what the address says (?doc=), the documents the list answered and how many the server
// has, what the "mapped documents" figure is and when it is not a figure at all, the framework groups of a document (the grouping, the order, the search, the
// dedupe of the gap-analysis recommendations against what is already mapped), the controls a person can still link, and the words of a row. No React.
//
// MOVED, NOT CHANGED: the gap-to-recommendation conversion (gapFindingsToRecs and what it picks), the dedupe of recommendations (uniqueGapRecs), the groups
// (frameworkGroups: coverage worst first, then most rows, then name) and the link-panel list (filterControls) are the page's own rules from before it was split
// into files; mappingsModel.test.ts holds a frozen copy of the old code and compares the two on generated data. What is new here is only the honest part: the
// documents' true total, the "mapped" figure that says what it is not (not counted, not loaded), and the address.
import type { CoverageFramework, DocumentItem, GapRecommendedFinding, InternalControl, RecommendedControl } from './_types.ts';
import { integer } from '../../../../lib/addressState.ts';
import { statusLabel } from '../../../../lib/format.ts';

// ── the address: /governance/mappings?doc=<id> ───────────────────────────────────────────────────────────────────────────────────────────────

/** The one param the standalone page keeps in its address: the document that is open. 0 is "none"; anything that is not a positive whole number is none. */
export const DOC_ADDRESS = { doc: integer(0, { min: 1 }) };

// ── documents: what the list answered ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DocumentsReading {
  items: DocumentItem[];
  /** how many documents the server has under the same search and type: the response's `total`, never less than what came */
  total: number;
  /** the list is cut: the server has more than it sent */
  cut: boolean;
}

/** GET /governance/documents answers `{ items, total, skip, limit }` (an older shape was the bare array). The page asks for 100; `total` is how many there are. */
export function readDocuments(data: unknown): DocumentsReading {
  const body = (data ?? {}) as { items?: unknown; total?: unknown };
  const items = (Array.isArray(body.items) ? body.items : Array.isArray(data) ? data : []) as DocumentItem[];
  const total = typeof body.total === 'number' && Number.isFinite(body.total) && body.total >= items.length ? Math.floor(body.total) : items.length;
  return { items, total, cut: total > items.length };
}

// ── the "mapped documents" figure ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MappedFigure =
  | { kind: 'loading' }
  /** a request failed: which one, so the tile can say what to retry */
  | { kind: 'error'; source: 'documents' | 'controls' }
  /** the person may not read internal controls, so which documents have one cannot be counted: not 0% */
  | { kind: 'not-counted' }
  | { kind: 'value'; mapped: number; of: number; /** whole percent of the loaded documents; null when there are none */ pct: number | null };

export interface MappedInput {
  documents: { status: 'loading' | 'error' | 'ready'; items: readonly DocumentItem[] };
  controls: { status: 'loading' | 'error' | 'denied' | 'ready'; items: readonly InternalControl[] };
}

/**
 * How many of the documents LOADED have at least one internal control pointing back at them (`source_document_id`): the page's own definition and arithmetic
 * (Math.round of the share, 0 when there are no documents), unchanged. What is new is that it is only a figure when both requests answered: a failed or
 * missing one is said, never counted as 0.
 */
export function mappedFigure({ documents, controls }: MappedInput): MappedFigure {
  if (documents.status === 'error') return { kind: 'error', source: 'documents' };
  if (documents.status === 'loading') return { kind: 'loading' };
  if (controls.status === 'denied') return { kind: 'not-counted' };
  if (controls.status === 'error') return { kind: 'error', source: 'controls' };
  if (controls.status === 'loading') return { kind: 'loading' };
  const mappedDocIds = new Set<number>();
  controls.items.forEach((control) => { if (control.source_document_id != null) mappedDocIds.add(control.source_document_id); });
  const mapped = documents.items.reduce((count, doc) => (mappedDocIds.has(doc.id) ? count + 1 : count), 0);
  const of = documents.items.length;
  return { kind: 'value', mapped, of, pct: of > 0 ? Math.round((mapped / of) * 100) : null };
}

// ── the keyboard in a list of options ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a key moves focus in a list of `count` options when it is on option `at` (-1: on none of them yet): ArrowDown / ArrowUp step by one, PageDown /
 *  PageUp by ten, Home / End go to the ends. The list stops at its ends (a hundred documents are not a ring). null for any other key; -1 when there is
 *  nothing to move to. */
export function optionAfter(count: number, at: number, key: string): number | null {
  if (count <= 0) return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End' || key === 'PageDown' || key === 'PageUp' ? -1 : null;
  const last = count - 1;
  const clamp = (n: number) => Math.max(0, Math.min(last, n));
  switch (key) {
    case 'ArrowDown': return clamp(at + 1);
    case 'ArrowUp': return at < 0 ? last : clamp(at - 1);
    case 'PageDown': return clamp(at + 10);
    case 'PageUp': return at < 0 ? last : clamp(at - 10);
    case 'Home': return 0;
    case 'End': return last;
    default: return null;
  }
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = { policy: 'Policy', standard: 'Standard', procedure: 'Procedure', guideline: 'Guideline', charter: 'Charter', framework: 'Framework' };
/** The document types the Type filter offers, in the order it has always listed them. */
export const DOCUMENT_TYPES: ReadonlyArray<{ value: string; label: string }> = Object.keys(TYPE_LABEL).map((value) => ({ value, label: TYPE_LABEL[value] }));
/** A document type said as a word ("policy" is "Policy"; a type nobody listed reads as itself, readable). */
export const typeLabel = (type: string | null | undefined): string => (type && TYPE_LABEL[type]) || statusLabel(type);

/** How a control is linked to a document: the four words the link panel has always offered. (The server stores none of them: see the audit.) */
export const LINK_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'implements', label: 'Implements' },
  { value: 'supports', label: 'Supports' },
  { value: 'references', label: 'References' },
  { value: 'derives_from', label: 'Derives From' },
];

// Control identifiers / clause references always render upper-cased (e.g. "a.5.1" → "A.5.1"); digits and punctuation are unaffected.
export const upperCode = (s: string | null | undefined): string => (s ?? '').toUpperCase();

export const matchPct = (r: RecommendedControl): number | null => (typeof r.max_confidence === 'number' ? Math.round(r.max_confidence * 100) : null);

export type CoverageTone = 'success' | 'warning' | 'danger';
/** The colour of a coverage bar: 80% and over is good, 50% and over needs a look, less is bad (the thresholds the page always had). */
export const coverageTone = (pct: number): CoverageTone => (pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger');

// ── gap-analysis recommendations, as rows ────────────────────────────────────────────────────────────────────────────────────────────────────

// Prefer the linkable control mappings already understand: internal → normalized
// → framework → parsed. Within a kind, prefer structured links over fuzzy.
const GAP_KIND_RANK: Record<string, number> = {
  internal: 4,
  normalized: 3,
  framework: 2,
  parsed: 1,
};
const GAP_REASON_RANK: Record<string, number> = {
  framework_link: 4,
  normalized_link: 3,
  framework_clause: 2,
  fuzzy_match: 1,
};

const GAP_COVERAGE: Record<string, string> = {
  partially_compliant: 'partial',
  not_addressed: 'gap',
};

export function pickBestGapControl(
  controls: GapRecommendedFinding['controls'],
): GapRecommendedFinding['controls'][number] | null {
  if (!controls.length) return null;
  return [...controls].sort((a, b) => {
    const kindDelta = (GAP_KIND_RANK[b.kind] ?? 0) - (GAP_KIND_RANK[a.kind] ?? 0);
    if (kindDelta !== 0) return kindDelta;
    return (GAP_REASON_RANK[b.match_reason] ?? 0) - (GAP_REASON_RANK[a.match_reason] ?? 0);
  })[0];
}

/** Meaningful "Why it matched" prose — never match_reason jargon. */
export function gapRationale(f: GapRecommendedFinding, c: GapRecommendedFinding['controls'][number]): string {
  const reasoning = (f.ai_reasoning || '').trim();
  if (reasoning) return reasoning;

  // Readable synthesis: first useful finding narrative, then clause text.
  for (const raw of [
    f.gap_description,
    f.missing_requirement,
    f.remediation_recommendation,
    f.clause_requirement_text,
  ]) {
    const t = (raw || '').trim();
    if (t) return t;
  }

  const ctrlDesc = (c.description || '').trim();
  if (ctrlDesc) return ctrlDesc;

  const clause = (f.clause_reference || c.code || '').trim();
  return clause
    ? `Recommended from gap analysis for clause ${clause}`
    : 'Recommended from gap analysis';
}

/** Flatten gap-analysis recommendations into the same shape as statement mappings.
 * One row per gap clause (per framework): never both Parsed + Normalized. */
export function gapFindingsToRecs(findings: GapRecommendedFinding[]): RecommendedControl[] {
  const out: RecommendedControl[] = [];
  const seenClause = new Set<string>(); // framework::clause_reference
  const seenControl = new Set<string>(); // kind::id
  for (const f of findings) {
    const c = pickBestGapControl(f.controls);
    if (!c) continue;

    const fw = (c.framework_name || f.framework_name || '').trim().toLowerCase();
    const clause = (f.clause_reference || c.code || '').trim().toLowerCase();
    const clauseKey = `${fw}::${clause}`;
    if (clause && seenClause.has(clauseKey)) continue;
    if (clause) seenClause.add(clauseKey);

    const ctrlKey = `${c.kind}::${c.id}`;
    if (seenControl.has(ctrlKey)) continue;
    seenControl.add(ctrlKey);

    const description = (
      c.description
      || f.clause_requirement_text
      || null
    );

    out.push({
      control_kind: c.kind,
      control_code: c.code,
      control_title: c.title || f.clause_title,
      framework_name: c.framework_name || f.framework_name,
      domain: c.domain || null,
      coverage_type: GAP_COVERAGE[f.compliance_status] || null,
      link_source: 'gap',
      max_confidence: typeof f.confidence_score === 'number' ? f.confidence_score : null,
      statement_count: 0,
      control_ref_id: c.id,
      clause_reference: f.clause_reference || c.code,
      description,
      is_linked: c.already_linked,
      statements: [],
      uploaded_framework_id: f.uploaded_framework_id,
      rationale: gapRationale(f, c),
      finding_id: f.finding_id,
      source: 'gap',
      compliance_status: f.compliance_status,
      gap_description: f.gap_description || null,
      missing_requirement: f.missing_requirement || null,
      remediation: f.remediation_recommendation || null,
      risk_severity: f.risk_severity || null,
    });
  }
  return out;
}

// ── framework groups ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The identity of a recommendation row: a gap row by its control id, a mapping row by kind and code. */
export const keyOf = (r: RecommendedControl): string =>
  r.source === 'gap' && r.control_ref_id != null
    ? `gap::${r.control_kind}::${r.control_ref_id}`
    : `${r.control_kind}::${r.control_code ?? ''}`;

export const OTHER = 'Other';
export const fwNameOf = (r: RecommendedControl): string => r.framework_name || OTHER;

/** Statement-mapping recs only under "Mapped"; gap-sourced under "Recommended to link". Hide gap items already covered by a mapped row (same control or same
 *  clause in framework); the ones still to link come first. */
export function uniqueGapRecs(gapRecs: RecommendedControl[], recs: RecommendedControl[]): RecommendedControl[] {
  const byControl = new Set<string>();
  const byClause = new Set<string>();
  recs.forEach((r) => {
    byControl.add(`${r.control_kind}::${r.control_code ?? ''}`.toLowerCase());
    if (r.control_ref_id != null) byControl.add(`${r.control_kind}::id:${r.control_ref_id}`);
    // Also match across kinds by code alone (parsed 1.3 ≡ normalized 1.3).
    const code = (r.control_code || r.clause_reference || '').trim().toLowerCase();
    if (code) {
      byControl.add(`code::${code}`);
      const fw = (r.framework_name || '').trim().toLowerCase();
      byClause.add(`${fw}::${code}`);
    }
  });

  const filtered = gapRecs.filter((r) => {
    const byCode = `${r.control_kind}::${r.control_code ?? ''}`.toLowerCase();
    const byId = r.control_ref_id != null ? `${r.control_kind}::id:${r.control_ref_id}` : '';
    const codeAlone = (r.control_code || r.clause_reference || '').trim().toLowerCase();
    const clauseKey = `${(r.framework_name || '').trim().toLowerCase()}::${codeAlone}`;
    if (byControl.has(byCode)) return false;
    if (byId && byControl.has(byId)) return false;
    if (codeAlone && byControl.has(`code::${codeAlone}`)) return false;
    if (codeAlone && byClause.has(clauseKey)) return false;
    return true;
  });
  // Unlinked first so Link actions lead the list.
  return filtered.sort((a, b) => Number(a.is_linked) - Number(b.is_linked));
}

export interface FrameworkGroup {
  name: string;
  cov: CoverageFramework | null;
  mapped: RecommendedControl[];
  recommended: RecommendedControl[];
}

/** One entry PER FRAMEWORK: mapped clauses + gap recommendations + coverage/gaps. Frameworks come from coverage ∪ mapped recs ∪ gap recs; a search keeps the
 *  frameworks whose name matches (whole) and, in the others, the rows and the not-mapped clauses that match; worst coverage first, then most rows, then name. */
export function frameworkGroups(recs: RecommendedControl[], uniqueGap: RecommendedControl[], coverage: CoverageFramework[], search: string): FrameworkGroup[] {
  const q = search.trim().toLowerCase();
  const byName = new Map<string, FrameworkGroup>();
  const ensure = (name: string) => {
    let g = byName.get(name);
    if (!g) { g = { name, cov: null, mapped: [], recommended: [] }; byName.set(name, g); }
    return g;
  };
  coverage.forEach((c) => { ensure(c.framework_name).cov = c; });
  recs.forEach((r) => { ensure(fwNameOf(r)).mapped.push(r); });
  uniqueGap.forEach((r) => { ensure(fwNameOf(r)).recommended.push(r); });
  let list = Array.from(byName.values());
  if (q) {
    list = list.map((g) => {
      const nameHit = g.name.toLowerCase().includes(q);
      if (nameHit) return g;
      const matchRec = (r: RecommendedControl) =>
        `${r.clause_reference ?? ''} ${r.control_code ?? ''} ${r.control_title ?? ''}`.toLowerCase().includes(q);
      const mapped = g.mapped.filter(matchRec);
      const recommended = g.recommended.filter(matchRec);
      const cov = g.cov
        ? { ...g.cov, missing_controls: g.cov.missing_controls.filter((c) => `${c.reference ?? ''} ${c.title ?? ''}`.toLowerCase().includes(q)) }
        : null;
      return { ...g, mapped, recommended, cov };
    }).filter((g) =>
      g.name.toLowerCase().includes(q)
      || g.mapped.length > 0
      || g.recommended.length > 0
      || (g.cov?.missing_controls.length ?? 0) > 0
    );
  }
  list.sort((a, b) => {
    const ap = a.cov?.coverage_pct ?? 999;
    const bp = b.cov?.coverage_pct ?? 999;
    if (ap !== bp) return ap - bp; // worst coverage first
    const aCount = a.mapped.length + a.recommended.length;
    const bCount = b.mapped.length + b.recommended.length;
    if (bCount !== aCount) return bCount - aCount;
    return a.name.localeCompare(b.name);
  });
  return list;
}

export interface GroupTotals {
  /** clauses of the document's frameworks no statement covers (the coverage's own counts) */
  gaps: number;
  /** recommendations still to link, after the dedupe */
  recommended: number;
  /** the search and the All / Mapped / Gaps switch are worth showing: a long list, any recommendation or gap, or more than one framework */
  toolbar: boolean;
}

/** The counts above the groups, and whether the toolbar is shown. The toolbar is decided by ALL the frameworks, not by the ones a search leaves: it used to
 *  count the filtered groups, so a search that narrowed the list to one framework took the search box away mid-typing. */
export function groupTotals(recs: RecommendedControl[], uniqueGap: RecommendedControl[], coverage: CoverageFramework[], allGroups: number): GroupTotals {
  const gaps = coverage.reduce((n, c) => n + (c.missing_count || 0), 0);
  return { gaps, recommended: uniqueGap.length, toolbar: recs.length > 6 || uniqueGap.length > 0 || allGroups > 1 || gaps > 0 };
}

// ── the link panel ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How many controls the link panel draws (it says so when there are more, and a search narrows). */
export const LINK_LIST_LIMIT = 50;

/** The controls a person can still link to this document: every one not linked to it already that matches the search (id, name or description), the ones that
 *  belong to no document first, then by id. */
export function filterControls(all: InternalControl[] | undefined, search: string, linkedControlIds: ReadonlySet<number>): InternalControl[] {
  if (!all) return [];
  return all.filter((control) => {
    const matchesSearch = !search
      || control.control_id.toLowerCase().includes(search.toLowerCase())
      || control.name.toLowerCase().includes(search.toLowerCase())
      || control.description?.toLowerCase().includes(search.toLowerCase());
    const notAlreadyLinkedToSelectedDocument = !linkedControlIds.has(control.id);
    return matchesSearch && notAlreadyLinkedToSelectedDocument;
  }).sort((left, right) => {
    const leftMapped = left.source_document_id ? 1 : 0;
    const rightMapped = right.source_document_id ? 1 : 0;
    if (leftMapped !== rightMapped) return leftMapped - rightMapped;
    return left.control_id.localeCompare(right.control_id);
  });
}

/** Whether linking `control` to document `documentId` takes it off another document (it points at one already): the server needs `force_relink` for that, and
 *  the person is asked first. */
export function relinkOf(control: InternalControl, documentId: number): { relink: boolean; fromDocumentId: number | null } {
  const existing = control.source_document_id || null;
  return { relink: !!existing && existing !== documentId, fromDocumentId: existing };
}

/** The ids of the controls a document's links name (what the link panel hides). */
export function linkedControlIds(links: ReadonlyArray<{ internal_control_id: number; normalized_control_id: number }> | undefined): Set<number> {
  return new Set((links || []).map((link) => link.internal_control_id || link.normalized_control_id));
}
