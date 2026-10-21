// Proposed changes (D35, the user, 2026-10-21): a change to a governance document's text, file or statements made by someone who
// may edit it but is not its owner or author does not apply at once; it waits for the owner's (or the author's) decision, who
// accepts it (it becomes the next version, credited to the proposer) or rejects it with a note. Every call of the proposals API is
// here (backend: governance/routers/document_proposals.py, prefix /governance/documents/{id}/proposals), with the words and rules
// the screens share; the pure parts are tested in proposals.test.ts. Screens: documents/[id]/_ProposalsView.tsx and the writers'
// dialogs (AI Studio Save to the library, restore, take back, gap fix, statements written into the document, statements).
import type { ChainHunk } from './documentChain';
import type { RedlineRow, Stats } from './studio/api';
import { nextVersion, saveWarning } from './studio/text.ts';

export type ProposalKind = 'document' | 'statement';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';
export type ProposalSource = 'edit' | 'studio' | 'file' | 'version' | 'restore' | 'take_back' | 'gap_fix' | 'gap_undo' | 'write_back'
  | 'statement_add' | 'statement_edit' | 'statement_delete' | 'statement_rollback';

export interface StatementFields {
  statement_text: string | null; category: string | null; priority: string | null; is_mandatory: boolean | null; source_section: string | null;
}
export interface Person { id: number; name: string }

export interface Proposal {
  id: number;
  document_id: number;
  kind: ProposalKind;
  source: ProposalSource | string;
  status: ProposalStatus;
  /** the document (or the statement) changed since it was proposed: it can only be rejected now */
  stale: boolean;
  proposed_by: Person;
  proposed_at: string | null;
  /** why, in the proposer's words (a statement's justification) */
  message: string | null;
  change_type: 'major' | 'minor' | null;
  base: { version_id: number | null; number: string | null };
  statement: { id: number | null; code: string | null; before: StatementFields | null; after: StatementFields | null } | null;
  finding: { id: number; clause_reference: string | null; clause_title: string | null } | null;
  /** a Word or PDF file goes with it (GET …/file) */
  has_file: boolean;
  decided_by: Person | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_version: { id: number; number: string } | null;
  may_accept: boolean;
  may_reject: boolean;
  may_withdraw: boolean;
  /** the AI Studio session it was sent from (asked of the backend beyond the contract; without it the proposer's newest studio one) */
  studio_session_id?: number | null;
}

export interface ProposalList { items: Proposal[]; can_decide: boolean; pending: number }
export interface DocumentCompare {
  base: { label: string; version_id: number | null };
  proposed: { label: string };
  rows: RedlineRow[];
  changes: ChainHunk[];
  stats: Stats;
}
/** What a writer answers instead of changing the document (the person is not its owner or author). */
export interface ProposedAnswer { proposed: true; proposal: Proposal; message: string }

// ── calls ────────────────────────────────────────────────────────────────────
// the axios client is loaded when a call is made, so the rules below also run under node --test (no app, no '@/' paths)
const http = async () => (await import('@/lib/api')).default;
const at = (documentId: number, pid?: number, tail = '') => `/governance/documents/${documentId}/proposals${pid != null ? `/${pid}` : ''}${tail}`;

export const proposalsApi = {
  /** newest first; anyone who can read the document */
  list: async (documentId: number): Promise<ProposalList> => (await (await http()).get(at(documentId))).data,
  /** a document proposal: the library's text against the proposed one, as RedlineView rows and the changes (hunks) */
  compare: async (documentId: number, pid: number): Promise<DocumentCompare> => (await (await http()).get(at(documentId, pid, '/compare'))).data,
  /** the proposed Word or PDF file (404 for a text proposal); the current file is the document's own download */
  file: async (documentId: number, pid: number): Promise<Blob> => (await (await http()).get(at(documentId, pid, '/file'), { responseType: 'blob' })).data,
  accept: async (documentId: number, pid: number, note?: string): Promise<{ proposal: Proposal; version: { id: number; number: string } | null }> =>
    (await (await http()).post(at(documentId, pid, '/accept'), { note: note?.trim() || null })).data,
  reject: async (documentId: number, pid: number, note: string): Promise<{ proposal: Proposal }> =>
    (await (await http()).post(at(documentId, pid, '/reject'), { note: note.trim() })).data,
  withdraw: async (documentId: number, pid: number): Promise<{ proposal: Proposal }> =>
    (await (await http()).post(at(documentId, pid, '/withdraw'), {})).data,
};

