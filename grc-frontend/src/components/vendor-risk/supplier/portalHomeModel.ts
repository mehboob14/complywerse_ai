// What the supplier's home shows, with no React in it so each rule can be tested: one "To do" list that merges the questionnaires and the requests that wait on
// the supplier, in the order of their due day; the "Done" list of what is sent, accepted, withdrawn or closed; and the deep link that goes straight to a questionnaire.
// The server already sorts each kind by due date; here the two are put in one order. Dates come from the server as a moment (a questionnaire's due date, naive UTC) or as a
// day (a request's); a moment is read as the viewer's own day, a day as written.
import { parseUtc } from '../../../lib/serverTime.ts';

export interface PortalQuestionnaire {
  id: number; title: string; status: string; due_date: string | null; sent_at: string | null;
  expires_at: string | null; submitted_at: string | null; progress: { answered: number; total: number };
  returned_questions: number; open: boolean;
  unread?: number;                                                // comments we shared on its questions since the last visit
}

export type RequestStatus = 'open' | 'submitted' | 'returned' | 'accepted' | 'cancelled';
export type RequestKind = 'document' | 'finding' | 'information';

export interface PortalRequest {
  id: number; kind: RequestKind; title: string; detail: string | null;
  evidence_label: string | null; due_date: string | null; overdue: boolean; status: RequestStatus;
  open: boolean;                                                  // the supplier can still work on it
  requested_at: string; responded_at: string | null; review_note: string | null;
  file_count?: number; unread?: number;                           // on the home
}

export interface PortalMessage { id: number; from_supplier: boolean; author: string | null; body: string; created_at: string }

export interface PortalHome {
  organisation: { name: string | null }; supplier: { name: string }; contact: { name: string; email: string | null };
  expires_at: string; questionnaires: PortalQuestionnaire[];
  requests: PortalRequest[];
  messages: { unread: number; latest: PortalMessage[] };         // the supplier's own thread with us
}

/** The questionnaire statuses that wait on the supplier (the server's WAITING_ON_VENDOR). */
export const WAITING = ['pending', 'in_progress', 'returned'];

export type TodoKind = 'questionnaire' | RequestKind;

export interface Row {
  key: string;                          // 'q-12' | 'r-5': stable, for React and for the tests
  kind: TodoKind;
  id: number;
  title: string;
  /** under the supplier's link: `questionnaires/12` or `requests/5` */
  path: string;
  /** which registry the word belongs to */
  family: 'questionnaire' | 'request';
  /** the stored word (or "closed"); the registry says it in full */
  word: string;
  unread: number;
}

export interface TodoRow extends Row {
  due: string | null;
  late: boolean;
  /** the one thing to do next, as the button says it */
  action: string;
  progress: { answered: number; total: number } | null;
  /** what the word does not say: how many questions came back, how many files are attached but not sent */
  note: string | null;
}

