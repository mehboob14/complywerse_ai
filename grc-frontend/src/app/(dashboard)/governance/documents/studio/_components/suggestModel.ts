/**
 * The "From a framework" tab of the New document popup, apart from React so it can be tested: the types the suggestions can be asked for (every one
 * the studio can write in full), the order and filter of the list (what matters most first), the suggestions left out because the organisation
 * already has the document or is writing it (and where to find it), and the body that makes a suggested document and starts writing it.
 */
import type { FromSuggestionBody, LeftOut, SuggestedDoc, SuggestionResult } from '@/lib/studio/api';

/** The types a suggestion can be for, and that the studio writes in full (a policy, standard, procedure, guideline or charter). `''` is every type. */
export const SUGGEST_TYPES: readonly { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'policy', label: 'Policy' },
  { value: 'standard', label: 'Standard' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'guideline', label: 'Guideline' },
  { value: 'charter', label: 'Charter' },
];

/** The types the "Type" field of the create form offers: the same, without "All". */
export const WRITABLE_TYPES: [string, string][] = SUGGEST_TYPES.filter((t) => t.value).map((t) => [t.value, t.label]);

/** What a document made from a suggestion is written as, said on the form. */
export const LENGTH_NOTE = 'Comply Agent writes the whole document, about 4 to 8 pages. It opens in the studio as a draft, ready to read and change; move it to the library when it is ready.';

const PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2 };
export const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** Most important first, then by title; a suggestion without a title is dropped. */
export function sortSuggestions(items: SuggestedDoc[]): SuggestedDoc[] {
  return items
    .filter((s) => (s.title ?? '').trim())
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (PRIORITY[a.s.priority] ?? 3) - (PRIORITY[b.s.priority] ?? 3) || a.s.title.localeCompare(b.s.title) || a.i - b.i)
    .map((x) => x.s);
}

/** The suggestions of one type (every type: `''`) that contain the words typed, in the title, description or a control reference. */
export function shown(items: SuggestedDoc[], type: string, query: string): SuggestedDoc[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((s) => {
    if (type && s.doc_type !== type) return false;
    const hay = `${s.title} ${s.description} ${(s.relevant_controls ?? []).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** How many suggestions are of each type, for the filter's counts. */
export function countByType(items: SuggestedDoc[]): Record<string, number> {
  const out: Record<string, number> = { '': items.length };
  for (const s of items) out[s.doc_type] = (out[s.doc_type] ?? 0) + 1;
  return out;
}

const MATCH_WORDS: Record<LeftOut['match_type'], string> = { exact_normalized: 'Same title', token_overlap: 'Similar title', semantic: 'Same subject' };

export interface Covered {
  key: string;
  /** the suggestion that was left out, or none for a document that is simply already there */
  suggested: string | null;
  title: string;
  /** "Draft", "Approved", "Being written in the studio" ... */
  status: string;
  /** where the document is: its library page, or the studio draft */
  href: string | null;
  how: string;
}

const STATUS_WORDS: Record<string, string> = {
  studio_draft: 'Being written in the studio', draft: 'Draft', pending_review: 'In review', pending_approval: 'Awaiting approval', approved: 'Approved', published: 'Published',
};
export const statusWords = (s: string | null | undefined) => (s ? STATUS_WORDS[s] ?? s.replace(/_/g, ' ') : '');

export function hrefOf(m: { id?: number | null; matched_existing_id?: number | null; session_id?: number | null; matched_session_id?: number | null }): string | null {
  const doc = m.matched_existing_id ?? m.id;
  const session = m.matched_session_id ?? m.session_id;
  return doc ? `/governance/documents/${doc}` : session ? `/governance/documents/studio/${session}` : null;
}

/** Everything the suggestions left out, first what was skipped and the document that justified it, then the other documents already there. */
export function leftOut(result: Pick<SuggestionResult, 'skipped_matches' | 'already_covered'> | null | undefined): Covered[] {
  if (!result) return [];
  const skipped: Covered[] = (result.skipped_matches ?? []).filter((m) => m.suggested_title && m.matched_existing_title).map((m, i) => ({
    key: `skip-${i}`, suggested: m.suggested_title, title: m.matched_existing_title as string, status: statusWords(m.matched_existing_status),
    href: hrefOf(m), how: MATCH_WORDS[m.match_type] ?? 'Already covered',
  }));
  const justified = new Set(skipped.map((c) => c.title.toLowerCase()));
  const others: Covered[] = (result.already_covered ?? []).filter((d) => d.title && !justified.has(d.title.toLowerCase())).map((d, i) => ({
    key: `have-${i}`, suggested: null, title: d.title, status: statusWords(d.status), href: hrefOf(d), how: 'Already there',
  }));
  return [...skipped, ...others];
}

export interface CreateForm {
  title: string;
  doc_type: string;
  description: string;
  owner_id: number | null;
  department_id: number | null;
  parent_document_id: number | null;
  classification: string;
  review_cycle_months: number;
  effective_date: string;
  next_review_date: string;
}

type Participants = NonNullable<FromSuggestionBody['signoff']>;

/** The body that makes the document: the title, type and description as the person left them (Comply Agent filled them from the suggestion), the frameworks it
 *  was suggested for, the controls it answers, and what only the person knows (owner, department, parent document, classification, review cycle, dates,
 *  reviewers, approvers). */
export function createBody(form: CreateForm, suggestion: Pick<SuggestedDoc, 'relevant_controls'>, frameworkIds: number[], signoff?: Participants): FromSuggestionBody {
  const details: Record<string, string | number> = {};
  if (form.owner_id != null) details.owner_id = form.owner_id;
  if (form.department_id != null) details.department_id = form.department_id;
  if (form.classification) details.classification = form.classification;
  if (form.review_cycle_months) details.review_cycle_months = form.review_cycle_months;
  if (form.effective_date) details.effective_date = form.effective_date;
  if (form.next_review_date) details.next_review_date = form.next_review_date;
  const body: FromSuggestionBody = {
    title: form.title.trim(), doc_type: form.doc_type, description: form.description.trim(), framework_ids: Array.from(new Set(frameworkIds)),
    controls: (suggestion.relevant_controls ?? []).filter(Boolean).slice(0, 12), details,
  };
  if (form.parent_document_id != null) body.parent_document_id = form.parent_document_id;
  if (signoff && (signoff.reviewers.length || signoff.approvers.length)) body.signoff = signoff;
  return body;
}

/** What the library document starts with when it was made from a suggestion: the details the person typed (kept in the session's instructions). */
export function detailsOfSession(instructions: Record<string, unknown> | null | undefined): Partial<CreateForm> {
  const d = (instructions?.details ?? {}) as Record<string, unknown>;
  const out: Partial<CreateForm> = {};
  if (typeof d.owner_id === 'number') out.owner_id = d.owner_id;
  if (typeof d.department_id === 'number') out.department_id = d.department_id;
  if (typeof d.review_cycle_months === 'number') out.review_cycle_months = d.review_cycle_months;
  if (typeof d.classification === 'string' && d.classification) out.classification = d.classification;
  if (typeof d.effective_date === 'string' && d.effective_date) out.effective_date = d.effective_date;
  if (typeof d.next_review_date === 'string' && d.next_review_date) out.next_review_date = d.next_review_date;
  if (typeof d.description === 'string' && d.description) out.description = d.description;
  return out;
}
