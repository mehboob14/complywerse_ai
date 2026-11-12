// The detail of ONE document in the Tracker (shown when its row is opened), without React so `node --test` checks it (detailModel.test.ts): the full life cycle as a stepper
// (Draft > In review > In approval > Approved > Published > Attestation > Acknowledgement, each done / here / next / off with its date and, where something is wrong, a word for it), and for
// each step what the platform knows: who owns and wrote it, each stage of the route with each person's state and due date, the changes asked for or proposed and who they wait for, the
// published version and its review date, the attestation campaign, who has not acknowledged it yet. Everything comes from what the server already says about the document (its row, the
// line of the Tracker, the sign-off route, the lifecycle, the proposed changes, the campaigns, the exceptions); a part that has not arrived is not guessed, the section that reads it says
// "loading" or "could not be loaded". No id, no hash on a screen (U1); no new write action.
import type { RouteStage, StageStatus } from '../../../../../../lib/approvalRoutes.ts';
import type { DocumentLifecycle, LifecycleReply } from '../../../../../../lib/documentLifecycle.ts';
import type { TrackerCampaign, TrackerException, TrackerLine, TrackerSignoff } from '../../../../../../lib/documentTrackerApi.ts';
import type { ProposalList } from '../../../../../../lib/proposals.ts';
import type { Tone } from '../../../../../../lib/status.ts';
import { parseUtc } from '../../../../../../lib/serverTime.ts';
import { reviewState, typeLabel } from '../libraryModel.ts';
import { agoWords, attestationOf, dayOf, daysSince, isLive, nameList, spanWords, type TrackerContext, type TrackerDoc } from '../libraryTracker.ts';
import { blockerOf, stepWord, type Blocker } from './lineModel.ts';

// ─── What the detail reads ───────────────────────────────────────────────────────────────────────────────────────────────

/** A part of the detail the server answers on its own: not here yet, could not be read (or the person may not read it), or here. */
export type Part<T> = { state: 'loading' } | { state: 'failed' } | { state: 'off' } | { state: 'ok'; data: T };
export const ok = <T,>(data: T): Part<T> => ({ state: 'ok', data });

export interface DetailDoc extends TrackerDoc {
  classification?: string | null;
  framework_ids?: number[] | null;
  department_id: number | null;
}
export interface DetailInput {
  doc: DetailDoc;
  line?: TrackerLine | null;
  signoff: Part<TrackerSignoff>;
  lifecycle: Part<LifecycleReply>;
  proposals: Part<ProposalList>;
  campaigns: Part<TrackerCampaign[]>;
  exceptions: Part<TrackerException[]>;
}

// ─── The life cycle ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type StepId = 'draft' | 'review' | 'approval' | 'approved' | 'published' | 'attestation' | 'acknowledgement';
export const STEPS: readonly { id: StepId; name: string }[] = [
  { id: 'draft', name: 'Draft' }, { id: 'review', name: 'In review' }, { id: 'approval', name: 'In approval' }, { id: 'approved', name: 'Approved' },
  { id: 'published', name: 'Published' }, { id: 'attestation', name: 'Attestation' }, { id: 'acknowledgement', name: 'Acknowledgement' },
];

/** done: behind it; here: where it stands; next: still ahead; off: not part of this document's path (archived, expired, a stage nobody is asked at). */
export type StepState = 'done' | 'here' | 'next' | 'off';
export interface DetailStep {
  id: StepId;
  name: string;
  state: StepState;
  /** where it stands is a problem (on hold, late, expired, an exception): drawn with a warning, not as progress */
  problem: boolean;
  /** what a screen reader and the caption under the step say ("Done", "Now", "On hold", "Not requested", "4 of 12") */
  word: string;
  /** the date of the step when the platform has one (naive UTC ISO) */
  date: string | null;
}

const PHASE: Record<'review' | 'approval', (s: RouteStage) => boolean> = { review: (s) => s.kind !== 'approval', approval: (s) => s.kind === 'approval' };
const STATUS_AT: Record<string, number> = { draft: 0, pending_review: 1, review_required: 1, pending_approval: 2, approved: 3, published: 4 };

