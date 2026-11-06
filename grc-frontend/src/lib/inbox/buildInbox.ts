// "Needs my action": what the platform asks of the signed-in person, as ONE list built from the sources that ask, by one rule. Pure (no React, no requests): the page, the top bar's
// badge and its dropdown all call buildInbox on the same query results, so they cannot disagree. `node --test src/lib/inbox/buildInbox.test.ts`.
// The contract is G3_inbox_contract.md; the owner's answers (2026-11-01): the old approve/reject log stays out (separate, uncounted), `changes` and `revise` count as decisions,
// evidence counts for the person it is addressed to (the rest is "you can decide"), acknowledgements are their own count, "Sent by me" is workflow requests only.
//
// THE COUNT RULE. The number on the badge, in the dropdown and on the page ("To decide") is the same number: the decision items of sources that answered (ready, or stale: the last
// good answer is kept) after the sign-off duplicates are dropped, counting only those addressed to the person. Never in it: acknowledgements, sent items, evidence the person may
// decide without being asked, items of a source that is loading, unavailable or off. Overdue and escalated are attributes of an item, not further counts. A source that failed never
// reads as zero: the badge says "!" and the page says which source could not be loaded.
import { parseUtc } from '../serverTime.ts';
import { actionHref, type RequestKind } from '../documentTasks.ts';
import { seeChangesHref, type Again } from '../approvalRoutes.ts';
import { statusLabel } from '../format.ts';
import { appPath, assessmentApprovalHref } from '../../components/layout/headerLinks.ts';

export type SourceId = 'doc.lifecycle' | 'doc.signoff' | 'assessment.evidence' | 'doc.sent';
export type Section = 'decision' | 'acknowledgement' | 'sent';
export type Kind = 'approval' | 'review' | 'signoff' | 'decide' | 'revise' | 'changes' | 'evidence' | 'acknowledgement';

export interface KindMeta {
  /** the small tag on a row: what is asked */
  label: string;
  /** the row's action, in the person's words */
  action: string;
  section: Section;
  /** ties between rows of one due date are broken by this order */
  rank: number;
  /** decided in the page's dialog (an endpoint that exists decides it on its own); every other kind opens the document at the right step */
  inDialog: boolean;
  /** one sentence: where it is decided, and what that does */
  authority: string;
}

export const KIND_META: Record<Kind, KindMeta> = {
  approval: { label: 'To approve', action: 'Approve and sign', section: 'decision', rank: 1, inDialog: true, authority: 'Decided on the document. Your drawn signature is kept with it, with your name and the time.' },
  review: { label: 'To review', action: 'Review and sign', section: 'decision', rank: 2, inDialog: true, authority: 'Decided on the document. Your drawn signature is kept with it, with your name and the time.' },
  signoff: { label: 'To sign', action: 'Review and sign', section: 'decision', rank: 3, inDialog: true, authority: 'Decided on the document. Your drawn signature is kept with it, with your name and the time.' },
  decide: { label: 'Change proposed', action: 'Decide', section: 'decision', rank: 4, inDialog: false, authority: 'Decided on the document, where the proposed change is shown next to the text.' },
  revise: { label: 'Not accepted', action: 'Revise', section: 'decision', rank: 5, inDialog: false, authority: 'Your change was not accepted: sign the document as it is, or propose it again, on the document.' },
  changes: { label: 'To revise', action: 'Make the changes', section: 'decision', rank: 6, inDialog: false, authority: 'Make the changes asked for in the document, then resubmit it.' },
  evidence: { label: 'Evidence to approve', action: 'Review', section: 'decision', rank: 7, inDialog: true, authority: 'Decided on the assessment item the evidence belongs to; the history keeps your decision.' },
  acknowledgement: { label: 'To acknowledge', action: 'Acknowledge', section: 'acknowledgement', rank: 8, inDialog: false, authority: 'Read the document, then acknowledge it on the document.' },
};

