// What the workspace tells a person about the data behind the table, as pure functions (notices.test.ts): the rows are only part of the register (P-R4 / P-R5), the server could not apply a filter
// or a calculation so the result is wider than the chips say (P-R6), the server could not total a summary so the browser did (the audit's silent fallback). The sentences are plain words: no field
// key, no reason code, no endpoint. coverage() (the numbers) is _reports/rowCoverage.ts, shared with the library's download and the dashboard tiles.
import type { SkippedFilter } from '../../_reports/types.ts';
import { opLabel } from './builderModel.ts';

const REASON_WORDS: Record<string, string> = {
  unknown_column: 'this field cannot be filtered on the server',
  unsupported_operator: 'this kind of condition cannot be applied on the server',
  invalid_value: 'its value could not be read',
};

export interface AggregateWarnings { skipped_filters?: SkippedFilter[]; skipped_measures?: string[]; skipped_group_by?: string[] }

/** The filters the server skipped, as sentences. A gap filter ("nothing linked") is left out: when the server cannot answer it the browser checks the rows itself, so the result is right. */
export function skippedFilterLines(skipped: readonly SkippedFilter[] | undefined | null, labelOf: (key: string) => string): string[] {
  return (skipped ?? [])
    .filter((f) => !f.col.startsWith('linkpresence_'))
    .map((f) => `${labelOf(f.col)} ${opLabel(f.op)}: ${REASON_WORDS[f.reason] ?? 'it could not be applied'}, so the rows are not narrowed by it.`);
}

/** Everything a server summary left out: filters, breakdown fields and calculations, in the order a person set them up. */
export function summaryWarningLines(w: AggregateWarnings | undefined | null, labelOf: (key: string) => string): string[] {
  const lines = skippedFilterLines(w?.skipped_filters, labelOf);
  (w?.skipped_group_by ?? []).forEach((k) => lines.push(`The summary was not broken down by ${labelOf(k)}: the server cannot group on it.`));
  const n = w?.skipped_measures?.length ?? 0;
  if (n > 0) lines.push(`${n} ${n === 1 ? 'calculation was' : 'calculations were'} left out of the summary: the server cannot work ${n === 1 ? 'it' : 'them'} out.`);
  return lines;
}

/** The sentence for a summary the browser worked out because the server could not (it totals the rows that were loaded, which may be only part of the register: the partial-data notice then says so). */
export const AGGREGATE_FALLBACK = 'The server could not work out this summary, so it was calculated here from the rows that were loaded.';

export function notice(title: string, lines: readonly string[]): { title: string; lines: string[] } | null {
  return lines.length ? { title, lines: [...lines] } : null;
}