const signedAt = (sig: TrackerSignoff | undefined, role: 'reviewer' | 'approver'): string | null => {
  const times = (sig?.signatures ?? []).filter((s) => s.decision === 'signed' && s.this_round !== false && s.role_type === role && s.signed_at).map((s) => s.signed_at as string);
  return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
};

/** The stages of one phase that someone is asked at (the stages nobody is named at are skipped by the route). */
export const stagesOf = (sig: TrackerSignoff | undefined, phase: 'review' | 'approval'): RouteStage[] =>
  (sig?.route?.stages ?? []).filter((s) => PHASE[phase](s) && s.status !== 'skipped' && s.people.length > 0);

export function stepsOf(d: DetailInput, ctx: TrackerContext): DetailStep[] {
  const { doc } = d;
  const sig = d.signoff.state === 'ok' ? d.signoff.data : undefined;
  const lc = d.lifecycle.state === 'ok' && d.lifecycle.data.enabled ? (d.lifecycle.data as DocumentLifecycle) : undefined;
  const at = STATUS_AT[doc.status];
  const held = !!(sig?.route?.hold ?? d.line?.hold);
  const make = (id: StepId, state: StepState, word: string, date: string | null = null, problem = false): DetailStep => ({ id, name: STEPS.find((s) => s.id === id)!.name, state, problem, word, date });

  if (doc.status === 'archived') return STEPS.map((s) => make(s.id, 'off', s.id === 'draft' ? 'Archived' : 'Not in use'));

  // 0 to 3: the approval flow, from the status; a phase nobody is asked at is skipped
  const flow = (id: StepId, index: number): DetailStep => {
    const phase = id === 'review' || id === 'approval' ? id : null;
    const skipped = !!sig && !!phase && at !== index && stagesOf(sig, phase).length === 0 && requestsOf(lc, phase, sig.round_started_at).length === 0;
    const date = id === 'draft' ? doc.created_at : id === 'review' ? signedAt(sig, 'reviewer') : id === 'approval' ? signedAt(sig, 'approver') ?? doc.approved_at ?? null : doc.approved_at ?? null;
    if (at === undefined) return make(id, 'done', 'Done', date);                                              // expired, an exception: the flow is behind it
    if (skipped && at > index) return make(id, 'off', 'Skipped');
    if (at > index) return make(id, 'done', 'Done', date);
    if (at === index) {
      const wait = d.line?.waiting?.since ?? sig?.round_started_at ?? null;
      if (id === 'review' || id === 'approval') return make(id, 'here', held ? 'On hold' : 'Now', held ? (sig?.route?.hold?.requested_at ?? d.line?.hold?.since ?? wait) : wait, held);
      return make(id, 'here', id === 'draft' ? 'Now' : 'Ready to publish', id === 'draft' ? doc.created_at : doc.approved_at ?? null);
    }
    return make(id, 'next', 'Not yet');
  };
  const steps: DetailStep[] = [flow('draft', 0), flow('review', 1), flow('approval', 2), flow('approved', 3)];

  // 4 to 6: published, and what is asked of people once it is
  const live = isLive(doc);
  const att = attestationOf(doc, ctx.lookups);
  const attStep: DetailStep = att.state === 'none' ? make('attestation', 'next', live ? 'Not requested' : 'Not yet')
    : att.state === 'complete' ? make('attestation', 'done', 'Everyone acknowledged')
    : att.state === 'not_started' ? make('attestation', 'here', 'Not started')
    : make('attestation', 'here', att.done !== null && att.total !== null ? `${att.done} of ${att.total}` : `${att.pct}%`);
  const ackStep: DetailStep = d.lifecycle.state !== 'ok' ? make('acknowledgement', 'next', d.lifecycle.state === 'loading' ? 'Loading' : '')
    : !lc ? make('acknowledgement', 'next', 'Not switched on')
    : lc.acknowledgements.total === 0 ? make('acknowledgement', 'next', live ? 'Not asked' : 'Not yet')
    : lc.acknowledgements.pending === 0 ? make('acknowledgement', 'done', 'Everyone read it')
    : make('acknowledgement', 'here', `${lc.acknowledgements.done} of ${lc.acknowledgements.total}`);
  const problem = (word: string): DetailStep => make('published', 'here', word, doc.published_at ?? null, true);

  if (doc.status === 'expired') return [...steps, problem('Expired'), { ...attStep, state: 'off', word: 'Not in use' }, { ...ackStep, state: 'off', word: 'Not in use' }];
  if (doc.status === 'exception_applied') return [...steps, problem('Exception applied'), { ...attStep, state: 'off', word: 'Not in use' }, { ...ackStep, state: 'off', word: 'Not in use' }];
  const r = reviewState(doc, ctx.now);
  const lateReview = doc.status === 'published' && r.bucket === 'overdue';
  if (doc.status === 'published') {
    const going = attStep.state === 'here' || ackStep.state === 'here';
    const pub = lateReview ? problem('Review overdue') : make('published', going ? 'done' : 'here', going ? 'Done' : 'Now', doc.published_at ?? null);
    return [...steps, pub, attStep, ackStep];
  }
  // a newer version is on its way over a published one: the published one keeps its attestation and acknowledgements
  const over = !!doc.version_in_force;
  return [...steps, make('published', over ? 'done' : 'next', over ? `v${doc.version_in_force} still applies` : 'Not yet', over ? doc.published_at ?? null : null),
    over ? attStep : { ...attStep, state: 'next', word: 'Not yet' }, over ? ackStep : { ...ackStep, state: 'next', word: 'Not yet' }];
}

