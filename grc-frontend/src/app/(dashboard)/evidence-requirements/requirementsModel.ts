// The rules of the Evidence Requirements catalogue, apart from React so `node --test` can pin them (requirementsModel.test.ts): what a filter keeps, the
// tiles, the label of a control, the steps a requirement can take, how it is told. The formulas that moved here from page.tsx are compared with a frozen
// copy of the old code in the test.
import { formatCount } from '../../../lib/format.ts';

export interface Requirement {
  id: number;
  parsed_control_id: number;
  evidence_title: string;
  evidence_description: string | null;
  evidence_type: string;
  evidence_format: string | null;
  exact_requirements: string[] | null;
  acceptance_criteria: string[] | null;
  sample_evidence: string | null;
  collection_guidance: string | null;
  collection_frequency: string | null;
  retention_period: string | null;
  priority: string;
  is_mandatory: boolean;
  status: string;
  ai_confidence: number | null;
  ai_reasoning?: string | null;
  created_at: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  rejection_reason?: string | null;
  /** the control's own id and title, which the list answer carries for every requirement */
  control_id?: string | null;
  control_title?: string | null;
}

export interface ParsedControl {
  id: number;
  control_id: string;
  title: string;
  original_reference: string | null;
}

export interface Catalogue {
  framework_id: number;
  framework_name: string;
  total: number;
  status_counts: Record<string, number>;
  requirements: Requirement[];
}

export const REQUIREMENT_STATUSES = ['draft', 'submitted', 'pending_review', 'approved', 'rejected'] as const;
export const PRIORITIES = ['high', 'medium', 'low'] as const;

// ── the label of a control ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the Control column says: the reference as the framework prints it, else the control's id, else the id the requirement itself carries, else the number.
 *  The title likewise. (The parsed-controls list used to be the only source, so a control past its 1,000th read "Control #id" / "Unknown Control".) */
export function controlLabel(req: Pick<Requirement, 'parsed_control_id' | 'control_id' | 'control_title'>, control: ParsedControl | undefined): { reference: string; title: string } {
  return {
    reference: control?.original_reference || control?.control_id || req.control_id || `Control #${req.parsed_control_id}`,
    title: control?.title || req.control_title || 'Unknown control',
  };
}

// ── the filter ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CatalogueFilters {
  q: string;
  status: readonly string[];
  priority: readonly string[];
  types: readonly string[];
}
export const NO_FILTERS: CatalogueFilters = { q: '', status: [], priority: [], types: [] };
export const isFiltered = (f: CatalogueFilters): boolean => f.q.trim() !== '' || f.status.length > 0 || f.priority.length > 0 || f.types.length > 0;

/** Whether a requirement matches the search: its title, or the control's id, reference or title. (The old search read the control's id, or its reference
 *  only when the id was empty, so "Article 2", the text the Control column shows, found nothing.) */
export function matchesSearch(req: Requirement, control: ParsedControl | undefined, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  const label = controlLabel(req, control);
  return [req.evidence_title, control?.control_id, control?.original_reference, req.control_id, label.reference, label.title]
    .some((text) => !!text && text.toLowerCase().includes(term));
}

/** The requirements that pass the three choices and the search, in the server's order. Filtering runs on the whole framework, loaded once. */
export function filterRequirements(rows: readonly Requirement[], f: CatalogueFilters, controls: ReadonlyMap<number, ParsedControl>): Requirement[] {
  return rows.filter((r) => {
    if (f.status.length > 0 && !f.status.includes(r.status)) return false;
    if (f.priority.length > 0 && !f.priority.includes(r.priority)) return false;
    if (f.types.length > 0 && !f.types.includes(r.evidence_type)) return false;
    return matchesSearch(r, controls.get(r.parsed_control_id), f.q);
  });
}

/** The Type filter's choices: the types the requirements have, most common first (the old list was fixed and lacked "document", a third of all rows). */
export function typeChoices(rows: readonly Requirement[]): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  rows.forEach((r) => { if (r.evidence_type) counts.set(r.evidence_type, (counts.get(r.evidence_type) ?? 0) + 1); });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: readable(value), count }));
}