const DOCUMENT_KINDS: readonly string[] = ['approval', 'review', 'decide', 'revise', 'changes', 'acknowledgement'];
const SENT_KINDS: readonly string[] = ['approval', 'review', 'decide', 'revise', 'changes'];

export interface InboxItem {
  /** `${source}:${kind}:${id}`: unique across sources (an evidence link 12 is not an obligation 12) */
  key: string;
  source: SourceId;
  recordType: 'DocumentObligation' | 'GovernanceDocument' | 'AssessmentItemEvidence';
  recordId: number;
  kind: Kind;
  section: Section;
  /** the whole title: the view cuts it and keeps the full value as its tooltip */
  title: string;
  /** the document's type and version, or the assessment and item */
  context: string | null;
  /** a second line of text about the thing (the control an evidence file is for) */
  detail: string | null;
  /** who asked; null: the source does not say */
  requester: string | null;
  requesterId: number | null;
  /** when it was asked (the server's naive UTC) */
  createdAt: string | null;
  dueAt: string | null;
  overdue: boolean;
  /** 0 nobody told, 1 the owner told, 2 the administrators told */
  escalation: 0 | 1 | 2;
  /** asked again after changes: what they did before and what changed (reuses lib/approvalRoutes) */
  again: Again | null;
  /** the document's own status ("archived" gets a chip) */
  docStatus: string | null;
  documentId: number | null;
  proposalId: number | null;
  /** a page of this app */
  href: string;
  extraLinks: Array<{ label: string; href: string }>;
  /** a decision addressed to the person: it is in the badge. False for acknowledgements, sent items and evidence the person may decide without being asked. */
  counted: boolean;
  /** sent items only: how many people it waits for and the first names */
  group: { pending: number; waiting: string[]; more: number } | null;
}

// ── the sources ──────────────────────────────────────────────────────────────

export type SourceState =
  | { state: 'loading' }
  | { state: 'ready'; at: number }
  /** the last refresh failed; the answer before it is kept */
  | { state: 'stale'; at: number; error: string }
  /** never answered: the first request failed */
  | { state: 'unavailable'; error: string }
  /** the server has nothing to say (the life cycle is off, an older server has no such endpoint): not a failure */
  | { state: 'off' };

export interface SourceInput { id: SourceId; state: SourceState; raw?: unknown }

export interface SourceDef {
  id: SourceId;
  /** names the source in "{label} could not be loaded" */
  label: string;
  /** the sections its items go to (a notice is shown in each) */
  feeds: Section[];
  /** feeds the top bar's badge and polls with the top bar */
  inBadge: boolean;
  /** the server says it has nothing (not an error) */
  off?: (raw: unknown) => boolean;
  /** `total`: the true number the server says it holds when it sent only the most urgent ones (the sent list is cut at 200 groups) */
  toItems: (raw: unknown, now: Date) => { items: InboxItem[]; skipped: number; total?: number };
}

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const rowsOf = (v: unknown, keys: string[]): unknown[] => {
  if (Array.isArray(v)) return v;
  if (isRow(v)) for (const k of keys) if (Array.isArray(v[k])) return v[k] as unknown[];
  return [];
};
const level = (v: unknown): 0 | 1 | 2 => (v === 1 || v === 2 ? v : 0);
const documentPath = (id: number) => `/governance/documents/${id}`;
const safe = (path: string, fallback: string) => appPath(path) ?? fallback;

/** Whether a moment (the server's naive UTC) has passed; false when it names none. */
function passed(due: string | null, now: Date): boolean {
  const at = parseUtc(due);
  return !!at && at.getTime() < now.getTime();
}

function documentContext(type: unknown, version?: unknown): string | null {
  const t = text(type) ? statusLabel(text(type)) : '';
  const v = text(version) ? `v${text(version)}` : '';
  return [t, v].filter(Boolean).join(' · ') || null;
}