// ─── The sections ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Row { label: string; text: string; tone?: Tone }
export interface PersonRow { name: string; word: string; tone: Tone; note: string }
export interface StageBlock { name: string; word: string; tone: Tone; rule: string; progress: string | null; people: PersonRow[] }
export interface People { heading: string; people: PersonRow[]; more: number }
export type SectionId = StepId | 'changes' | 'exceptions' | 'facts';
/** which part of the server's answer a section reads: the view says "loading" or "could not be loaded" for that part, and draws the rest as it is */
export type Source = 'row' | 'signoff' | 'lifecycle' | 'campaigns' | 'proposals' | 'exceptions';
export interface Section {
  id: SectionId;
  title: string;
  step: DetailStep | null;
  sources: Source[];
  rows: Row[];
  stages: StageBlock[];
  people: People | null;
  /** the attestation's progress bar */
  bar: { pct: number; label: string; tone: Tone } | null;
}

export const FIRST_NAMES = 5;

const clip = (text: string | null | undefined, max = 90): string => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const when = (iso: string | null | undefined, now: Date): string => {
  const day = dayOf(iso);
  return day ? `${day} (${agoWords(iso, now)})` : '';
};
const dueWords = (iso: string | null | undefined, now: Date): { text: string; late: boolean } => {
  const due = dayOf(iso);
  if (!due) return { text: '', late: false };
  const days = daysSince(iso, now) ?? 0;
  const passed = (parseUtc(iso)?.getTime() ?? Infinity) < now.getTime();
  return passed && days > 0 ? { text: `due ${due}, ${spanWords(days)} late`, late: true } : passed ? { text: `due ${due}, late`, late: true } : { text: `due ${due}`, late: false };
};

const STAGE_WORD: Record<StageStatus, { word: string; tone: Tone }> = {
  done: { word: 'Done', tone: 'success' }, current: { word: 'Now', tone: 'progress' }, on_hold: { word: 'On hold', tone: 'warning' }, waiting: { word: 'Not yet', tone: 'neutral' },
  not_started: { word: 'Not started', tone: 'neutral' }, skipped: { word: 'Skipped', tone: 'neutral' }, informed: { word: 'Told', tone: 'neutral' },
};
const PERSON_WORD: Record<string, { word: string; tone: Tone }> = {
  signed: { word: 'Signed', tone: 'success' }, waiting: { word: 'Waiting', tone: 'progress' }, not_yet: { word: 'Not asked yet', tone: 'neutral' },
  changes_requested: { word: 'Asked for changes', tone: 'warning' }, delegated: { word: 'Handed over', tone: 'neutral' }, not_needed: { word: 'Not needed', tone: 'neutral' }, informed: { word: 'Told', tone: 'neutral' },
};

