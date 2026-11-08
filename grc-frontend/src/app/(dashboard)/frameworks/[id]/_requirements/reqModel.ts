// The rules of the Requirements tab of a framework journey, apart from React so `node --test` can pin them (reqModel.test.ts): a requirement as one row (its status,
// how far its evidence is, who owns it, where it sits, whether it counts), the quick views and what each counts, the order of the list (the framework's own document
// order is the default), the search, the section lines of the list (family and sub-family for a standard with its own structure), the board's columns, and what a bulk
// action may take. The numbers a requirement carries are the server's (status is the EFFECTIVE status of the list payload; the counts are the list's evidence counts):
// nothing here works out a score. Anything about the whole journey (Ready %, Implemented %) is lib/journeyModel.ts.
import type { CertificationControl, ControlStructure } from '../../../../../types/index.ts';
import { buildTree, progress as subControlProgress, statusOf, type SectionInput } from '../_tabs/requirementTree.ts';

/** The value of "none" in the facets that offer it (nobody, no priority). */
export const NONE = 'none';

// ── a requirement as a row ───────────────────────────────────────────────────────────────────────────────────────────────

export type EvidenceKey = 'none' | 'review' | 'rejected' | 'partial' | 'complete' | 'not_asked';
export interface EvidenceCounts { files: number; required: number; approved: number; pending: number; rejected: number }

/** The files a requirement holds against what it asks for, from the list payload's own counts (the lists of files fill in what a count lacks). */
export function evidenceCountsOf(c: Pick<CertificationControl, 'evidence' | 'evidence_count' | 'required_evidence_count' | 'approved_evidence_count' | 'evidence_requirements'>): EvidenceCounts {
  const files = c.evidence ?? [];
  const approvedInList = files.filter((e) => e.review_status === 'approved').length;
  return {
    files: c.evidence_count ?? files.length,
    required: c.required_evidence_count ?? (c.evidence_requirements ? c.evidence_requirements.length : 0),
    approved: c.approved_evidence_count ?? approvedInList,
    pending: files.filter((e) => e.review_status === 'pending').length,
    rejected: files.filter((e) => e.review_status === 'rejected').length,
  };
}

/**
 * Where a requirement's evidence stands, in the order a person works it: nothing yet; files waiting for a reviewer; what has been approved reaches what it asks for (the server's
 * own rule for readiness: approved >= what it asks for, or any approved file when it asks for nothing in particular); only turned-down files; partly there.
 * A requirement that asks for nothing and holds nothing needs nothing.
 */
export function evidenceStateOf(e: EvidenceCounts): EvidenceKey {
  if (e.files === 0) return e.required > 0 ? 'none' : 'not_asked';
  if (e.pending > 0) return 'review';
  const complete = e.required > 0 ? e.approved >= e.required : e.approved >= 1;
  if (complete) return 'complete';
  if (e.approved === 0 && e.rejected > 0) return 'rejected';
  return 'partial';
}

/** "2 of 6 approved"; a requirement that asks for nothing in particular says how many files it holds; "—" when it holds none. */
export function evidenceLine(e: EvidenceCounts): string {
  if (e.required > 0) return `${Math.min(e.approved, e.required)} of ${e.required} approved`;
  return e.files > 0 ? `${e.files} ${e.files === 1 ? 'file' : 'files'}` : '—';
}

export const isDone = (status: string | null | undefined): boolean => status === 'implemented' || status === 'verified';

export type Category = 'Organizational' | 'People' | 'Physical' | 'Technological' | 'Other';
/** The four themes of ISO 27001 Annex A, from the domain's name (the page's old Category filter); every other framework's domains are "Other". */
export function categoryOf(domainName: string | null | undefined): Category {
  const name = (domainName || '').toLowerCase();
  if (name.includes('organizational')) return 'Organizational';
  if (name.includes('people')) return 'People';
  if (name.includes('physical')) return 'Physical';
  if (name.includes('technological')) return 'Technological';
  return 'Other';
}

/** P1 to P4: the standard's own priority tier (UAE IA `priority_tier`, NDMO `priority_level`, which also holds other text such as "N/A (NCA-...)"). */
export function tierOf(c: Pick<CertificationControl, 'priority_tier' | 'priority_level'>): string | null {
  for (const v of [c.priority_tier, c.priority_level]) if (v && /^P[1-4]$/.test(v)) return v;
  return null;
}