function lifecycleItems(raw: unknown, now: Date): { items: InboxItem[]; skipped: number } {
  const items: InboxItem[] = [];
  let skipped = 0;
  for (const r of rowsOf(raw, ['items'])) {
    const id = isRow(r) ? whole(r.id) : null;
    const documentId = isRow(r) ? whole(r.document_id) : null;
    const kind = isRow(r) ? text(r.kind) : null;
    if (!isRow(r) || id === null || documentId === null || !kind || !DOCUMENT_KINDS.includes(kind)) { skipped++; continue; }
    const k = kind as RequestKind;
    const dueAt = text(r.due_date);
    const proposalId = whole(r.proposal_id);
    const again = isRow(r.again) ? (r.again as unknown as Again) : null;
    const seen = seeChangesHref(documentId, again);
    items.push({
      key: `doc.lifecycle:${k}:${id}`, source: 'doc.lifecycle', recordType: 'DocumentObligation', recordId: id, kind: k, section: KIND_META[k].section,
      title: text(r.title) ?? `Document #${documentId}`, context: documentContext(r.doc_type, r.version), detail: null,
      requester: text(r.requested_by_name), requesterId: whole(r.requested_by_id), createdAt: text(r.requested_at), dueAt,
      overdue: typeof r.overdue === 'boolean' ? r.overdue : passed(dueAt, now), escalation: level(r.escalation_level), again,
      docStatus: text(r.status), documentId, proposalId,
      href: safe(actionHref(documentId, k, proposalId), documentPath(documentId)),
      extraLinks: seen && appPath(seen) ? [{ label: 'See what changed', href: seen }] : [],
      counted: KIND_META[k].section === 'decision', group: null,
    });
  }
  return { items, skipped };
}

function signoffItems(raw: unknown): { items: InboxItem[]; skipped: number } {
  const items: InboxItem[] = [];
  let skipped = 0;
  for (const r of rowsOf(raw, ['items'])) {
    const documentId = isRow(r) ? whole(r.document_id) : null;
    if (!isRow(r) || documentId === null) { skipped++; continue; }
    const stage = text(r.stage_name) ?? text(r.stage_label);          // the stage's own name (Review, Concurrence...), not the sign-off table's "Reviewed by"
    items.push({
      key: `doc.signoff:signoff:${documentId}`, source: 'doc.signoff', recordType: 'GovernanceDocument', recordId: documentId, kind: 'signoff', section: 'decision',
      title: text(r.title) ?? `Document #${documentId}`, context: [documentContext(r.doc_type), stage].filter(Boolean).join(' · ') || null, detail: null,
      requester: null, requesterId: null, createdAt: text(r.round_started_at) ?? text(r.updated_at), dueAt: null, overdue: false, escalation: 0, again: null,
      docStatus: text(r.status), documentId, proposalId: null,
      href: safe(`${documentPath(documentId)}?tab=sign-off`, documentPath(documentId)), extraLinks: [], counted: true, group: null,
    });
  }
  return { items, skipped };
}

