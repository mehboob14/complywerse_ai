// What the Audit periods page decides, apart from React so `node --test` pins it (periodsModel.test.ts): the periods in the order a person looks for them, what can still be done to a period, what the
// create form must say before it is sent, the words about a period's statement, and the name of a downloaded Statement of Applicability. The rules are the server's (scf/router.py: a closed period
// cannot be frozen; freezing keeps the status and saves the statement; closing is for good); nothing here adds a rule.
import { formatDate } from '../../../../../lib/format.ts';

export interface Period {
  id: number;
  name: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  frozen_at?: string | null;
  has_soa_snapshot?: boolean;
}

export type SoaFormat = 'json' | 'oscal' | 'xlsx';
export const SOA_FORMATS: ReadonlyArray<{ value: SoaFormat; label: string; hint: string }> = [
  { value: 'xlsx', label: 'Excel', hint: 'A spreadsheet an auditor can open' },
  { value: 'json', label: 'JSON', hint: 'The statement as data' },
  { value: 'oscal', label: 'OSCAL', hint: 'The statement in the OSCAL standard' },
];

/** Open and in-fieldwork periods first (they are the ones under audit), the latest end first; closed ones after them, the latest first. */
export function orderedPeriods(periods: readonly Period[]): Period[] {
  const live = (p: Period) => (p.status === 'closed' ? 1 : 0);
  return periods.slice().sort((a, b) => live(a) - live(b) || (b.period_end ?? '').localeCompare(a.period_end ?? '') || b.id - a.id);
}

export const canFreeze = (p: Period): boolean => p.status !== 'closed';
export const canClose = (p: Period): boolean => p.status !== 'closed';
export const isFrozen = (p: Period): boolean => !!p.has_soa_snapshot;

/** "12 Nov 2026 to 11 Nov 2027": a period is a span of days, so the dates keep their calendar day whatever the viewer's zone. */
export function spanOf(p: Pick<Period, 'period_start' | 'period_end'>): string {
  return `${formatDate(p.period_start, { calendar: true })} to ${formatDate(p.period_end, { calendar: true })}`;
}

/** What a period says about its statement: not frozen yet, or frozen on a day. */
export function statementWords(p: Period): string {
  if (!isFrozen(p)) return 'Statement not frozen yet';
  return p.frozen_at ? `Statement frozen ${formatDate(p.frozen_at)}` : 'Statement frozen';
}

export interface Draft { name: string; start: string; end: string }
export interface DraftErrors { name?: string; start?: string; end?: string }
export const NAME_MAX = 255;

/** What the create form must say before anything is sent: a name, both dates, and an end that is not before the start. */
export function draftErrors(d: Draft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.name.trim()) e.name = 'Give the period a name.';
  else if (d.name.trim().length > NAME_MAX) e.name = `Keep the name under ${NAME_MAX} characters.`;
  if (!d.start) e.start = 'Choose the first day.';
  if (!d.end) e.end = 'Choose the last day.';
  else if (d.start && d.end < d.start) e.end = 'The last day cannot be before the first.';
  return e;
}
export const hasErrors = (e: DraftErrors): boolean => Object.keys(e).length > 0;

/** The file a Statement of Applicability is saved as: the live statement, or a period's frozen one. A spreadsheet the server sent as text reads `.csv`. */
export function soaFileName(format: SoaFormat, periodId: number | null, mime = ''): string {
  const stamp = periodId != null ? `period-${periodId}` : 'live';
  if (format === 'xlsx') return `soa-${stamp}.${mime.includes('csv') ? 'csv' : 'xlsx'}`;
  return `soa-${stamp}.${format === 'oscal' ? 'oscal.json' : 'json'}`;
}

/** The share a framework figure shows: a number or a dash, never "NaN%". */
export const pctWords = (v: number | null | undefined): string => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v)}%`);
