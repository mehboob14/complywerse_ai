// The file a library download writes, as pure functions (fileModel.test.ts): its name and what the download says when it finishes. The rows come from the same pipeline the builder, the
// print view and the dashboard tiles use (reportData.ts); this file only decides the words.
import { formatCount } from '../../../../lib/format.ts';
import type { Coverage } from '../_reports/rowCoverage.ts';

export type FileFormat = 'csv' | 'excel' | 'word' | 'pdf';
export const FORMAT_LABEL: Record<FileFormat, string> = { csv: 'CSV', excel: 'Excel', word: 'Word', pdf: 'PDF' };
export const FORMATS: readonly FileFormat[] = ['csv', 'excel', 'word', 'pdf'];
const EXT: Record<FileFormat, string> = { csv: 'csv', excel: 'xlsx', word: 'docx', pdf: 'pdf' };

/** The name of a file for a report: no character a file name cannot hold, no dots or spaces at the ends, 80 characters at most ("Report" when nothing is left). The caller adds the extension. */
export function fileBase(name: string, day: string): string {
  const clean = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 80).trim() || 'Report';
  return `${clean} ${day}`;
}
export const fileName = (name: string, format: FileFormat, day: string): string => `${fileBase(name, day)}.${EXT[format]}`;

/** What a finished download says: the report, the format and how many rows are in the file; when the data is partial, that comes second as a warning. */
export function downloadWords(name: string, format: FileFormat, rows: number, coverage: Coverage): { title: string; message: string; partial: boolean } {
  const title = format === 'pdf' ? 'Opened for printing' : `${FORMAT_LABEL[format]} file ready`;
  const base = format === 'pdf' ? `“${name}” opened in a new tab; choose Save as PDF there.` : `“${name}”: ${formatCount(rows)} ${rows === 1 ? 'row' : 'rows'}.`;
  return { title, message: coverage.partial ? `${base} ${coverage.text}` : base, partial: coverage.partial };
}