/** The list's React Query key, shared by every screen that reads or refreshes it. */
export const proposalsKey = (documentId: number | null | undefined) => ['document-proposals', documentId ?? 0] as const;

/** The document page opened on one proposal (notifications, tasks, My Approvals link here). */
export const proposalHref = (documentId: number, pid?: number | null) =>
  `/governance/documents/${documentId}?tab=proposals${pid ? `&proposal=${pid}` : ''}`;

// ── words ────────────────────────────────────────────────────────────────────
export const SOURCE_LABEL: Record<string, string> = {
  edit: 'Edited the text', studio: 'Edited in the AI Studio', file: 'Uploaded a new file', version: 'A new version',
  restore: 'Restore an earlier version', take_back: 'Take back a change', gap_fix: 'Gap fix', gap_undo: 'Take a gap fix back out',
  write_back: 'Write the edited statements into the document', statement_add: 'Add a statement', statement_edit: 'Change statement',
  statement_delete: 'Remove statement', statement_rollback: 'Roll back statement',
};

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: 'Waiting for a decision', accepted: 'Accepted', rejected: 'Not accepted', withdrawn: 'Withdrawn',
};

/** What was proposed, in a few words: "Gap fix: A.5.1 Policies (minor change)", "Change statement PS-0001-004". */
export function whatLine(p: Pick<Proposal, 'source' | 'kind' | 'statement' | 'finding' | 'change_type'>): string {
  const label = SOURCE_LABEL[p.source] ?? (p.kind === 'statement' ? 'Change statement' : 'A change to the document');
  const code = p.kind === 'statement' ? p.statement?.code ?? '' : '';
  const clause = p.finding ? [p.finding.clause_reference, p.finding.clause_title].map((s) => (s ?? '').trim()).filter(Boolean).join(' ') : '';
  const size = p.kind === 'document' && p.change_type ? ` (${p.change_type} change)` : '';
  return `${label}${code ? ` ${code}` : ''}${clause ? `: ${clause}` : ''}${size}`;
}

/** Who decides on this document's proposals: its owner, else its author. */
export function deciderName(doc: { owner_name?: string | null; author_name?: string | null } | null | undefined): string {
  return doc?.owner_name?.trim() || doc?.author_name?.trim() || 'the owner';
}