export interface Checklist { kind: 'subcontrols' | 'criteria'; met: number; total: number }

/**
 * What a requirement asks to be ticked: the standard's sub-controls that are criteria (UAE IA), else its assessment criteria (NDMO). `ticks` are the person's unsaved
 * ticks, which win over what the server sent. null: nothing to tick.
 */
export function checklistOf(c: CertificationControl, ticks: Readonly<Record<number, Record<string, boolean>>> = {}): Checklist | null {
  const state = statusOf(c, ticks);
  if ((c.sub_control_tree?.length ?? 0) > 0) {
    const p = subControlProgress(c, state);
    if (p.total > 0) return { kind: 'subcontrols', met: p.met, total: p.total };
  }
  const criteria = c.assessment_criteria ?? [];
  if (criteria.length > 0) return { kind: 'criteria', met: criteria.filter((_, i) => !!state?.[String(i)]).length, total: criteria.length };
  return null;
}

/** The server sets a requirement's status from its criteria ticks when it has any (criteria PATCH); only a requirement without criteria has a status a person sets. */
export const statusFollowsTicks = (c: Pick<CertificationControl, 'assessment_criteria'>): boolean => (c.assessment_criteria?.length ?? 0) > 0;

export interface ReqRow {
  /** the implementation id: what every route of the journey takes */
  id: number;
  /** the library clause the scope decisions are keyed by */
  parsedId: number | null;
  code: string;
  name: string;
  section: string;
  /** the section's place in the framework's own order */
  sectionRank: number;
  /** `<rank>`: the section in the address and the facet */
  sectionKey: string;
  /** the standard's sub-family (UAE IA) the requirement sits under, '' when it has none the structure knows */
  bandKey: string;
  /** position in the order the server sent (the framework's published sequence) */
  seq: number;
  status: string;
  inScope: boolean;
  critical: boolean;
  category: Category;
  tier: string | null;
  ownerIds: number[];
  ownerRefs: OwnerRef[];
  /** their names, in the same order */
  owners: string[];
  evidence: EvidenceCounts;
  evidenceKey: EvidenceKey;
  checklist: Checklist | null;
  openIssues: number;
  /** the folded text the search looks at */
  text: string;
  control: CertificationControl;
}

const NUMERIC_PREFIX = /^\s*(\d+)/;

/** The section a requirement is listed under: its domain's name; a numbered clause without one is "Section 5"; anything else "General". */
export function sectionLabelOf(c: Pick<CertificationControl, 'domain_name' | 'control_code' | 'original_control_code'>): string {
  const name = (c.domain_name || '').trim();
  if (name) return name;
  const prefix = String(c.control_code || c.original_control_code || '').match(NUMERIC_PREFIX)?.[1];
  return prefix ? `Section ${prefix}` : 'General';
}

export const ownerIdsOfControl = (c: Pick<CertificationControl, 'assigned_user_ids' | 'assigned_to_user_id'>): number[] =>
  c.assigned_user_ids && c.assigned_user_ids.length > 0 ? c.assigned_user_ids : c.assigned_to_user_id ? [c.assigned_to_user_id] : [];

export interface OwnerRef { id: number; name: string }

/** The people who own a requirement, with their names: the names the server resolved; for an id it did not, the name of a legacy single assignee or the user list's (an id
 *  nobody knows stays "User 9"). */
export function ownerRefsOf(
  c: Pick<CertificationControl, 'assignees' | 'assignee_name' | 'assigned_user_ids' | 'assigned_to_user_id'>,
  users: ReadonlyArray<{ id: number; name: string }> = [],
): OwnerRef[] {
  const ids = ownerIdsOfControl(c);
  const resolved = new Map((c.assignees ?? []).map((a) => [a.id, a.display_name || a.email || `User ${a.id}`] as const));
  return ids.map((id) => ({
    id,
    name: resolved.get(id) ?? (c.assignee_name && ids.length === 1 ? c.assignee_name : users.find((u) => u.id === id)?.name ?? `User ${id}`),
  }));
}

/**
 * The rows of the tab, in the order the server sent them. `structure` is the standard's own families and sub-families (a framework that carries one groups under them);
 * `ticks` the unsaved criteria ticks; `users` name an owner the payload only has an id for.
 */