/** "on-change" -> "On change", "annually" -> "Annually": the stored word, read as words. */
export function readable(word: string | null | undefined): string {
  const text = (word ?? '').replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

// ── the tiles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CatalogueTiles { total: number; draft: number; inReview: number; approved: number; rejected: number }
/** The framework's own counts, whatever the filters say (the old Total tile followed the filters while the others did not). `inReview` is submitted plus
 *  pending review, as before; rejected was missing, so the tiles did not add up. */
export function catalogueTiles(counts: Record<string, number> | undefined, total: number | undefined): CatalogueTiles {
  const c = counts ?? {};
  return {
    total: total ?? Object.values(c).reduce((s, n) => s + n, 0),
    draft: c.draft ?? 0,
    inReview: (c.submitted ?? 0) + (c.pending_review ?? 0),
    approved: c.approved ?? 0,
    rejected: c.rejected ?? 0,
  };
}

// ── the steps ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type StepKey = 'submit' | 'review' | 'approve' | 'reject';
export interface Step { key: StepKey; label: string; /** said after the server answers */ done: string; /** the failure's headline */ failed: string }

/** What a person who may edit can do to a requirement in each state (the server accepts approve and reject from "submitted" too; the page has only ever
 *  offered them after the review has started). A requirement that is approved or rejected has no step. */
export function stepsFor(status: string, canEdit: boolean): Step[] {
  if (!canEdit) return [];
  switch (status) {
    case 'draft': return [{ key: 'submit', label: 'Submit', done: 'submitted for review', failed: "Couldn't submit" }];
    case 'submitted': return [{ key: 'review', label: 'Start review', done: 'is now being reviewed', failed: "Couldn't start the review of" }];
    case 'pending_review': return [
      { key: 'approve', label: 'Approve', done: 'approved', failed: "Couldn't approve" },
      { key: 'reject', label: 'Reject', done: 'rejected', failed: "Couldn't reject" },
    ];
    default: return [];
  }
}

// ── words ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** What the server answers to a step (`status` and the moment it happened; a rejection also echoes its reason). */
export interface StepAnswer { status?: string; submitted_at?: string | null; reviewed_at?: string | null; approved_at?: string | null; rejection_reason?: string | null }

const NEXT: Record<StepKey, string> = { submit: 'submitted', review: 'pending_review', approve: 'approved', reject: 'rejected' };

/** The loaded catalogue after a step the server has confirmed: the one requirement takes the status and the moments the server answered with (else the
 *  step's own next status), and the framework's counts follow it. The page then does not ask the server for the whole framework again after every click
 *  (for the largest it is three requests of 500). Everything else is as it was; an id that is not in the catalogue changes nothing. */
export function applyStep(cat: Catalogue, id: number, key: StepKey, answer: StepAnswer): Catalogue {
  const row = cat.requirements.find((r) => r.id === id);
  if (!row) return cat;
  const next = answer.status || NEXT[key];
  const counts = { ...cat.status_counts };
  if (row.status !== next) {
    counts[row.status] = Math.max(0, (counts[row.status] ?? 0) - 1);
    counts[next] = (counts[next] ?? 0) + 1;
  }
  const changed: Requirement = {
    ...row,
    status: next,
    submitted_at: answer.submitted_at ?? row.submitted_at,
    reviewed_at: answer.reviewed_at ?? row.reviewed_at,
    approved_at: answer.approved_at ?? row.approved_at,
    rejection_reason: key === 'reject' ? (answer.rejection_reason ?? row.rejection_reason ?? null) : row.rejection_reason,
  };
  return { ...cat, status_counts: counts, requirements: cat.requirements.map((r) => (r.id === id ? changed : r)) };
}

/** The file format as the page has always said it: the office and PDF formats are "Document", anything else as stored. */
export function formatLabel(format: string | null | undefined): string {
  if (!format) return '';
  const fmt = format.toString().toLowerCase().replace(/^\./, '');
  return ['pdf', 'doc', 'docx', 'docs', 'xls', 'xlsx'].includes(fmt) ? 'Document' : format;
}

export type ConfidenceWord = 'high' | 'medium' | 'low';
/** The AI's confidence in a requirement: 80% and over is high, 50% and over medium (the colours the page always used). null when there is none. */
export function confidenceOf(c: number | null | undefined): { pct: number; word: ConfidenceWord } | null {
  if (c == null) return null;
  return { pct: Math.round(c * 100), word: c >= 0.8 ? 'high' : c >= 0.5 ? 'medium' : 'low' };
}

/** "3 of 64 requirements" under the table: the true count of the framework against what the filters keep. */
export function countLine(shown: number, total: number): string {
  return shown === total ? `${formatCount(total)} requirement${total === 1 ? '' : 's'}` : `${formatCount(shown)} of ${formatCount(total)} requirements`;
}

/** The follow-up requests for a list answered a page at a time: the `skip` of each page still to fetch, so a framework of any size is whole. A page cap
 *  stops a server that keeps answering short pages from looping for ever (ceiling: `maxPages` pages). */
export function nextSkips(have: number, total: number, pageSize: number, maxPages = 60): number[] {
  const out: number[] = [];
  for (let skip = have; skip < total && out.length < maxPages; skip += Math.max(1, pageSize)) out.push(skip);
  return out;
}
