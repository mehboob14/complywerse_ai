// The text of a report's CSV file, as a pure function (csvReport.test.ts): the same cells the table, the Excel sheet and the Word table show (a number column keeps its numbers, the rest is the
// text the person reads), written by the escaping writer in _library/safeCsv.ts so a title that begins with = + - @ is never run as a formula when the file is opened in a spreadsheet.
import type { ColumnDef, Row } from './types';
import { displayText, rawValue } from './grid-utils.ts';
import { toSafeCsv } from '../_library/safeCsv.ts';

export function reportCsv(cols: readonly ColumnDef[], rows: readonly Row[]): string {
  const body = rows.map((row) => cols.map((c) => {
    const raw = rawValue(c, row);
    return c.type === 'number' && raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : displayText(c, row);
  }));
  return toSafeCsv(cols.map((c) => c.label), body);
}
