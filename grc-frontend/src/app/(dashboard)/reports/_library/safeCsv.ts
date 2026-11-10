// A CSV file that is safe to open in a spreadsheet. A cell whose text begins with = + - @ (or a tab / carriage return) is read by Excel and Sheets as a FORMULA: a register's titles are typed by
// people, so "=HYPERLINK(...)" in a risk title would run when the file is opened. Such a text cell is written with a leading apostrophe, which the spreadsheet shows as plain text. A number that
// arrives as a number is not text (a -5 stays -5). Cells with a comma, a quote or a line break are quoted, quotes doubled. The file starts with a byte-order mark (Excel reads UTF-8 with it) and
// uses CRLF. Pure, so `node --test` pins it (safeCsv.test.ts). Used wherever the library writes a CSV.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toSafeCsv(header: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  const lines = [header].concat(rows as unknown[][]).map((r) => r.map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