function evidenceItems(raw: unknown): { items: InboxItem[]; skipped: number } {
  const items: InboxItem[] = [];
  let skipped = 0;
  for (const r of rowsOf(raw, ['pending_approvals'])) {
    const id = isRow(r) ? whole(r.id) : null;
    if (!isRow(r) || id === null) { skipped++; continue; }
    const item = text(r.item_number);
    items.push({
      // the key names the step the evidence waits at (pending_tier_1...): the server does not check that a decision is made at the step the person saw (an approval of evidence that has moved
      // on counts for the NEXT tier), so evidence that moved is another item, and a dialog opened on the old one is told that it no longer waits (lib/inbox/decisionModel.ts: evidenceStillWaits)
      key: `assessment.evidence:evidence:${id}:${text(r.status) ?? 'pending'}`, source: 'assessment.evidence', recordType: 'AssessmentItemEvidence', recordId: id, kind: 'evidence', section: 'decision',
      title: text(r.evidence_name) ?? (item ? `Evidence for item ${item}` : `Evidence #${id}`),
      context: [text(r.assessment_name), item ? `item ${item}` : null, whole(r.current_tier) ? `tier ${whole(r.current_tier)}` : null].filter(Boolean).join(' · ') || null,
      detail: text(r.control_description), requester: text(r.submitted_by_name), requesterId: null, createdAt: text(r.submitted_at), dueAt: null, overdue: false,
      escalation: 0, again: null, docStatus: null, documentId: null, proposalId: null, href: safe(assessmentApprovalHref({ id }), '/compliance/assessments/approvals'),
      extraLinks: [],
      // a server from before A3 sends no `addressed_to_me`: every item then counts, as it always did
      counted: r.addressed_to_me !== false, group: null,
    });
  }
  return { items, skipped };
}

function sentItems(raw: unknown, now: Date): { items: InboxItem[]; skipped: number; total?: number } {
  const items: InboxItem[] = [];
  let skipped = 0;
  for (const r of rowsOf(raw, ['items'])) {
    const documentId = isRow(r) ? whole(r.document_id) : null;
    const kind = isRow(r) ? text(r.kind) : null;
    if (!isRow(r) || documentId === null || !kind || !SENT_KINDS.includes(kind)) { skipped++; continue; }
    const k = kind as Kind;
    const proposalId = whole(r.proposal_id);
    const dueAt = text(r.next_due);
    items.push({
      key: `doc.sent:${k}:${documentId}:${proposalId ?? 0}`, source: 'doc.sent', recordType: 'GovernanceDocument', recordId: documentId, kind: k, section: 'sent',
      title: text(r.title) ?? `Document #${documentId}`, context: documentContext(r.doc_type), detail: null, requester: null, requesterId: null,
      createdAt: text(r.oldest_requested_at), dueAt, overdue: typeof r.overdue === 'boolean' ? r.overdue : passed(dueAt, now), escalation: r.escalated === true ? 1 : 0, again: null,
      docStatus: text(r.status), documentId, proposalId, href: safe(`${documentPath(documentId)}?tab=lifecycle`, documentPath(documentId)), extraLinks: [], counted: false,
      group: { pending: Math.max(1, whole(r.pending) ?? 1), waiting: (Array.isArray(r.waiting) ? r.waiting : []).filter((n): n is string => typeof n === 'string' && !!n),
        more: Math.max(0, whole(r.waiting_more) ?? 0) },
    });
  }
  // the server cuts the list at 200 groups (the most urgent first) and says how many there are: the number on the page is that, not the length of the cut list
  return { items, skipped, total: isRow(raw) ? whole(raw.total) ?? undefined : undefined };
}

export const SOURCE_DEFS: Record<SourceId, SourceDef> = {
  'doc.lifecycle': { id: 'doc.lifecycle', label: 'Documents', feeds: ['decision', 'acknowledgement'], inBadge: true,
    off: (raw) => isRow(raw) && raw.enabled === false, toItems: lifecycleItems },
  'doc.signoff': { id: 'doc.signoff', label: 'Sign-offs', feeds: ['decision'], inBadge: true, toItems: (raw) => signoffItems(raw) },
  'assessment.evidence': { id: 'assessment.evidence', label: 'Assessment approvals', feeds: ['decision'], inBadge: true, toItems: (raw) => evidenceItems(raw) },
  'doc.sent': { id: 'doc.sent', label: 'Requests you sent', feeds: ['sent'], inBadge: false,
    off: (raw) => isRow(raw) && raw.enabled === false, toItems: sentItems },
};

export const BADGE_SOURCES: SourceId[] = (Object.keys(SOURCE_DEFS) as SourceId[]).filter((id) => SOURCE_DEFS[id].inBadge);

// ── the result ───────────────────────────────────────────────────────────────