const possessive = (name: string) => (name === 'you' ? 'your' : `${name}'s`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The sentence every proposer's dialog says before they send a change. */
export const goesToLine = (decider: string) => `This goes to ${decider} to accept or reject. The document does not change until then.`;
/** The label of the proposer's message (required). */
export const messageLabel = (decider: string) => `What changed and why — ${decider} reads this`;
/** The button that sends it. */
export const sendLabel = (decider: string) => `Send to ${decider}`;

/** The writers' answer when the change became a proposal, else null (an owner's or author's change: applied as before). */
export function proposedOf(data: unknown): ProposedAnswer | null {
  return data && typeof data === 'object' && (data as { proposed?: unknown }).proposed === true ? (data as ProposedAnswer) : null;
}

/** The toast after a change became a proposal: the server's own sentence ("Sent to Olivia to accept. The document does not change
 *  until then."). */
export function proposedToast(a: ProposedAnswer, decider = 'the owner'): { title: string; message: string } {
  return { title: 'Change proposed', message: a.message?.trim() || `Sent to ${decider} to accept. The document does not change until then.` };
}

/** 409 code proposal_stale: the server's sentence ("This change was made on v1.2; the document is now v1.3. …"), else null. The body is
 *  `{detail, code}`, or (an HTTPException given that dict) `{detail: {detail, code}}`. */
export function staleOf(error: unknown): string | null {
  type Body = { code?: string; detail?: unknown };
  const r = (error as { response?: { status?: number; data?: Body } } | null)?.response;
  const inner = r?.data?.detail && typeof r.data.detail === 'object' ? (r.data.detail as Body) : null;
  if (r?.status !== 409 || (r.data?.code ?? inner?.code) !== 'proposal_stale') return null;
  const text = typeof r.data?.detail === 'string' ? r.data.detail : typeof inner?.detail === 'string' ? inner.detail : '';
  return text.trim() || 'The document changed since this was proposed. It can only be rejected now.';
}

/** A stale proposal, said to the person reading it. */
export function staleLine(p: Pick<Proposal, 'base' | 'proposed_by'>, current: string | null | undefined, mine: boolean): string {
  const made = p.base.number ? `This change was made on v${p.base.number}` : 'This change was made on an earlier version';
  const now = current ? `; the document is now v${current}` : '; the document has changed since';
  return `${made}${now}. ${mine ? 'Propose it again on the current version, or withdraw it.' : `It can only be rejected now: ask ${p.proposed_by.name} to propose it again.`}`;
}

export const isMine = (p: Pick<Proposal, 'proposed_by'>, meId: number | null | undefined) => meId != null && p.proposed_by?.id === meId;

/** The proposer may send it again: theirs, and not accepted (rejected, or still waiting but stale). */
export const mayProposeAgain = (p: Proposal, meId: number | null | undefined) =>
  isMine(p, meId) && (p.status === 'rejected' || (p.status === 'pending' && p.stale));

const IN_REVIEW = new Set(['pending_review', 'pending_approval']);

/** What Accept does, said in its confirm dialog. A document proposal becomes the next version (minor or major as the proposer chose;
 *  without a choice the size of the change decides); in review the stage is asked again (a major change: the whole route); outside
 *  review what saving a change does today (an approved or published document goes back to review). A statement changes as proposed. */
export function acceptLine(p: Pick<Proposal, 'kind' | 'change_type'>, doc: { status: string; current?: string | null; inForce?: string | null }, stage?: string | null): string {
  const review = IN_REVIEW.has(doc.status);
  const becomes = p.kind === 'statement' ? 'The statement changes as proposed'
    : p.change_type ? `It becomes v${nextVersion(doc.current, p.change_type)}` : 'It becomes the next version';
  if (review) {
    return p.change_type === 'major' && p.kind === 'document' ? `${becomes} and the review starts again from the first stage.`
      : `${becomes} and the review continues — everyone at ${stage || 'this stage'} reviews again.`;
  }
  const after = p.kind === 'document' ? saveWarning(doc.status, doc.inForce) : null;
  return after ? `${becomes}. ${after}` : `${becomes}.`;
}

/** What Reject does, said in its dialog. */
export function rejectLine(proposer: string, status: string): string {
  return IN_REVIEW.has(status)
    ? `${proposer} is told with your note and asked to sign it as it is or propose another change. The review stays on hold until then.`
    : `${proposer} is told with your note and can revise it and propose it again. The document stays as it is.`;
}

/** The two columns of a document proposal's comparison. */
export function compareTitles(p: Pick<Proposal, 'base' | 'proposed_by' | 'proposed_at' | 'stale'>, current: string | null | undefined, day: (iso: string | null) => string) {
  const base = p.base.number || current || '';
  return {
    before: p.stale ? `v${base}, the version it was made on` : `In the library now${base ? ` (v${base})` : ''}`,
    after: `Proposed by ${p.proposed_by.name}${p.proposed_at ? ` · ${day(p.proposed_at)}` : ''}`,
  };
}

/** The proposal a list opens on: the one asked for, else the oldest still waiting, else the newest. */
export function pick(items: Proposal[], asked: number | null | undefined): Proposal | null {
  const want = asked ? items.find((p) => p.id === asked) : undefined;
  if (want) return want;
  const waiting = items.filter((p) => p.status === 'pending');
  return waiting[waiting.length - 1] ?? items[0] ?? null;
}

/** The banner at the top of the document page: the decider's waiting changes, else the person's own change. */
export function pageBanner(list: ProposalList | null | undefined, meId: number | null | undefined, decider: string):
  { kind: 'decide' | 'waiting' | 'rejected'; text: string; action: string; proposalId: number } | null {
  if (!list) return null;
  const pending = list.items.filter((p) => p.status === 'pending');
  if (list.can_decide && pending.length) {
    const n = Math.max(list.pending || 0, pending.length);
    return { kind: 'decide', text: `${n} ${n === 1 ? 'change is' : 'changes are'} waiting for your decision`, action: n === 1 ? 'Review it' : 'Review them',
             proposalId: pending[pending.length - 1].id };
  }
  const newest = list.items.find((p) => isMine(p, meId));
  if (newest?.status === 'pending') return { kind: 'waiting', text: `Your change is waiting for ${possessive(decider)} decision`, action: 'See it', proposalId: newest.id };
  if (newest?.status === 'rejected') {
    return { kind: 'rejected', text: `${cap(newest.decided_by?.name || decider)} did not accept your change`, action: 'See why', proposalId: newest.id };
  }
  return null;
}

/** The AI Studio's banner for the person's own changes sent from this session: waiting, or not accepted (with the note). */
export function sessionProposal(items: Proposal[] | null | undefined, sessionId: number, meId: number | null | undefined): Proposal | null {
  const newest = (items ?? []).find((p) => p.source === 'studio' && (p.studio_session_id != null ? p.studio_session_id === sessionId : isMine(p, meId)));
  return newest && (newest.status === 'pending' || newest.status === 'rejected') ? newest : null;
}

/** A hold of kind "proposal" on the route, in words: who proposed it and who decides; after a rejection, what the proposer does. */
export function holdLine(h: { proposer: string; decider: string; status?: string | null; me: 'decider' | 'proposer' | 'other' }): string {
  const who = h.me === 'decider' ? 'you' : h.decider;
  if (h.status === 'rejected') {
    return h.me === 'proposer' ? `${cap(h.decider)} did not accept your change`
      : `${cap(who)} did not accept ${possessive(h.proposer)} change — waiting for ${h.proposer} to sign it as it is or propose another change`;
  }
  if (h.me === 'proposer') return `Your change is waiting for ${possessive(h.decider)} decision`;
  return `${cap(h.proposer)} proposed a change — waiting for ${possessive(who)} decision`;
}

/** The reviewer's or approver's role to sign with: their step, or (the proposer after a rejection) the same step held for them to
 *  sign the document as it is. */
export function signRoleOf(s: { my_actionable_role?: 'reviewer' | 'approver' | null; my_step?: { role_type: 'reviewer' | 'approver'; may_sign_as_is?: boolean } | null } | null | undefined) {
  return s?.my_actionable_role ?? (s?.my_step?.may_sign_as_is ? s.my_step.role_type : null);
}

/** A gap fix's justification, as the server fills it when it is left empty: "<clause> <title>: <gap> <what is missing>" (else the
 *  AI's reasoning). */
export function gapJustification(f: { clause_reference?: string | null; clause_title?: string | null; gap_description?: string | null;
  missing_requirement?: string | null; ai_reasoning?: string | null }): string {
  const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  const clause = [f.clause_reference, f.clause_title].map(clean).filter(Boolean).join(' ');
  const why = [f.gap_description, f.missing_requirement].map(clean).filter(Boolean).join(' ') || clean(f.ai_reasoning);
  return clause && why ? `${clause}: ${why}` : clause || why;
}

// ── statements ───────────────────────────────────────────────────────────────
const FIELDS: { key: keyof StatementFields; label: string }[] = [
  { key: 'statement_text', label: 'Wording' }, { key: 'category', label: 'Category' }, { key: 'priority', label: 'Priority' },
  { key: 'is_mandatory', label: 'Mandatory' }, { key: 'source_section', label: 'Section' },
];
const SHORT: Record<string, string> = { hr: 'HR', it: 'IT' };
const shown = (key: keyof StatementFields, v: StatementFields[keyof StatementFields] | undefined): string => {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (key === 'category' || key === 'priority') return SHORT[v] ?? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ');
  return v;
};

/** A statement proposal as rows of a before → after table; `before` null: a new statement, `after` null: it is removed. */
export function fieldRows(before: StatementFields | null | undefined, after: StatementFields | null | undefined) {
  return FIELDS.map(({ key, label }) => {
    const was = before ? shown(key, before[key]) : '—';
    const now = after ? shown(key, after[key]) : key === 'statement_text' ? 'Removed' : '—';
    return { key, label, before: was, after: now, changed: was !== now };
  });
}

/** The statement's own proposal still waiting (the newest), if any. */
export function pendingFor(items: Proposal[] | null | undefined, statementId: number): Proposal | null {
  return (items ?? []).find((p) => p.kind === 'statement' && p.status === 'pending' && p.statement?.id === statementId) ?? null;
}

/** New statements proposed and still waiting (they are not in the list of statements yet). */
export function proposedStatements(items: Proposal[] | null | undefined): Proposal[] {
  return (items ?? []).filter((p) => p.kind === 'statement' && p.status === 'pending' && p.source === 'statement_add');
}
