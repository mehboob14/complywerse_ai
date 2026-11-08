// A CSV file made in the browser from rows the person can see (RCSA "Export"): there is no export endpoint, and none is needed for what is already on the
// screen. Quotes are doubled, a cell is quoted when it holds a comma, a quote or a line break, and a cell that begins like a formula is made harmless so a
// spreadsheet never runs it (the same rule the change-log export follows).
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (FORMULA.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A file name for an export: "rcsa-findings-2026-11-08.csv". */
export function csvName(what: string, today: Date = new Date()): string {
  return `rcsa-${what}-${today.toISOString().slice(0, 10)}.csv`;
}
