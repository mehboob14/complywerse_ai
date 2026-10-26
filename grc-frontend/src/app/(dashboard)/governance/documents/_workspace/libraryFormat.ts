// Small words for the library's cells and drawer: how long ago, what kind of file, how big, how often a review comes round.
// Pure, so `node --test` runs libraryFormat.test.ts against it.
import { parseUtc } from '../../../../../lib/serverTime.ts';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date ("12 Oct 2026"). A time in the future (a clock a little ahead) is "just now". */
export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
  const at = parseUtc(value);
  if (!at) return '';
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} d ago` : dateFmt.format(at);
}

export type FileKind = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'text' | 'other';

/** The kind of file a document carries, from its type or name; null when it has none (a document written on the platform). */
export function fileKind(doc: { has_file?: boolean; file_type?: string | null; file_name?: string | null }): FileKind | null {
  if (doc.has_file === false) return null;
  const ext = (doc.file_type || (doc.file_name?.includes('.') ? doc.file_name.split('.').pop() : '') || '').toLowerCase().replace(/^\./, '');
  if (!ext && !doc.file_name && doc.has_file !== true) return null;
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'dot', 'dotx', 'rtf', 'odt'].includes(ext)) return 'word';
  if (['xls', 'xlsx', 'xlsm', 'csv', 'ods'].includes(ext)) return 'excel';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'powerpoint';
  if (['txt', 'md', 'markdown'].includes(ext)) return 'text';
  return 'other';
}

export function fileSizeLabel(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 12 -> "Every year", 6 -> "Every 6 months", 24 -> "Every 2 years"; none -> "Not set". */
export function reviewCycleLabel(months: number | null | undefined): string {
  if (!months || months < 1) return 'Not set';
  if (months === 1) return 'Every month';
  if (months % 12 === 0) return months === 12 ? 'Every year' : `Every ${months / 12} years`;
  return `Every ${months} months`;
}

/** "26–50 of 112" for a page of a list (1-based page). */
export function rangeLabel(page: number, pageSize: number, total: number): string {
  if (total === 0) return '0';
  const from = (page - 1) * pageSize + 1;
  return `${from}–${Math.min(total, page * pageSize)} of ${total}`;
}

/** The page to be on after the list changed: inside the pages that exist. */
export function clampPage(page: number, pageSize: number, total: number): number {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(1, page), pages);
}
