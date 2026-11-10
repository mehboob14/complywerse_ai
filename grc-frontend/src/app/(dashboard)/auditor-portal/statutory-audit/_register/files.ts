// The files Statutory Audit takes, apart from React so `node --test` pins it (files.test.ts): what the AI import reads, what evidence may be attached, the 25 MB both promise, and the
// plain words a refused file is told in. The two lists are the server's (statutory_audit.py: the import's `_AI_IMPORT_EXTS`, `EVIDENCE_EXTENSIONS`); a test re-reads them.

export const MAX_MB = 25;
export const MAX_BYTES = MAX_MB * 1024 * 1024;

/** What the AI import can read. */
export const IMPORT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'rtf', 'json', 'log'] as const;
/** What may be attached to an observation as evidence. */
export const EVIDENCE_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'tsv', 'txt', 'md', 'rtf', 'json', 'log', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'zip'] as const;

/** The value of an <input accept>: ".pdf,.docx". */
export const acceptOf = (extensions: readonly string[]): string => extensions.map((e) => `.${e}`).join(',');

export function extensionOf(name: string | null | undefined): string {
  const n = String(name ?? '');
  const dot = n.lastIndexOf('.');
  return dot < 0 ? '' : n.slice(dot + 1).toLowerCase();
}

/** "1.4 MB": one decimal from a megabyte up, whole kilobytes below. */
export function sizeText(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a file cannot be used, in words a person can act on; null when it can. `use` is what it is for: the AI import reads some types, evidence takes more. */
export function fileProblem(file: { name: string; size: number }, use: 'import' | 'evidence'): string | null {
  const allowed: readonly string[] = use === 'import' ? IMPORT_EXTENSIONS : EVIDENCE_EXTENSIONS;
  if (!allowed.includes(extensionOf(file.name))) {
    return use === 'import'
      ? 'This kind of file can\'t be read. Use PDF, Word, Excel, CSV or plain text.'
      : 'This kind of file can\'t be attached. Use PDF, Word, Excel, CSV, text, an image or a ZIP.';
  }
  if (file.size <= 0) return 'This file is empty.';
  if (file.size > MAX_BYTES) return `This file is ${sizeText(file.size)}. The most that can be used is ${MAX_MB} MB.`;
  return null;
}

/** What the import says about how much of a document it reads, before and after: the answer's own numbers when there are some. */
export function readNotice(answer: { truncated?: boolean; characters_read?: number; characters_total?: number; page_limit?: number | null } | null | undefined): string | null {
  if (!answer?.truncated) return null;
  const read = answer.characters_read ?? 0;
  const total = answer.characters_total ?? 0;
  const share = total > 0 ? ` (about ${Math.max(1, Math.min(99, Math.round((read / total) * 100)))}% of it)` : '';
  return `This document is long: only the first part was read${share}. Observations from the rest are not in this list. Import the rest as a separate file.`;
}
