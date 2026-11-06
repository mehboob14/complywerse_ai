/**
 * What the NIST workbench decides without a screen: the shapes the server sends, how far a control is determined, the words and tone of a status, which items a
 * search and the filters leave, the figures of the header, and the artifacts (assessment objects) a control names with the key evidence is filed under.
 * The rules of NIST's method (a control is Satisfied only when every objective is) are the server's (`modules/assessments/nist.py`); this only reads their result.
 */
import type { Tone } from '../../../../lib/status.ts';

export type Determination = 'satisfied' | 'other_than_satisfied' | 'not_applicable';
export type Implementation = 'NI' | 'PI' | 'LI' | 'FI' | 'NA';

export interface Objective { id: string; text: string; determination: Determination | null; note: string }
export interface ControlData {
  kind: '800-53A';
  control: string; family: string; title: string; statement: string;
  objectives: Objective[];
  /** EXAMINE / INTERVIEW / TEST -> the assessment objects NIST names */
  methods: Record<string, string[]>;
}
export interface ProfileData {
  kind: 'CSF2';
  function: string; function_name: string; category: string | null; category_title: string | null; outcome: string;
  examples: Array<{ id: string; text: string }>;
  current: Implementation | null; target: Implementation | null; note?: string;
}
export type ItemData = ControlData | ProfileData;

export interface NistItem {
  id: number;
  item_number: string;
  area_domain: string;
  subdomain_name?: string | null;
  control_description: string | null;
  compliance_status: string;
  evidence_count: number;
  assignees: Array<{ type: 'user' | 'team'; id: number; name: string }>;
  gaps_identified: string | null;
  proposed_solution: string | null;
  assessment_data: ItemData | null;
}

export const isControl = (d: ItemData | null | undefined): d is ControlData => d?.kind === '800-53A';
export const isProfile = (d: ItemData | null | undefined): d is ProfileData => d?.kind === 'CSF2';

export const DETERMINATION_LABEL: Record<Determination, string> = { satisfied: 'Satisfied', other_than_satisfied: 'Other than satisfied', not_applicable: 'Not applicable' };
export const IMPLEMENTATION_LABEL: Record<Implementation, string> = { NI: 'Not implemented', PI: 'Partially implemented', LI: 'Largely implemented', FI: 'Fully implemented', NA: 'Not applicable' };
export const METHODS = ['EXAMINE', 'INTERVIEW', 'TEST'] as const;
/** NIST SP 800-53A's own meaning of each method, shown from an (i). */
export const METHOD_HELP: Record<string, string> = {
  EXAMINE: 'Check, inspect, review, observe or analyse the objects: documents, records, configurations, mechanisms.',
  INTERVIEW: 'Hold discussions with the people named, to understand, clarify or find evidence.',
  TEST: 'Exercise the objects under the conditions that apply, and compare what happens with what is expected.',
};
export const methodLabel = (m: string): string => m.charAt(0) + m.slice(1).toLowerCase();

// ── how far a control is ────────────────────────────────────────────────────────────────────────────────────────────
export interface Progress { total: number; determined: number; satisfied: number; other: number; na: number }

export function progressOf(item: Pick<NistItem, 'assessment_data'>): Progress {
  const objectives = isControl(item.assessment_data) ? item.assessment_data.objectives : [];
  const count = (d: Determination) => objectives.filter((o) => o.determination === d).length;
  const satisfied = count('satisfied'), other = count('other_than_satisfied'), na = count('not_applicable');
  return { total: objectives.length, determined: satisfied + other + na, satisfied, other, na };
}

/** The word a status goes by: NIST's own findings for a control, the implementation level for a profile. */
export function statusWord(item: Pick<NistItem, 'assessment_data' | 'compliance_status'>): string {
  const d = item.assessment_data;
  if (isProfile(d)) return d.current ? IMPLEMENTATION_LABEL[d.current] : 'Not rated';
  switch (item.compliance_status) {
    case 'complied': return 'Satisfied';
    case 'not_complied': return 'Other than satisfied';
    case 'na': return 'Not applicable';
    default: return progressOf(item).determined > 0 ? 'In progress' : 'Not started';
  }
}

export function statusTone(item: Pick<NistItem, 'assessment_data' | 'compliance_status'>): Tone {
  switch (item.compliance_status) {
    case 'complied': return 'success';
    case 'not_complied': return 'danger';
    case 'partially_complied': return 'warning';
    case 'na': return 'neutral';
    default: return progressOf(item).determined > 0 || (isProfile(item.assessment_data) && !!item.assessment_data.current) ? 'progress' : 'pending';
  }
}

// ── the register ────────────────────────────────────────────────────────────────────────────────────────────────────
export type StatusFilter = 'all' | 'open' | 'complied' | 'not_complied' | 'partially_complied' | 'na';