export function toRows(
  controls: readonly CertificationControl[],
  { structure = null, ticks = {}, users = [] }: { structure?: ControlStructure | null; ticks?: Readonly<Record<number, Record<string, boolean>>>; users?: ReadonlyArray<{ id: number; name: string }> } = {},
): ReqRow[] {
  const rank = new Map<string, number>();
  const sectionOf = controls.map((c) => {
    const label = sectionLabelOf(c);
    if (!rank.has(label)) rank.set(label, rank.size);
    return label;
  });
  const knownBands = new Set((structure?.subfamilies ?? []).map((s) => s.id));
  return controls.map((c, seq) => {
    const section = sectionOf[seq];
    const sectionRank = rank.get(section) as number;
    const sub = (c.parent_section ?? '').trim();
    const ownerRefs = ownerRefsOf(c, users);
    const owners = ownerRefs.map((o) => o.name);
    const evidence = evidenceCountsOf(c);
    return {
      id: c.id,
      parsedId: c.parsed_control_id ?? null,
      code: c.control_code || c.original_control_code || c.system_control_code || '',
      name: c.control_name || '',
      section,
      sectionRank,
      sectionKey: String(sectionRank),
      bandKey: `${sectionRank}|${structure && knownBands.has(sub) ? sub : ''}`,
      seq,
      status: c.status || 'not_started',
      inScope: c.is_applicable !== false,
      critical: !!c.is_critical,
      category: categoryOf(c.domain_name),
      tier: tierOf(c),
      ownerIds: ownerRefs.map((o) => o.id),
      ownerRefs,
      owners,
      evidence,
      evidenceKey: evidenceStateOf(evidence),
      checklist: checklistOf(c, ticks),
      openIssues: Number((c as { open_issues_count?: number }).open_issues_count ?? 0) || 0,
      text: [
        c.control_code, c.original_control_code, c.system_control_code, c.control_name, c.control_statement, section, owners.join(' '),
        ...(c.sub_control_tree ?? []).map((n) => `${n.code} ${n.lead_in ?? ''} ${n.text}`),
      ].filter(Boolean).join(' ').toLowerCase(),
      control: c,
    };
  });
}

// ── the quick views ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const QUICK_IDS = ['all', 'mine', 'needs_evidence', 'review', 'unassigned', 'critical'] as const;
export type QuickId = (typeof QUICK_IDS)[number];
export const QUICK_LABEL: Record<QuickId, string> = {
  all: 'All', mine: 'Assigned to me', needs_evidence: 'Needs evidence', review: 'Waiting for review', unassigned: 'Unassigned', critical: 'Critical',
};
export interface Viewer { me: number | null }

/** Whether a requirement is in a quick view. "Needs evidence" is a requirement that is not done and holds none, only turned-down files or part of what it asks for. */
export function inQuick(id: QuickId, row: ReqRow, v: Viewer): boolean {
  switch (id) {
    case 'all': return true;
    case 'mine': return v.me !== null && row.ownerIds.indexOf(v.me) >= 0;
    case 'needs_evidence': return !isDone(row.status) && (row.evidenceKey === 'none' || row.evidenceKey === 'partial' || row.evidenceKey === 'rejected');
    case 'review': return row.evidence.pending > 0;
    case 'unassigned': return row.ownerIds.length === 0 && !isDone(row.status);
    case 'critical': return row.critical;
    default: return false;
  }
}

export const searchTerms = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

// ── the order of the list ────────────────────────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = ['order', 'status', 'evidence', 'owner', 'priority'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
/** The framework's own order: section by section as the standard publishes them, then by clause number. */
export const DEFAULT_SORT: Sort = { key: 'order', dir: 'asc' };
export const SORT_LABEL: Record<SortKey, string> = { order: 'Framework order', status: 'Status', evidence: 'Evidence', owner: 'Owner', priority: 'Priority' };
export const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { order: 'asc', status: 'asc', evidence: 'asc', owner: 'asc', priority: 'asc' };

