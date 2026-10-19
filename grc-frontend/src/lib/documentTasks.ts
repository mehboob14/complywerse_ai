// A document review, approval or acknowledgement request as a task in Task Management (backend: governance/doc_lifecycle.py
// task_request / locked_change; the router adds `document_request` to such a task's JSON). Pure helpers, tested in
// documentTasks.test.ts; used by the Task Management pages and by the document page's ?act= link.

export type RequestKind = 'review' | 'approval' | 'acknowledgement';

/** What the server says about the request behind a document task (`task.document_request`). */
export interface DocumentRequest {
  request_id: number;
  kind: RequestKind;
  document_id: number;
  document_title: string | null;
  version: string | null;
  status: 'pending' | 'done' | 'rejected' | 'cancelled';
  user_id: number;
  due_date: string | null;
  done_at: string | null;
  overdue: boolean;
  open_href: string;
  /** the document with the person's own step open; null once it is no longer waiting */
  action_href: string | null;
  action_label: string;
}

export interface TaskLike {
  source_module?: string | null;
  source_entity_type?: string | null;
  document_request?: DocumentRequest | null;
}

/** A task made by a document request (also one made before `document_request` existed). */
export function isDocumentTask(t: TaskLike | null | undefined): boolean {
  return !!t && t.source_module === 'document_lifecycle' && t.source_entity_type === 'DocumentObligation';
}

export type Act = 'ack' | 'sign';

/** The document page with the person's own step open (as the server's doc_lifecycle.action_href builds it). */
export function actionHref(documentId: number, kind: RequestKind): string {
  return `/governance/documents/${documentId}?act=${kind === 'acknowledgement' ? 'ack' : 'sign'}`;
}

/** ?act= of the document page: which popup is asked for, or null. */
export function actOf(param: string | null | undefined): Act | null {
  const v = (param ?? '').trim().toLowerCase();
  return v === 'ack' || v === 'sign' ? v : null;
}

export interface TaskButton { label: string; href: string; primary: boolean }

/** The buttons a document task shows: the person's own step first (only to that person, while it waits), then the document. */
export function taskButtons(req: DocumentRequest | null | undefined, meId: number | null | undefined): TaskButton[] {
  if (!req) return [];
  const own = req.action_href && meId != null && req.user_id === meId;
  return [
    ...(own ? [{ label: req.action_label, href: req.action_href as string, primary: true }] : []),
    { label: 'Open document', href: req.open_href, primary: false },
  ];
}

/** Who may delete a task: a document task only an administrator (the server refuses everyone else); any other as before. */
export function canDeleteTask(t: TaskLike | null | undefined, who: { isAdmin: boolean; hasDeleteRight: boolean }): boolean {
  return isDocumentTask(t) ? who.isAdmin : who.hasDeleteRight;
}

/** Fields of a document task that follow its request and are not sent from Task Management's edit form. */
export const LOCKED_FIELDS = ['assigned_owner_id', 'assigned_user_ids', 'due_date', 'status', 'source_module', 'source_entity_type', 'source_entity_id'] as const;

export function withoutLocked<T extends Record<string, unknown>>(t: TaskLike, payload: T): Partial<T> {
  if (!isDocumentTask(t)) return payload;
  const out: Record<string, unknown> = { ...payload };
  for (const key of LOCKED_FIELDS) delete out[key];
  return out as Partial<T>;
}

/** How the server refuses to give a document task to someone else (backend doc_lifecycle._LOCKED). */
const PERSON_LOCKED = 'The person on this task is the one asked';

