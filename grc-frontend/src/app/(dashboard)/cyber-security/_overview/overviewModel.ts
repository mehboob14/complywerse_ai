/**
 * What the Cyber Security Overview decides without a screen: which assessments it counts, the numbers of each type and of all of them, the status mix.
 * The definitions are the hub's own from before assessments were made per application or function, and they are NOT changed here:
 *   coverage  = every determination (not applicable included) over all the questions;
 *   compliant = complied over those determinations;
 *   open gaps = not complied + not yet answered.
 * Which assessments count (the started ones; the questionnaire only until one starts, or when someone answered it; never a draft) is the rule the server's
 * board applies too (`countedForOverview`).
 */
import { countedForOverview, inFlight, TYPE_INFO } from '../../../../components/compliance/scoping/scopingModel.ts';
import type { AssessmentRow } from '../../../../components/compliance/scoping/scopingApi.ts';

/** The types, in the order of their tabs. */
export const TYPE_FORMATS: readonly string[] = Object.keys(TYPE_INFO);

export interface Counts { total: number; complied: number; partial: number; notComplied: number; inProgress: number; na: number }

export interface TypeRow extends Counts {
  format: string;
  /** the hub tab that opens this type */
  tab: string;
  label: string;
  /** assessments that count (started ones, or the questionnaire while it is the only one) */
  assessments: number;
  /** drafts being scoped: they have no questions yet and count for nothing */
  drafts: number;
  /** drafts + started assessments with questions left (the in-flight list) */
  inFlight: number;
  /** complied + partial + not complied + not applicable */
  assessed: number;
  /** percent, or null when there are no questions */
  coverage: number | null;
  /** percent, or null when nothing is assessed */
  compliant: number | null;
  gaps: number;
}

const share = (n: number, of: number): number | null => (of > 0 ? Math.round((n / of) * 100) : null);
const sum = (rows: readonly AssessmentRow[], pick: (r: AssessmentRow) => number | null): number => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);

export function countsOf(rows: readonly AssessmentRow[]): Counts {
  const complied = sum(rows, (r) => r.complied_count);
  const partial = sum(rows, (r) => r.partially_complied_count);
  const notComplied = sum(rows, (r) => r.not_complied_count);
  const inProgress = sum(rows, (r) => r.in_progress_count);
  const na = sum(rows, (r) => r.na_count);
  return { total: sum(rows, (r) => r.total_items) || complied + partial + notComplied + inProgress + na, complied, partial, notComplied, inProgress, na };
}

export function typeRow(format: string, list: readonly AssessmentRow[]): TypeRow {
  const info = TYPE_INFO[format];
  const mine = list.filter((a) => a.assessment_format === format);
  const c = countsOf(countedForOverview(mine));
  const assessed = c.complied + c.partial + c.notComplied + c.na;
  return {
    ...c, format, tab: info.tab, label: info.label,
    assessments: countedForOverview(mine).length,
    drafts: mine.filter((a) => !!a.scope_model && a.phase === 'scoping').length,
    inFlight: mine.filter(inFlight).length,
    assessed, coverage: share(assessed, c.total), compliant: share(c.complied, assessed), gaps: c.notComplied + c.inProgress,
  };
}

export const typeRows = (list: readonly AssessmentRow[]): TypeRow[] => TYPE_FORMATS.map((f) => typeRow(f, list));

export interface Totals extends Counts {
  assessments: number;
  drafts: number;
  inFlight: number;
  /** the types with at least one assessment that counts */
  typesStarted: number;
  assessed: number;
  coverage: number | null;
  compliant: number | null;
  gaps: number;
}

export function totalsOf(rows: readonly TypeRow[]): Totals {
  const add = (pick: (r: TypeRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const c: Counts = { total: add((r) => r.total), complied: add((r) => r.complied), partial: add((r) => r.partial), notComplied: add((r) => r.notComplied), inProgress: add((r) => r.inProgress), na: add((r) => r.na) };
  const assessed = c.complied + c.partial + c.notComplied + c.na;
  return {
    ...c, assessed,
    assessments: add((r) => r.assessments), drafts: add((r) => r.drafts), inFlight: add((r) => r.inFlight), typesStarted: rows.filter((r) => r.assessments > 0).length,
    coverage: share(assessed, c.total), compliant: share(c.complied, assessed), gaps: c.notComplied + c.inProgress,
  };
}

export type MixKey = 'complied' | 'partial' | 'notComplied' | 'inProgress' | 'na';
export const MIX: ReadonlyArray<{ key: MixKey; label: string; fill: string }> = [
  { key: 'complied', label: 'Complied', fill: 'bg-ds-success' },
  { key: 'partial', label: 'Partial', fill: 'bg-ds-warning' },
  { key: 'notComplied', label: 'Not complied', fill: 'bg-ds-danger' },
  { key: 'inProgress', label: 'Not answered yet', fill: 'bg-ds-primary' },
  { key: 'na', label: 'Not applicable', fill: 'bg-ds-border-strong' },
];

/** The segments of the status bar: what each is, how many, how wide (a share of the bar); segments with nothing in them are left out. */
export function statusMix(c: Counts): Array<{ key: MixKey; label: string; fill: string; n: number; percent: number }> {
  const all = c.complied + c.partial + c.notComplied + c.inProgress + c.na;
  return MIX.filter((m) => c[m.key] > 0).map((m) => ({ ...m, n: c[m.key], percent: all > 0 ? (c[m.key] / all) * 100 : 0 }));
}

/** The in-flight count of each hub tab, for the badges on the tab strip (a type with nothing in flight has none). */
export function inFlightByTab(list: readonly AssessmentRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of TYPE_FORMATS) {
    const n = list.filter((a) => a.assessment_format === f && inFlight(a)).length;
    if (n > 0) out[TYPE_INFO[f].tab] = n;
  }
  return out;
}