/** The next order when a header is pressed: a new key starts in its first direction, the same key turns round, a second turn goes back to the framework's order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  if (current.dir === FIRST_DIR[key]) return { key, dir: FIRST_DIR[key] === 'asc' ? 'desc' : 'asc' };
  return DEFAULT_SORT;
}

/** Clause numbers in natural order: "1.2.10" after "1.2.9", numbers before words. */
export function naturalCompare(a: string, b: string): number {
  const parts = (s: string) => (s || '').split(/[.\-_\s]+/).map((p) => { const n = parseInt(p, 10); return Number.isNaN(n) ? p.toLowerCase() : n; });
  const x = parts(a);
  const y = parts(b);
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = x[i] ?? '';
    const q = y[i] ?? '';
    if (typeof p === 'number' && typeof q === 'number') {
      if (p !== q) return p - q;
    } else if (typeof p === 'number') {
      return -1;
    } else if (typeof q === 'number') {
      return 1;
    } else {
      const cmp = String(p).localeCompare(String(q));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

/** The clause number the framework's order uses: the original code, else the system code, else the one shown. */
const orderCode = (r: ReqRow): string => r.control.original_control_code || r.control.system_control_code || r.control.control_code || '';

// the person works from the worst to the best
const STATUS_ORDER = ['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'];
const EVIDENCE_ORDER: EvidenceKey[] = ['none', 'rejected', 'partial', 'review', 'complete', 'not_asked'];
const rank = (order: readonly string[], v: string): number => { const at = order.indexOf(v); return at < 0 ? order.length : at; };

/** The rows in the order asked for. A row without the value goes last whichever way the key runs; ties keep the framework's order. */
export function sortRows(rows: readonly ReqRow[], sort: Sort): ReqRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const own = (a: ReqRow, b: ReqRow) => a.sectionRank - b.sectionRank || naturalCompare(orderCode(a), orderCode(b)) || a.seq - b.seq;
  const value = (r: ReqRow): string | number | null => {
    switch (sort.key) {
      case 'status': return rank(STATUS_ORDER, r.status);
      case 'evidence': return rank(EVIDENCE_ORDER, r.evidenceKey);
      case 'owner': return r.owners.length ? r.owners[0].toLowerCase() : null;
      case 'priority': return r.tier ? Number(r.tier.slice(1)) : null;
      default: return null;
    }
  };
  return rows.slice().sort((a, b) => {
    if (sort.key === 'order') return own(a, b) * sign;
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return own(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    if (x === y) return own(a, b);
    if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y) * sign || own(a, b);
    return ((x as number) < (y as number) ? -1 : 1) * sign;
  });
}

// ── the section lines of the list ────────────────────────────────────────────────────────────────────────────────────────

export interface GroupField { label: string; text?: string | null; items?: string[] | null }
export interface GroupInfo {
  key: string;
  /** 1: the section (a family of the standard); 2: the standard's sub-family */
  level: 1 | 2;
  /** "M1", "M1.1"; '' when the section has no id of its own */
  id: string;
  title: string;
  /** implemented or verified, of the requirements in view (verified counted once) */
  done: number;
  total: number;
  /** what the standard says about it (objective, indicators ...), shown behind an (i); empty for a plain section */
  fields: GroupField[];
}

export type ListItem = { kind: 'group'; group: GroupInfo } | { kind: 'row'; row: ReqRow };

const hasField = (f: GroupField): boolean => !!((f.text && f.text.trim()) || (f.items && f.items.length > 0));

/**
 * The line over each section (and, for a standard with its own structure, each sub-family), with how many of the requirements IN VIEW (the ones the filters let through, not
 * just the page) are done. buildTree names the families and sub-families; a plain framework's section is just its domain's name.
 */
export function groupInfos(matching: readonly ReqRow[], structure: ControlStructure | null | undefined): Map<string, GroupInfo> {
  const out = new Map<string, GroupInfo>();
  const sections: SectionInput[] = [];
  const at = new Map<string, SectionInput>();
  for (const r of matching) {
    let s = at.get(r.sectionKey);
    if (!s) { s = { key: r.sectionKey, label: r.section, controls: [] }; at.set(r.sectionKey, s); sections.push(s); }
    s.controls.push(r.control);
  }
  if (!structure) {
    for (const s of sections) {
      const done = s.controls.filter((c) => isDone(c.status)).length;
      out.set(s.key, { key: s.key, level: 1, id: '', title: s.label, done, total: s.controls.length, fields: [] });
    }
    return out;
  }
  for (const family of buildTree(sections, structure)) {
    out.set(family.key, {
      key: family.key, level: 1, id: family.id ?? '', title: family.title, done: family.compliant, total: family.total,
      fields: [{ label: 'Objective', text: family.info?.objective }, { label: 'Performance indicators', items: family.info?.performance_indicators }].filter(hasField),
    });
    for (const band of family.bands) {
      out.set(`${family.key}|${band.id}`, {
        key: `${family.key}|${band.id}`, level: 2, id: band.id, title: band.name, done: band.compliant, total: band.total,
        fields: [
          { label: 'Objective', text: band.info?.objective }, { label: 'Performance indicators', items: band.info?.performance_indicators },
          { label: 'Automation guidance', text: band.info?.automation_guidance }, { label: 'Relevant threats and vulnerabilities', items: band.info?.threats },
        ].filter(hasField),
      });
    }
  }
  return out;
}

/**
 * The page's rows with a line over each new section (and sub-family). A page that starts in the middle of a section repeats its line, so no row is ever without the section
 * it belongs to. Only for a list in the framework's order: any other order is a flat list.
 */
export function withGroups(pageRows: readonly ReqRow[], infos: ReadonlyMap<string, GroupInfo>, structured: boolean): ListItem[] {
  const out: ListItem[] = [];
  let family = '';
  let band = '';
  for (const row of pageRows) {
    if (row.sectionKey !== family) {
      family = row.sectionKey;
      band = '';
      const g = infos.get(family);
      if (g) out.push({ kind: 'group', group: g });
    }
    if (structured && row.bandKey !== band) {
      band = row.bandKey;
      const g = infos.get(band);
      if (g && g.id !== '') out.push({ kind: 'group', group: g });
    }
    out.push({ kind: 'row', row });
  }
  return out;
}

// ── the board ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BoardDef { id: string; label: string; test: (r: ReqRow) => boolean }

/** Columns by status, in the order the work goes. A requirement that is out of scope (only seen when the Scope facet asks for it) has a column of its own, first, so it never hides among the open ones. */
export function boardDefs(rows: readonly ReqRow[], label: (status: string) => string): BoardDef[] {
  const cols: BoardDef[] = [];
  if (rows.some((r) => !r.inScope)) cols.push({ id: 'out', label: 'Out of scope', test: (r) => !r.inScope });
  for (const s of ['not_started', 'in_progress', 'implemented', 'verified']) cols.push({ id: s, label: label(s), test: (r) => r.inScope && r.status === s });
  cols.push({ id: 'other', label: label('not_applicable'), test: (r) => r.inScope });          // anything else, last
  return cols;
}

// ── what a bulk action may take ──────────────────────────────────────────────────────────────────────────────────────────

export type BulkKind = 'assign' | 'scope_out' | 'scope_in';

export interface BulkPlan { ids: number[]; skipped: number; why: string }

/** Which of the ticked requirements an action applies to: owners can be set on any; "out of scope" is asked for the ones in scope, "back in scope" for the ones out. */
export function bulkPlan(kind: BulkKind, rows: readonly ReqRow[]): BulkPlan {
  const eligible = kind === 'assign' ? rows : rows.filter((r) => (kind === 'scope_out' ? r.inScope : !r.inScope));
  const skipped = rows.length - eligible.length;
  const why = skipped === 0 ? '' : kind === 'scope_out' ? `${skipped} ${skipped === 1 ? 'is' : 'are'} already out of scope` : `${skipped} ${skipped === 1 ? 'is' : 'are'} already in scope`;
  return { ids: eligible.map((r) => r.id), skipped, why };
}

export type OwnerMode = 'add' | 'replace';

/** The owners a requirement ends up with: the people chosen added to its own ("add", nobody is taken off) or only the people chosen ("replace"; nobody chosen withdraws every owner). */
export function mergeOwners(existing: readonly number[], picked: readonly number[], mode: OwnerMode): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of mode === 'add' ? [...existing, ...picked] : picked) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

export interface BulkResult { done: number; failed: number; skipped: number }

/** What the summary of a bulk action says: the title counts what was done, the message says what was not and why. */
export function bulkSummary(verb: string, noun: { one: string; other: string }, r: BulkResult, why = ''): { title: string; message?: string } {
  const title = `${verb} ${r.done} ${r.done === 1 ? noun.one : noun.other}`;
  const parts: string[] = [];
  if (r.skipped > 0) parts.push(`${why || `${r.skipped} did not need it`}.`);
  if (r.failed > 0) parts.push(`${r.failed} could not be changed and ${r.failed === 1 ? 'stays' : 'stay'} selected, so you can try again.`);
  return parts.length ? { title, message: parts.join(' ') } : { title };
}