/** "everyone signs", "any one signs", "at least 2 sign", one after another or all at once; '' for a stage of one person. */
export function ruleWords(s: Pick<RouteStage, 'rule' | 'order' | 'min_count' | 'due_days' | 'people' | 'kind'>): string {
  if (s.kind === 'information') return 'Told, nobody waits';
  const parts: string[] = [];
  if (s.people.length > 1) {
    parts.push(s.rule === 'any' ? 'any one signs' : s.rule === 'at_least' ? `at least ${s.min_count ?? 1} sign` : 'everyone signs');
    parts.push(s.order === 'in_turn' ? 'one after another' : 'all at once');
  }
  if (s.due_days) parts.push(`${s.due_days} days to act`);
  const text = parts.join(', ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function stageBlock(s: RouteStage, now: Date, since: ReadonlyMap<string, string> = new Map()): StageBlock {
  const st = STAGE_WORD[s.status] ?? STAGE_WORD.waiting;
  const people: PersonRow[] = s.people.map((p) => {
    const w = PERSON_WORD[p.state] ?? PERSON_WORD.not_yet;
    const notes: string[] = [];
    if (p.state === 'signed') {
      if (p.signer && p.signer !== p.display) notes.push(p.signer);
      if (p.at) notes.push(dayOf(p.at));
    } else if (p.state === 'waiting') {
      const due = dueWords(p.due_date, now);
      const asked = daysSince(since.get(p.display), now);
      if (asked !== null) notes.push(`waiting ${spanWords(asked)}`);
      if (due.text) notes.push(due.text);
      if (due.late) return { name: p.display, word: w.word, tone: 'danger', note: notes.join(' · ') };
    } else if (p.state === 'changes_requested' && p.comment) notes.push(`“${clip(p.comment, 70)}”`);
    else if (p.state === 'delegated' && p.delegated_to) notes.push(`to ${p.delegated_to}`);
    if (p.earlier?.kind === 'signed') notes.push(`signed${p.earlier.version ? ` v${p.earlier.version}` : ''} before, asked again`);
    return { name: p.display, word: w.word, tone: w.tone, note: notes.join(' · ') };
  });
  return { name: s.name, word: st.word, tone: st.tone, rule: ruleWords(s), progress: s.progress && s.progress.required > 0 ? `${s.progress.signed} of ${s.progress.required} signed` : null, people };
}


const ROW_WORD: Record<string, { word: string; tone: Tone }> = {
  pending: { word: 'Waiting', tone: 'progress' }, held: { word: 'On hold', tone: 'warning' }, changes_requested: { word: 'Asked for changes', tone: 'warning' },
  delegated: { word: 'Handed over', tone: 'neutral' }, done: { word: 'Signed', tone: 'success' }, rejected: { word: 'Rejected', tone: 'danger' },
};

/** This round's review or approval requests of the document (the lifecycle's rows): who is asked, since when, due when, who signed. What the sign-off route cannot name (a request
 *  made without a participant, a role's member) is still a person the document waits for. */
export function requestsOf(lc: DocumentLifecycle | undefined, kind: 'review' | 'approval', roundStart: string | null | undefined): DocumentLifecycle['approvals'] {
  return (lc?.approvals ?? []).filter((r) => r.kind === kind && r.status in ROW_WORD && (!roundStart || (r.requested_at ?? '') >= roundStart));
}

function blockFromRequests(name: string, rows: DocumentLifecycle['approvals'], now: Date, state: StepState): StageBlock {
  const done = rows.filter((r) => r.status === 'done').length;
  const people: PersonRow[] = rows.map((r) => {
    const w = ROW_WORD[r.status];
    const notes: string[] = [];
    if (r.status === 'pending') {
      const asked = daysSince(r.requested_at, now);
      if (asked !== null) notes.push(`waiting ${spanWords(asked)}`);
      const due = dueWords(r.due_date, now);
      if (due.text) notes.push(due.text);
      return { name: r.user ?? 'Someone', word: w.word, tone: due.late ? 'danger' : w.tone, note: notes.join(' · ') };
    }
    if (r.status === 'done' && r.done_at) notes.push(dayOf(r.done_at));
    if (r.status === 'changes_requested' && r.comment) notes.push(`“${clip(r.comment, 70)}”`);
    return { name: r.user ?? 'Someone', word: w.word, tone: w.tone, note: notes.join(' · ') };
  });
  const st = state === 'done' ? STAGE_WORD.done : state === 'here' ? STAGE_WORD.current : STAGE_WORD.waiting;
  return { name, word: st.word, tone: st.tone, rule: '', progress: `${done} of ${rows.length} signed`, people };
}

const section = (id: SectionId, title: string, step: DetailStep | null, sources: Source[], extra: Partial<Section> = {}): Section => ({ id, title, step, sources, rows: [], stages: [], people: null, bar: null, ...extra });

/** The sections of the detail, in life cycle order, then the changes and exceptions, then the facts. */
export function sectionsOf(d: DetailInput, ctx: TrackerContext): Section[] {
  const { doc, line } = d;
  const now = ctx.now;
  const steps = stepsOf(d, ctx);
  const at = (id: StepId) => steps.find((s) => s.id === id) as DetailStep;
  const sig = d.signoff.state === 'ok' ? d.signoff.data : undefined;
  const lc = d.lifecycle.state === 'ok' && d.lifecycle.data.enabled ? (d.lifecycle.data as DocumentLifecycle) : undefined;
  const out: Section[] = [];

  // Draft
  {
    const s = section('draft', 'Draft', at('draft'), doc.status === 'draft' ? ['row', 'signoff'] : ['row']);
    s.rows.push({ label: 'Owner', text: doc.owner_name?.trim() || 'No owner', tone: doc.owner_id == null ? 'danger' : undefined });
    s.rows.push({ label: 'Author', text: doc.author_name?.trim() || doc.owner_name?.trim() || '—' });
    s.rows.push({ label: 'Last edited', text: when(doc.updated_at, now) || '—' });
    s.rows.push({ label: 'Version', text: doc.current_version ? `v${doc.current_version.replace(/^v/i, '')}` : '—' });
    if (doc.status === 'draft' && sig) {
      const names = (role: 'reviewer' | 'approver') => sig.participants[role].map((p) => p.display);
      const reviewers = names('reviewer'), approvers = names('approver');
      s.rows.push({ label: 'Will review', text: reviewers.length ? nameList(reviewers.slice(0, FIRST_NAMES), Math.max(0, reviewers.length - FIRST_NAMES)) : 'Nobody chosen yet' });
      s.rows.push({ label: 'Will approve', text: approvers.length ? nameList(approvers.slice(0, FIRST_NAMES), Math.max(0, approvers.length - FIRST_NAMES)) : 'Nobody chosen yet' });
    }
    out.push(s);
  }

  // In review, In approval: each stage of the route, each person
  for (const phase of ['review', 'approval'] as const) {
    const step = at(phase);
    const s = section(phase, phase === 'review' ? 'In review' : 'In approval', step, ['signoff', 'row']);
    const stages = stagesOf(sig, phase);
    const asked = new Map((lc?.approvals ?? []).filter((r) => r.status === 'pending' && r.user && r.requested_at).map((r) => [r.user as string, r.requested_at as string] as const));
    const requests = requestsOf(lc, phase, sig?.round_started_at);
    s.stages = stages.length > 0 ? stages.map((x) => stageBlock(x, now, asked)) : requests.length > 0 ? [blockFromRequests(phase === 'review' ? 'Review' : 'Approval', requests, now, step.state)] : [];
    const waiting = line?.waiting && line.stage && ((line.stage.kind === 'approval') === (phase === 'approval')) ? line.waiting : null;
    if (step.state === 'here' && waiting) s.rows.push({ label: 'Waiting since', text: `${dayOf(waiting.since)} (${spanWords(daysSince(waiting.since, now) ?? 0)})`, tone: waiting.overdue > 0 ? 'danger' : undefined });
    if (step.state === 'here' && !waiting && line && !line.hold) s.rows.push({ label: 'Stuck', text: 'Nobody can be asked: a role or department with nobody in it, or the only person wrote it', tone: 'danger' });
    if (step.state === 'off' && s.stages.length === 0) s.rows.push({ label: '', text: 'Nobody is asked at this step on this document' });
    if (step.state === 'next' && sig && s.stages.length === 0) s.rows.push({ label: '', text: 'Nobody chosen yet' });
    out.push(s);
  }

  // Approved
  {
    const step = at('approved');
    const s = section('approved', 'Approved', step, ['row', 'signoff']);
    if (doc.approved_at) s.rows.push({ label: 'Approved', text: when(doc.approved_at, now) });
    const approver = (sig?.signatures ?? []).filter((x) => x.decision === 'signed' && x.role_type === 'approver' && x.this_round !== false).sort((a, b) => (a.signed_at ?? '').localeCompare(b.signed_at ?? '')).pop();
    if (approver?.signer_name && step.state !== 'next') s.rows.push({ label: 'Last signed by', text: approver.signer_name });
    if (doc.status === 'approved') s.rows.push({ label: 'Not published yet', text: 'It waits for someone who can publish it', tone: 'warning' });
    out.push(s);
  }

  // Published
  {
    const step = at('published');
    const s = section('published', 'Published', step, ['row']);
    const r = reviewState(doc, now);
    if (isLive(doc)) {
      s.rows.push({ label: 'Version', text: `v${(doc.version_in_force ?? doc.current_version ?? '').replace(/^v/i, '')}` });
      if (doc.published_at) s.rows.push({ label: 'Published', text: when(doc.published_at, now) });
    } else if (doc.status === 'expired' || doc.status === 'exception_applied') {
      s.rows.push({ label: doc.status === 'expired' ? 'Expired' : 'Exception', text: doc.status === 'expired' ? (when(doc.expiry_date, now) || 'It no longer applies') : 'An exception is in place, so it is not enforced', tone: 'danger' });
    } else s.rows.push({ label: '', text: 'Not published yet' });
    if (isLive(doc) || doc.status === 'approved') {
      const next = dayOf(doc.next_review_date);
      s.rows.push({ label: 'Next review', text: next ? `${next}${r.long ? ` · ${r.long}` : ''}` : 'No review date', tone: r.bucket === 'overdue' ? 'danger' : r.bucket === 'due_soon' ? 'warning' : undefined });
      if (doc.review_cycle_months && doc.review_cycle_months > 0) s.rows.push({ label: 'Review cycle', text: `Every ${doc.review_cycle_months} ${doc.review_cycle_months === 1 ? 'month' : 'months'}` });
    }
    if (doc.expiry_date && doc.status !== 'expired') s.rows.push({ label: 'Expires', text: dayOf(doc.expiry_date) });
    if (line?.versions?.previous) s.rows.push({ label: 'Previous version', text: `v${line.versions.previous.replace(/^v/i, '')}` });
    if (doc.status !== 'published' && doc.version_in_force && doc.current_version && doc.version_in_force !== doc.current_version) {
      s.rows.push({ label: 'Newer version', text: `v${doc.current_version.replace(/^v/i, '')} is ${stepWord(doc, line).toLowerCase()}; v${doc.version_in_force.replace(/^v/i, '')} still applies` });
    }
    out.push(s);
  }

  // Attestation
  {
    const step = at('attestation');
    const a = attestationOf(doc, ctx.lookups);
    const s = section('attestation', 'Attestation', step, ['row', 'campaigns']);
    if (a.state === 'none') s.rows.push({ label: '', text: step.state === 'off' ? 'Not part of this document’s path' : 'Not requested: nobody was asked to attest to it' });
    else {
      const camp = d.campaigns.state === 'ok' ? d.campaigns.data.find((c) => c.status === 'active') ?? d.campaigns.data[0] : undefined;
      if (camp) {
        s.rows.push({ label: 'Campaign', text: camp.name });
        s.rows.push({ label: 'Status', text: camp.status === 'active' ? 'Open' : camp.status === 'closed' ? 'Closed' : 'Draft' });
        const due = dueWords(camp.due_date, now);
        if (due.text) s.rows.push({ label: 'Due', text: a.state === 'complete' ? dayOf(camp.due_date) : due.text.replace(/^due /, ''), tone: due.late && a.state !== 'complete' ? 'danger' : undefined });
      }
      const label = a.done !== null && a.total !== null ? `${a.done} of ${a.total} acknowledged` : `${a.pct}% acknowledged`;
      s.rows.push({ label: 'Acknowledged', text: a.state === 'not_started' ? `Requested, not started: ${label}` : label });
      s.bar = { pct: a.pct ?? 0, label, tone: a.state === 'complete' ? 'success' : a.state === 'not_started' ? 'warning' : 'progress' };
    }
    out.push(s);
  }

  // Acknowledgement
  {
    const step = at('acknowledgement');
    const s = section('acknowledgement', 'Acknowledgement', step, ['lifecycle']);
    if (d.lifecycle.state === 'ok') {
      if (!d.lifecycle.data.enabled) s.rows.push({ label: '', text: 'Acknowledgements are not switched on for this organisation' });
      else if (lc) {
        const ack = lc.acknowledgements;
        if (ack.total === 0) s.rows.push({ label: '', text: step.state === 'off' ? 'Not part of this document’s path' : 'Nobody has been asked to read it yet' });
        else {
          s.rows.push({ label: 'Read it', text: `${ack.done} of ${ack.total} (${ack.percent}%)` });
          if (ack.overdue > 0) s.rows.push({ label: 'Late', text: `${ack.overdue} ${ack.overdue === 1 ? 'person' : 'people'}`, tone: 'danger' });
          const pending = ack.people.filter((p) => p.status === 'pending');
          const dues = pending.map((p) => p.due_date).filter((x): x is string => !!x).sort();
          if (dues.length) s.rows.push({ label: 'Next due', text: dayOf(dues[0]) });
          if (pending.length) {
            s.people = {
              heading: 'Not read yet',
              more: Math.max(0, pending.length - FIRST_NAMES),
              people: pending.slice(0, FIRST_NAMES).map((p) => ({ name: p.user ?? 'Someone', word: p.overdue ? 'Late' : 'Waiting', tone: p.overdue ? 'danger' : 'progress', note: p.due_date ? `due ${dayOf(p.due_date)}` : '' })),
            };
          }
        }
        const meId = lc.me?.id;
        const mineAck = lc.mine.find((r) => r.kind === 'acknowledgement');
        const done = meId != null ? ack.people.find((p) => p.user_id === meId && p.status === 'done') : undefined;
        s.rows.push({ label: 'You', text: mineAck ? `You have not read it yet${mineAck.due_date ? `, due ${dayOf(mineAck.due_date)}` : ''}` : done ? `You read it${done.done_at ? ` on ${dayOf(done.done_at)}` : ''}` : 'You were not asked', tone: mineAck?.overdue ? 'danger' : undefined });
      }
    }
    out.push(s);
  }

  // Changes asked for or proposed, and who they wait for
  {
    const hold = sig?.route?.hold ?? (line?.hold ? { kind: line.hold.kind, requested_by: line.hold.by, requested_at: line.hold.since, comment: '', stage_position: null } : null);
    const pending = d.proposals.state === 'ok' ? d.proposals.data.items.filter((p) => p.status === 'pending') : [];
    const claims = line?.proposals ?? null;
    if (hold || pending.length > 0 || claims) {
      const s = section('changes', 'Changes', null, ['signoff', 'proposals']);
      if (hold) {
        const named = sig?.route?.stages.find((x) => x.position === hold.stage_position)?.name ?? line?.hold?.stage ?? null;
        const stage = named && named !== 'Review' && named !== 'Approval' ? named : null;          // a stage of its own is named; the default route's two are the step itself
        const changes = (hold.kind ?? 'changes') !== 'proposal';
        s.rows.push({ label: 'On hold', text: `Since ${when(hold.requested_at, now) || 'recently'}`, tone: 'warning' });
        s.rows.push({ label: changes ? 'Changes requested' : 'Change proposed', text: `${hold.requested_by ?? 'Someone'}${stage ? ` at ${stage}` : ''}${hold.comment ? `: “${clip(hold.comment, 140)}”` : ''}` });
        const doer = line?.asked ? nameList(line.asked.names, line.asked.more) : (changes ? doc.author_name ?? doc.owner_name : doc.owner_name) ?? (changes ? 'The author' : 'The owner');
        s.rows.push({ label: 'Who can release it', text: changes ? `${doer} makes the changes and resubmits it` : `${doer} accepts or rejects the proposed change` });
      }
      if (pending.length > 0 || claims) {
        const count = pending.length || claims?.count || 0;
        const first = pending.map((p) => p.proposed_at).filter((x): x is string => !!x).sort()[0] ?? claims?.since ?? null;
        s.rows.push({ label: 'Proposed', text: `${count} ${count === 1 ? 'change waits' : 'changes wait'} for ${doc.owner_name?.trim() || 'the owner'}${first ? ` since ${dayOf(first)}` : ''}`, tone: 'warning' });
        if (pending.length > 0) {
          s.people = {
            heading: 'Waiting for the owner',
            more: Math.max(0, pending.length - FIRST_NAMES),
            people: pending.slice(0, FIRST_NAMES).map((p) => ({ name: p.proposed_by.name, word: p.kind === 'statement' ? 'Statement' : 'Text', tone: 'warning' as Tone, note: [p.proposed_at ? dayOf(p.proposed_at) : '', clip(p.message, 80)].filter(Boolean).join(' · ') })),
          };
        }
      }
      out.push(s);
    }
  }

  // Exceptions applied
  if (doc.status === 'exception_applied' || (d.exceptions.state === 'ok' && d.exceptions.data.length > 0)) {
    const s = section('exceptions', 'Exceptions', null, ['exceptions']);
    if (d.exceptions.state === 'ok') {
      for (const e of d.exceptions.data.slice(0, FIRST_NAMES)) s.rows.push({ label: e.exception_type_label ?? 'Exception', text: `${e.title ?? 'Untitled'} · ${e.status.replace(/_/g, ' ')}${e.expiry_date ? ` · until ${dayOf(e.expiry_date)}` : ''}` });
      if (d.exceptions.data.length === 0) s.rows.push({ label: '', text: 'None found' });
    }
    out.push(s);
  }

  // The other facts a person looks for
  {
    const s = section('facts', 'Facts', null, ['row']);
    const unit = doc.department_id != null ? ctx.lookups.departmentPaths?.[String(doc.department_id)] ?? ctx.lookups.departments?.[String(doc.department_id)] : '';
    s.rows.push({ label: 'Unit', text: unit || 'No unit' });
    s.rows.push({ label: 'Type', text: typeLabel(doc.doc_type) });
    s.rows.push({ label: 'Classification', text: doc.classification ? doc.classification.replace(/^./, (c) => c.toUpperCase()) : '—' });
    const fw = (doc.framework_ids ?? []).map((id) => ctx.lookups.frameworks?.[String(id)]?.short).filter((x): x is string => !!x);
    s.rows.push({ label: 'Frameworks', text: fw.length ? nameList(fw.slice(0, 4), Math.max(0, fw.length - 4)) : 'None' });
    if (line?.versions) s.rows.push({ label: 'Versions', text: `${line.versions.count}` });
    out.push(s);
  }
  return out;
}

/** The blocker in words, the same as the line (so the row and its detail never disagree). */
export const detailBlocker = (d: DetailInput, ctx: TrackerContext): Blocker => blockerOf(d.doc, d.line, ctx);


/** The address of a document's page opened at one of its views (`?tab=approvals` is its workflow, `?tab=versions` its change log), whatever the address already carries (the library's `?from=`). */
export function tabHref(href: string, tab: 'approvals' | 'versions' | 'proposals'): string {
  const [path, frag = ''] = href.split('#');
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('tab', tab);
  return `${base}?${params.toString()}${frag ? `#${frag}` : ''}`;
}