export interface DoneRow extends Row {
  /** when it was sent, if it was */
  when: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pad = (n: number) => String(n).padStart(2, '0');
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar day ("2026-11-30") a stored date or moment stands for: a day as written, a moment as the viewer's own day. */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (DAY.test(text)) return text;
  const at = parseUtc(text);
  if (!at || Number.isNaN(at.getTime())) return null;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The viewer's own day for `now`. */
export const today = (now: Date = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** Past its due day. Nothing is late that has no due day, and the due day itself is not late. */
export function isLate(due: string | null | undefined, now: Date = new Date()): boolean {
  const day = dayOf(due);
  return !!day && day < today(now);
}

const KIND_ORDER: Record<TodoKind, number> = { questionnaire: 0, document: 1, information: 2, finding: 3 };
const NO_DUE = '9999-12-31';

function questionnaireAction(status: string): string {
  return status === 'pending' ? 'Start' : status === 'returned' ? 'Answer' : 'Continue';
}

const REQUEST_ACTION: Record<RequestKind, string> = { document: 'Upload', information: 'Answer', finding: 'Send your plan' };

/** One list, soonest due day first, those with no due day last; on the same day a questionnaire comes before a request, and the server's order is kept after that.
 *  A questionnaire whose link has run out is not something to do: it is in Done as closed. */
export function todoRows(home: Pick<PortalHome, 'questionnaires' | 'requests'>, now: Date = new Date()): TodoRow[] {
  const rows: Array<TodoRow & { order: number }> = [];
  home.questionnaires.forEach((q, i) => {
    if (!WAITING.includes(q.status) || !q.open) return;
    rows.push({
      key: `q-${q.id}`, kind: 'questionnaire', id: q.id, title: q.title, path: `questionnaires/${q.id}`, family: 'questionnaire', word: q.status,
      unread: q.unread ?? 0, due: q.due_date, late: isLate(q.due_date, now), action: questionnaireAction(q.status),
      progress: q.progress.total > 0 ? q.progress : null,
      note: q.status === 'returned' && q.returned_questions > 0 ? plural(q.returned_questions, 'question', 'questions') + ' to look at' : null,
      order: i,
    });
  });
  home.requests.forEach((r, i) => {
    if (!r.open) return;
    rows.push({
      key: `r-${r.id}`, kind: r.kind, id: r.id, title: r.title, path: `requests/${r.id}`, family: 'request', word: r.status,
      unread: r.unread ?? 0, due: r.due_date, late: r.overdue, action: REQUEST_ACTION[r.kind], progress: null,
      note: r.file_count ? `${plural(r.file_count, 'file', 'files')} attached, not sent yet` : null,
      order: 1000 + i,
    });
  });
  return rows
    .sort((a, b) => (dayOf(a.due) ?? NO_DUE).localeCompare(dayOf(b.due) ?? NO_DUE) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.order - b.order)
    .map(({ order, ...row }) => row);
}

/** What is finished or can no longer be answered, newest first (what has no date keeps the server's order, after those that have). */
export function doneRows(home: Pick<PortalHome, 'questionnaires' | 'requests'>): DoneRow[] {
  const rows: Array<DoneRow & { order: number }> = [];
  home.questionnaires.forEach((q, i) => {
    if (WAITING.includes(q.status) && q.open) return;
    rows.push({
      key: `q-${q.id}`, kind: 'questionnaire', id: q.id, title: q.title, path: `questionnaires/${q.id}`, family: 'questionnaire',
      word: WAITING.includes(q.status) ? 'closed' : q.status, unread: q.unread ?? 0, when: q.submitted_at, order: i,
    });
  });
  home.requests.forEach((r, i) => {
    if (r.open) return;
    rows.push({
      key: `r-${r.id}`, kind: r.kind, id: r.id, title: r.title, path: `requests/${r.id}`, family: 'request', word: r.status,
      unread: r.unread ?? 0, when: r.responded_at, order: 1000 + i,
    });
  });
  const at = (value: string | null) => (value ? parseUtc(value)?.getTime() ?? 0 : 0);
  return rows.sort((a, b) => at(b.when) - at(a.when) || a.order - b.order).map(({ order, ...row }) => row);
}

export interface TabCounts { todo: number; messages: number; done: number }

/** The numbers beside the three tabs: things to do, new messages, things done. */
export function tabCounts(home: PortalHome, now: Date = new Date()): TabCounts {
  return { todo: todoRows(home, now).length, messages: home.messages.unread, done: doneRows(home).length };
}

/** `?q=<id>` in the address: straight to that questionnaire when it is open, or already sent (to read the comments on it). A questionnaire that is gone, or
 *  closed with nothing sent, stays on the home. */
export function deepLink(home: Pick<PortalHome, 'questionnaires'>, wanted: number): number | null {
  if (!wanted) return null;
  const q = home.questionnaires.find((x) => x.id === wanted);
  return q && (q.open || !WAITING.includes(q.status)) ? q.id : null;
}

/** The title of the file a download is saved as: the questionnaire's own name, never an id ("Security questionnaire.xlsx" as "Security-questionnaire.xlsx"). */
export function downloadName(title: string | null | undefined, as: 'xlsx' | 'pdf'): string {
  let base = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (base.length > 60) base = base.slice(0, 60).replace(/-[^-]*$/, '') || base.slice(0, 60);       // at a word, not through one
  return `${base || 'Questionnaire'}.${as}`;
}
