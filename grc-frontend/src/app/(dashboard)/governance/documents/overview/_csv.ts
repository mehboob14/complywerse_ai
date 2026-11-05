// CSV text for an export, without React so it can be tested (_csv.test.ts). Excel opens a CSV with a byte-order mark as UTF-8; a cell that starts
// with = + - @ (or a tab or return) would be run as a formula by a spreadsheet, so a text cell like that is written with a ' in front.
export type CsvCell = string | number | null | undefined;

export function csvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  const safe = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The file text: the rows, CRLF between them, with the byte-order mark in front. */
export const csvText = (rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string => `\ufeff${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** "at-a-glance-operations-2026-11-05.csv": a file name from what it is about and the day; nothing usable in the name is "export". */
export function csvName(what: string, scope: string, day: Date = new Date()): string {
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return `${[slug(what), slug(scope)].filter(Boolean).join('-') || 'export'}-${date}.csv`;
}
