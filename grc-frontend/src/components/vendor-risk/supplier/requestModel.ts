// The rules of the supplier's request page with no React in it so each can be tested: what is missing before the answer can be sent (the server's own rules, said
// before the tap), the file the supplier picks (type and size, as the server checks them), the dates asked for after it, and the draft of the answer that is kept on the device.
// The draft never holds the link: its storage key is a hash of the page's path, and it is kept in sessionStorage (this tab only), never in the browser's long-lived storage.

export type RequestKind = 'document' | 'finding' | 'information';

export interface Answer { response_text: string; plan_text: string; target_date: string }
export const EMPTY_ANSWER: Answer = { response_text: '', plan_text: '', target_date: '' };

const same = (a: Answer, b: Answer) =>
  a.response_text.trim() === b.response_text.trim() && a.plan_text.trim() === b.plan_text.trim() && a.target_date === b.target_date;

/** The answer as the server holds it (empty text where it holds none). */
export const answerOf = (r: { response_text: string | null; plan_text: string | null; target_date: string | null }): Answer =>
  ({ response_text: r.response_text || '', plan_text: r.plan_text || '', target_date: r.target_date || '' });

/** Words typed (or a date picked) that were not sent. */
export const isDirty = (now: Answer, sent: Answer): boolean => !same(now, sent);

/** What is missing before this can be sent, in the server's own words ("submit" in tpra/supplier_requests.py), or null when it can go. */
export function sendGate(kind: RequestKind, fileCount: number, answer: Answer): string | null {
  if (kind === 'document' && fileCount === 0) return 'Attach the document first.';
  if (kind === 'information' && !answer.response_text.trim() && fileCount === 0) return 'Write your answer or attach a file.';
  if (kind === 'finding' && !(answer.plan_text.trim() && answer.target_date)) return 'Say how you will fix it and by when.';
  return null;
}

// ── the file ────────────────────────────────────────────────────────────────

/** What the server takes (routers/questionnaires.py `_ALLOWED_EVIDENCE_EXT`); it checks again. */
export const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf', '.md', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip', '.json', '.xml', '.log'];
export const ACCEPT = ALLOWED_EXT.join(',');
export const MAX_BYTES = 25 * 1024 * 1024;

/** Why a picked file cannot be sent, before it travels over a phone's connection; null when it can. */
export function fileProblem(name: string, size: number): string | null {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
  if (!ALLOWED_EXT.includes(ext)) return 'That kind of file is not accepted. Use a PDF, Word, Excel, PowerPoint, image, text or ZIP file.';
  if (size <= 0) return 'That file is empty.';
  if (size > MAX_BYTES) return 'That file is larger than 25 MB.';
  return null;
}

/** "1.2 MB", "340 KB". */
export function sizeWords(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

export interface FileDates { coverage_from: string; coverage_to: string; expires_on: string }
export const NO_DATES: FileDates = { coverage_from: '', coverage_to: '', expires_on: '' };

/** Why the dates asked for after a file cannot be used (the server refuses the same), or null. */
export function datesProblem(d: FileDates): string | null {
  return d.coverage_from && d.coverage_to && d.coverage_to < d.coverage_from ? 'The period it covers ends before it starts.' : null;
}

// ── the draft ───────────────────────────────────────────────────────────────

/** A storage key for a page's draft that is not the link: FNV-1a of the page's path, in hex. */
export function draftKey(path: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i += 1) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `supplier-draft-${h.toString(16).padStart(8, '0')}`;
}

/** What is stored: the answer the server held when typing began (to tell a stale draft) and what was typed. */
export function packDraft(sent: Answer, typed: Answer): string {
  return JSON.stringify({ sent, typed });
}

/** The draft to put back, or null: only one made on top of the answer the server holds NOW (a request returned with new words since is not overwritten by an old draft),
 *  and only when it says something the server's answer does not. Anything unreadable is no draft. */
export function readDraft(raw: string | null | undefined, sent: Answer): Answer | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as { sent?: Partial<Answer>; typed?: Partial<Answer> };
    const was = { ...EMPTY_ANSWER, ...(stored.sent || {}) };
    const typed = { ...EMPTY_ANSWER, ...(stored.typed || {}) };
    if (typeof typed.response_text !== 'string' || typeof typed.plan_text !== 'string' || typeof typed.target_date !== 'string') return null;
    return same(was, sent) && !same(typed, sent) ? typed : null;
  } catch {
    return null;
  }
}