export type Badge =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'count'; n: number; overdue: number; incomplete: boolean }
  | { kind: 'unknown' };

export interface InboxNotice { source: SourceId; label: string; state: 'unavailable' | 'stale'; message: string; at: number | null; feeds: Section[] }

export interface Counts {
  /** the badge: decisions addressed to the person */
  decision: number;
  /** evidence the person may decide without being asked: listed, not counted */
  canDecide: number;
  /** of `decision`, past their due date */
  overdue: number;
  acknowledgement: number;
  ackOverdue: number;
  /** the requests of the sent list that are listed (the server sends at most 200 groups) */
  sent: number;
  /** the requests the person sent that still wait, as the server counts them: never less than `sent`, more when the list was cut */
  sentTotal: number;
  /** rows a source sent that this build cannot read (counted, not shown) */
  skipped: number;
}

export interface Inbox {
  items: InboxItem[];
  bySection: Record<Section, InboxItem[]>;
  counts: Counts;
  badge: Badge;
  notices: InboxNotice[];
  /** each source as the build saw it: an `enabled: false` answer is `off` */
  sources: Partial<Record<SourceId, SourceState>>;
}

const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
const moment = (iso: string | null): number => parseUtc(iso)?.getTime() ?? Number.POSITIVE_INFINITY;

/** The order inside a section: addressed to me first, then overdue, then the soonest due (none last), then the kind's rank, then the oldest asked, then the key. A total order,
 *  so the list never jumps between refreshes; escalated does not reorder (an escalated request is already overdue). */