const textOf = (item: NistItem): string => {
  const d = item.assessment_data;
  const inside = isControl(d) ? [d.title, ...d.objectives.map((o) => o.text)] : isProfile(d) ? [d.outcome, d.category_title ?? '', ...d.examples.map((e) => e.text)] : [];
  return [item.item_number, item.subdomain_name ?? '', item.control_description ?? '', ...inside].join(' ').toLowerCase();
};

export function filterItems(items: readonly NistItem[], f: { text: string; domain: string; status: StatusFilter }): NistItem[] {
  const q = f.text.trim().toLowerCase();
  return items.filter((i) => (!f.domain || i.area_domain === f.domain)
    && (f.status === 'all' || (f.status === 'open' ? i.compliance_status === 'in_progress' : i.compliance_status === f.status))
    && (!q || textOf(i).includes(q)));
}

export function domainsOf(items: readonly NistItem[]): Array<{ name: string; total: number; done: number }> {
  const out = new Map<string, { name: string; total: number; done: number }>();
  for (const i of items) {
    const d = out.get(i.area_domain) ?? { name: i.area_domain, total: 0, done: 0 };
    d.total += 1;
    d.done += i.compliance_status === 'in_progress' ? 0 : 1;
    out.set(i.area_domain, d);
  }
  return Array.from(out.values());
}

export interface Figures { total: number; complied: number; partial: number; notComplied: number; inProgress: number; na: number; decided: number; percent: number | null }

/** The header's figures: every item with a finding over all of them. Not applicable counts as decided (nothing is left to do on it). */
export function figuresOf(items: readonly NistItem[]): Figures {
  const n = (s: string) => items.filter((i) => i.compliance_status === s).length;
  const complied = n('complied'), partial = n('partially_complied'), notComplied = n('not_complied'), inProgress = items.length - complied - partial - notComplied - n('na'), na = n('na');
  const decided = items.length - inProgress;
  return { total: items.length, complied, partial, notComplied, inProgress, na, decided, percent: items.length > 0 ? Math.round((decided / items.length) * 100) : null };
}

// ── artifacts ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Artifact { key: string; method: string; text: string }

/** The assessment objects a control names, each with the key evidence is filed under (stored on the evidence link, at most 300 characters). */
export function artifactsOf(item: Pick<NistItem, 'assessment_data'>): Artifact[] {
  const d = item.assessment_data;
  if (isControl(d)) {
    return METHODS.flatMap((m) => (d.methods[m] ?? []).map((text) => ({ key: `${m} | ${text}`.slice(0, 300), method: m, text })));
  }
  if (isProfile(d)) return d.examples.map((e) => ({ key: `${e.id} | ${e.text}`.slice(0, 300), method: e.id, text: e.text }));
  return [];
}

// ── NIST's own documents for an assessment ──────────────────────────────────────────────────────────────────────────
/** The artifacts-catalog frameworks whose written documents belong to each NIST assessment. */
export const CATALOG_FRAMEWORKS: Record<string, readonly string[]> = { nist_800_53a: ['nist_sp_800_53_r5'], nist_csf2: ['nist_csf_2'] };

/**
 * What the NIST library offers one assessment: the publications that serve it (those with an official template first, in the library's order otherwise)
 * and the written documents of its framework in the artifacts catalog. The shapes are the library endpoint's (`GET /compliance/assessments/nist-library`).
 */
export function documentsFor<P extends { serves: string[]; templates: unknown[] }, R extends { framework_key: string }>(
  format: string, lib: { publications: P[]; catalog: R[] } | undefined,
): { publications: P[]; catalog: R[] } {
  if (!lib) return { publications: [], catalog: [] };
  const keys = CATALOG_FRAMEWORKS[format] ?? [];
  const publications = lib.publications.filter((p) => p.serves.includes(format)).sort((a, b) => Number(b.templates.length > 0) - Number(a.templates.length > 0));
  return { publications, catalog: lib.catalog.filter((d) => keys.includes(d.framework_key)) };
}

export interface EvidenceRow { id: number | string; evidence_id: number | null; evidence_name: string | null; evidence_file_name: string | null; artifact?: string | null; source?: string; approval_status?: string }

/** The evidence of an item by the artifact it answers: `whole` answers the control, the others a named object (key = the artifact key). */
export function evidenceByArtifact(rows: readonly EvidenceRow[]): { whole: EvidenceRow[]; by: Record<string, EvidenceRow[]> } {
  const whole: EvidenceRow[] = [];
  const by: Record<string, EvidenceRow[]> = {};
  for (const r of rows) {
    if (r.artifact) (by[r.artifact] ??= []).push(r);
    else whole.push(r);
  }
  return { whole, by };
}
