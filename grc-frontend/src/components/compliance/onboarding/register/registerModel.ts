/**
 * What the onboarding register decides without a server or a screen: the quick filters and their counts, the filter by family and by name, the one action of
 * a row, the words of its progress and of its journey. The state of a framework (not started, draft, ready, complete, underway) is the server's; this only
 * arranges its answer.
 */
import type { OnboardingState, RegisterRow } from '@/lib/frameworkOnboarding';
import type { Tone } from '@/lib/status';

export const STATE_ORDER: readonly OnboardingState[] = ['not_started', 'draft', 'ready', 'complete', 'underway'];
/** `needs_review` is not a state: it keeps the rows whose framework changed since they were approved (the last version check). */
export type StateFilter = 'all' | OnboardingState | 'needs_review';
export const STATE_FILTERS: readonly StateFilter[] = ['all', ...STATE_ORDER, 'needs_review'];

/** The word on each quick filter (the same words as the state pills; this file reads no value from the api module, so the node tests can load it). */
export const FILTER_LABEL: Record<StateFilter, string> = {
  all: 'All', not_started: 'Not started', draft: 'Draft', ready: 'Ready', complete: 'Complete', underway: 'Underway', needs_review: 'Needs review',
};

/** The quick filters to draw: every state, and "Needs review" only when some row needs it (or it is the one chosen, so a link to it never hides its own chip). */
export const visibleFilters = (counts: Record<StateFilter, number>, current: StateFilter): StateFilter[] =>
  STATE_FILTERS.filter((s) => s !== 'needs_review' || counts.needs_review > 0 || current === 'needs_review');

/** The tone of each state's pill (the word is always drawn as well). */
export const STATE_TONE: Record<OnboardingState, Tone> = {
  not_started: 'neutral', draft: 'pending', ready: 'progress', complete: 'success', underway: 'warning',
};

export interface RegisterFilter { state: StateFilter; family: string; q: string }

const matchesText = (row: RegisterRow, q: string): boolean =>
  !q || [row.label, row.name, row.family_label ?? ''].some((s) => s.toLowerCase().includes(q));

/** The rows that pass the filter. `family` is a family key ('' for all). */
export function filterRows(rows: readonly RegisterRow[], f: RegisterFilter): RegisterRow[] {
  const q = f.q.trim().toLowerCase();
  const stateOk = (r: RegisterRow): boolean => (f.state === 'all' || (f.state === 'needs_review' ? r.review?.state === 'needs_review' : r.state === f.state));
  return rows.filter((r) => stateOk(r) && (!f.family || r.family === f.family) && matchesText(r, q));
}

/** How many rows each quick filter would show, given the family and the text (so the number on a chip is what pressing it shows). */
export function countsOf(rows: readonly RegisterRow[], f: Pick<RegisterFilter, 'family' | 'q'>): Record<StateFilter, number> {
  const base = filterRows(rows, { ...f, state: 'all' });
  const out: Record<StateFilter, number> = { all: base.length, not_started: 0, draft: 0, ready: 0, complete: 0, underway: 0, needs_review: 0 };
  for (const r of base) {
    out[r.state] += 1;
    if (r.review?.state === 'needs_review') out.needs_review += 1;
  }
  return out;
}

export interface FamilyOption { key: string; label: string; count: number }

/** The families present in the register, by name; the general family (custom frameworks) last. */
export function familiesOf(rows: readonly RegisterRow[]): FamilyOption[] {
  const seen = new Map<string, FamilyOption>();
  for (const r of rows) {
    const cur = seen.get(r.family);
    if (cur) cur.count += 1;
    else seen.set(r.family, { key: r.family, label: r.family_label || r.family, count: 1 });
  }
  return Array.from(seen.values()).sort((a, b) => Number(a.key === 'general') - Number(b.key === 'general') || a.label.localeCompare(b.label));
}

/** A family key from the address that the register does not have is no filter at all (a link can never show an empty page for it). */
export const knownFamily = (rows: readonly RegisterRow[], key: string): string => (key && rows.some((r) => r.family === key) ? key : '');

export interface RowAction { label: 'Start' | 'Continue' | 'Open'; starts: boolean }

/** The one action of a row: Start when there is no onboarding yet, Continue while it is a draft, Open otherwise (ready, complete, underway). */
export function actionOf(row: Pick<RegisterRow, 'state'>): RowAction {
  if (row.state === 'not_started') return { label: 'Start', starts: true };
  return { label: row.state === 'draft' ? 'Continue' : 'Open', starts: false };
}

/** Where a row's onboarding is (a framework that has none has no page yet). */
export const workspaceHref = (onboardingId: number): string => `/frameworks/onboarding/${onboardingId}`;

/** "12 of 30"; a dash while there is no onboarding; "Nothing required" when the framework asks for nothing. */
export function progressWords(p: RegisterRow['progress']): string {
  if (!p) return '—';
  return p.total > 0 ? `${p.done} of ${p.total}` : 'Nothing required';
}

/** The bar's percent; null when there is no onboarding (a bar of 0% would say a started one is empty). */
export function progressPercent(p: RegisterRow['progress']): number | null {
  if (!p) return null;
  return p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 100;
}

const JOURNEY_WORDS: Record<string, string> = { in_progress: 'In progress', not_started: 'Not started', on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled' };

/** What the register says of a row's journey: the status in words, or "No journey". */
export function journeyWords(j: RegisterRow['journey']): string {
  if (!j) return 'No journey';
  const word = JOURNEY_WORDS[j.status];
  if (word) return word;
  const plain = j.status.replace(/[_-]+/g, ' ').trim();
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : 'Started';
}

/** The small line under an underway pill: why it is running (the kind chosen, or that it was running before onboarding existed). */
export function underwayWords(u: RegisterRow['underway']): string {
  if (!u) return '';
  return u.legacy ? 'Journey existed before onboarding' : u.kind ?? '';
}

/** What a register column sorts by. */
export function sortValue(row: RegisterRow, key: string): string | number | null {
  switch (key) {
    case 'name': return row.label.toLowerCase();
    case 'family': return (row.family_label || row.family).toLowerCase();
    case 'state': return STATE_ORDER.indexOf(row.state);
    case 'progress': return progressPercent(row.progress);
    case 'journey': return row.journey ? 1 : 0;
    default: return row.updated_at;
  }
}

/** Words for an onboarding that could not be started (the server's refusal, in plain words). */
export function startRefusalWords(status: number | null, message: string): string {
  if (status === 403) return 'You need the right to edit frameworks to start an onboarding. Ask an administrator.';
  if (status === 404) return 'This framework is no longer in the library.';
  return message;
}