export function compareItems(a: InboxItem, b: InboxItem): number {
  return cmp(Number(b.counted), Number(a.counted)) || cmp(Number(b.overdue), Number(a.overdue)) || cmp(moment(a.dueAt), moment(b.dueAt))
    || cmp(KIND_META[a.kind].rank, KIND_META[b.kind].rank) || cmp(moment(a.createdAt), moment(b.createdAt)) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

const answered = (s: SourceState) => s.state === 'ready' || s.state === 'stale' || s.state === 'off';

/** The inbox for the sources given (a missing source is not part of it). `now` is injected so the model is a pure function of its inputs. */
export function buildInbox(inputs: SourceInput[], now: Date = new Date()): Inbox {
  const sources: Partial<Record<SourceId, SourceState>> = {};
  const parts = new Map<SourceId, { items: InboxItem[]; skipped: number; total?: number }>();
  for (const input of inputs) {
    const def = SOURCE_DEFS[input.id];
    if (!def) continue;
    const has = input.state.state === 'ready' || input.state.state === 'stale';
    const off = input.state.state === 'off' || (has && !!def.off?.(input.raw));
    sources[input.id] = off ? { state: 'off' } : input.state;
    if (has && !off) parts.set(input.id, def.toItems(input.raw, now));
  }

  // a sign-off with no request (a document already in review when the life cycle came on) is dropped when the life cycle's list holds the same document's review or approval
  let all: InboxItem[] = [];
  const lifecycle = parts.get('doc.lifecycle');
  const asked = new Set((lifecycle?.items ?? []).filter((i) => i.kind === 'review' || i.kind === 'approval').map((i) => i.documentId));
  parts.forEach((part, id) => { all = all.concat(id === 'doc.signoff' ? part.items.filter((i) => !asked.has(i.documentId)) : part.items); });

  const bySection: Record<Section, InboxItem[]> = { decision: [], acknowledgement: [], sent: [] };
  all.forEach((i) => bySection[i.section].push(i));
  (Object.keys(bySection) as Section[]).forEach((s) => bySection[s].sort(compareItems));

  const decisions = bySection.decision;
  const counted = decisions.filter((i) => i.counted);
  const counts: Counts = {
    decision: counted.length, canDecide: decisions.length - counted.length, overdue: counted.filter((i) => i.overdue).length,
    acknowledgement: bySection.acknowledgement.length, ackOverdue: bySection.acknowledgement.filter((i) => i.overdue).length, sent: bySection.sent.length,
    sentTotal: Math.max(bySection.sent.length, parts.get('doc.sent')?.total ?? 0),
    skipped: Array.from(parts.values()).reduce((n, p) => n + p.skipped, 0),
  };

  const notices: InboxNotice[] = [];
  inputs.forEach((input) => {
    const s = sources[input.id];
    const def = SOURCE_DEFS[input.id];
    if (!s || !def) return;
    if (s.state === 'unavailable') notices.push({ source: input.id, label: def.label, state: 'unavailable', message: s.error, at: null, feeds: def.feeds });
    else if (s.state === 'stale') notices.push({ source: input.id, label: def.label, state: 'stale', message: s.error, at: s.at, feeds: def.feeds });
  });

  const header = BADGE_SOURCES.map((id) => sources[id]).filter((s): s is SourceState => !!s);
  const someAnswered = header.some(answered);
  const loadingSome = header.some((s) => s.state === 'loading');
  const failedSome = header.some((s) => s.state === 'unavailable');
  let badge: Badge;
  if (!someAnswered) badge = failedSome ? { kind: 'unknown' } : { kind: 'loading' };
  // nothing counted yet: never a 0 over a source that failed ("!"), and never a "!" over one that is only slow ("loading": no badge, no claim, until it answers)
  else if (counts.decision === 0) badge = failedSome ? { kind: 'unknown' } : loadingSome ? { kind: 'loading' } : { kind: 'none' };
  else badge = { kind: 'count', n: counts.decision, overdue: counts.overdue, incomplete: loadingSome || failedSome };

  return { items: all, bySection, counts, badge, notices, sources };
}

// ── the badge and the dropdown, as words ─────────────────────────────────────

/** The badge's text: "3", "3!" (a source is missing), "99+", "!" (nothing could be counted); '' for no badge. */
export function badgeText(badge: Badge): string {
  if (badge.kind === 'count') return `${badge.n > 99 ? '99+' : badge.n}${badge.incomplete ? '!' : ''}`;
  return badge.kind === 'unknown' ? '!' : '';
}

/** What the badge says to a screen reader and as its tooltip, with the exact numbers and the sources that are missing. */
export function badgeLabel(inbox: Inbox): string {
  const { badge, counts } = inbox;
  const missing = inbox.notices.filter((n) => n.state === 'unavailable').map((n) => n.label);
  const acks = counts.acknowledgement ? `${counts.acknowledgement.toLocaleString('en-US')} to acknowledge` : '';
  if (badge.kind === 'loading') return 'Needs my action, loading';
  if (badge.kind === 'none') return `Needs my action, nothing to decide${acks ? `, ${acks}` : ''}`;
  if (badge.kind === 'unknown') return `Needs my action: could not be counted${missing.length ? `, ${missing.join(' and ')} could not be loaded` : ''}`;
  const parts = [`${badge.n.toLocaleString('en-US')} to decide`];
  if (badge.overdue) parts.push(`${badge.overdue.toLocaleString('en-US')} overdue`);
  if (acks) parts.push(acks);
  if (badge.incomplete) parts.push(`may be incomplete${missing.length ? `: ${missing.join(' and ')} could not be loaded` : ''}`);
  return `Needs my action: ${parts.join(', ')}`;
}

/** What the top bar's dropdown lists: the first `limit` decisions, how many more there are, one line for the acknowledgements, and what is missing. */
export function dropdownOf(inbox: Inbox, limit = 8) {
  const decisions = inbox.bySection.decision;
  return {
    items: decisions.slice(0, limit),
    more: Math.max(0, decisions.length - limit),
    acknowledgements: inbox.counts.acknowledgement,
    notices: inbox.notices.filter((n) => n.state === 'unavailable'),
    pending: inbox.counts.decision,
  };
}