/** What Apply Reassignments says once it ran: one entry per update, null when it worked, else the server's refusal ('' unknown). */
export function reassignReport(outcomes: readonly (string | null)[]): { moved: number; message: string | null } {
  const moved = outcomes.filter((o) => o === null).length;
  const locked = outcomes.filter((o) => !!o && o.startsWith(PERSON_LOCKED)).length;
  const other = outcomes.length - moved - locked;
  const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;
  const parts = [
    locked ? `${tasks(locked)} could not be reassigned: ${locked === 1 ? 'it follows' : 'they follow'} a document request.` : '',
    other ? `${tasks(other)} could not be reassigned.` : '',
  ].filter(Boolean);
  return { moved, message: parts.length ? parts.join(' ') : null };
}

/** A dropdown's choices plus the task's own value when it is not one of them (a document task's "Governance document" source,
 *  or a category typed in Governance > Settings), so the edit form shows what the task has instead of the first choice. */
export function withCurrent(choices: readonly string[], current: unknown): string[] {
  const v = typeof current === 'string' ? current : '';
  return v && !choices.includes(v) ? [v, ...choices] : [...choices];
}

/** Tasks made before the buttons say where to go as a path ("Open it at /governance/documents/3 (its Approvals)."): the
 *  buttons do that now, so the sentence is left out. */
export function plainDescription(text: string | null | undefined): string {
  return (text ?? '').replace(/\s*Open it at \/governance\/documents\/\d+[^\s.]*(?: \(its Approvals\))?\./g, '').trim();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-30T09:00:00' -> '30 Oct 2026', read from the string (the server's naive UTC date). */
export function dayOf(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim());
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

const NOUN: Record<RequestKind, string> = { review: 'Review', approval: 'Approval', acknowledgement: 'Acknowledgement' };
const DONE: Record<RequestKind, string> = { review: 'Reviewed and signed', approval: 'Approved and signed', acknowledgement: 'Acknowledged' };
const DOING: Record<RequestKind, string> = { review: 'review and sign it', approval: 'approve and sign it', acknowledgement: 'acknowledge it' };

/** One line on where the request stands: "Acknowledgement of version 1.2 · due 30 Oct 2026 · overdue", "Acknowledged on …". */
export function requestLine(req: DocumentRequest): string {
  const of = `${NOUN[req.kind]}${req.version ? ` of version ${req.version}` : ''}`;
  if (req.status === 'done') return `${DONE[req.kind]}${dayOf(req.done_at) ? ` on ${dayOf(req.done_at)}` : ''}`;
  if (req.status === 'rejected') return `Rejected${dayOf(req.done_at) ? ` on ${dayOf(req.done_at)}` : ''}`;
  if (req.status === 'cancelled') return `${of} · no longer needed`;
  const due = dayOf(req.due_date);
  return `${of}${due ? ` · due ${due}` : ''}${req.overdue ? ' · overdue' : ''}`;
}

/** What closes the task, in the person's words. */
export function closesWhen(req: DocumentRequest, mine: boolean): string {
  if (req.status !== 'pending') return 'Done in the document. There is nothing more to do here.';
  return `This task closes by itself when ${mine ? `you ${DOING[req.kind]}` : 'the person asked does it'} in the document. `
    + 'Who it is for, its due date and its status follow the request.';
}

/** What ?act= does on the document page: the popup of the person's own step, or why there is none. */
export function actOutcome(i: { act: Act; myAck: boolean; myRole: string | null | undefined; doneOn?: string | null }):
  { popup: 'ack' | 'sign' } | { title: string; message: string } {
  const on = dayOf(i.doneOn ?? null);
  if (i.act === 'ack') {
    if (i.myAck) return { popup: 'ack' };
    return on ? { title: 'Already acknowledged', message: `You acknowledged this document on ${on}. There is nothing more to do.` }
      : { title: 'Nothing to acknowledge', message: 'You are not asked to acknowledge this document now.' };
  }
  if (i.myRole === 'reviewer' || i.myRole === 'approver') return { popup: 'sign' };
  return on ? { title: 'Already signed', message: `You signed this document on ${on}. There is nothing more to do.` }
    : { title: 'Not your step now', message: 'This document is not waiting for your review or approval: it was signed, sent back or changed since.' };
}
