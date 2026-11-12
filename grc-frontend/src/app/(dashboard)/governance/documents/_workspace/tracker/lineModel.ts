// The compact line of a document in the Tracker, without React so `node --test` checks it (lineModel.test.ts): the step it is at in a few words, the BLOCKER in plain words with who (the
// words the person reads when they scan a group: "Waiting on Sara and 1 more", "Stuck: nobody can be asked", "Changes requested by Olivia: Arun has to revise it", "3 proposed changes
// wait for the owner"), and the age pill (how long it has waited). The facts come from the lean row, the server's sets and the line the server gave for this document
// (GET /governance/document-tracker/lines); a name is said only where one of them holds it: a document whose line has not arrived says what its status says, never an invented person.
import type { TrackerLine } from '../../../../../../lib/documentTrackerApi.ts';
import { NO_SETS } from '../../../../../../lib/documentTrackerApi.ts';
import type { Tone } from '../../../../../../lib/status.ts';
import { KIND_META } from '../../../../../../lib/inbox/buildInbox.ts';
import { reviewState } from '../libraryModel.ts';
import { ageLabel, ageTone, agoWords, attestationOf, dayOf, daysSince, nameList, spanWords, type TrackerContext, type TrackerDoc } from '../libraryTracker.ts';

export const STATUS_STEP: Readonly<Record<string, string>> = {
  draft: 'Draft', pending_review: 'In review', pending_approval: 'In approval', approved: 'Approved', published: 'Published',
  review_required: 'Review required', expired: 'Expired', exception_applied: 'Exception applied', archived: 'Archived',
};

/** The step a document is at, in a few words; a stage of its own route is named after it ("In review · Legal check"). */
export function stepWord(d: Pick<TrackerDoc, 'status'>, line?: Pick<TrackerLine, 'stage'> | null): string {
  const base = STATUS_STEP[d.status] ?? d.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const stage = line?.stage?.name;
  return stage && stage !== 'Review' && stage !== 'Approval' ? `${base} · ${stage}` : base;
}

export type BlockerKind =
  | 'none' | 'writing' | 'waiting' | 'stuck' | 'changes' | 'proposals' | 'to_publish' | 'review_late' | 'review_flagged'
  | 'late_acks' | 'attestation_not_started' | 'attestation' | 'expired' | 'exception' | 'archived' | 'unknown_wait';

export interface Blocker {
  kind: BlockerKind;
  text: string;
  /** danger: late or stuck; warning: waiting a long time or needs a decision; progress: moving; success: nothing to do; neutral: nothing to say */
  tone: Tone;
  /** when it began, for the age pill; null: no age to say */
  since: string | null;
  /** it is late (a due date has passed) */
  late: boolean;
}

export interface Age { days: number; label: string; title: string; tone: Tone }

/** The age pill: how long the document has waited on what blocks it ("4 d"), in a tone that grows with the wait. null when the blocker has no date. */
export function ageOf(b: Pick<Blocker, 'since' | 'late' | 'kind'>, now: Date): Age | null {
  if (!b.since || b.kind === 'none' || b.kind === 'archived') return null;
  const days = daysSince(b.since, now);
  if (days === null) return null;
  return { days, label: ageLabel(days), title: b.late ? `Late: waiting ${spanWords(days)}` : `Waiting ${spanWords(days)}`, tone: ageTone(days, b.late) };
}

const who = (names: readonly string[], more: number) => nameList(names, more);

/** What holds the document up, in words. `line` is the server's line for it (undefined: not loaded, or the server did not answer). */
export function blockerOf(d: TrackerDoc, line: TrackerLine | null | undefined, ctx: TrackerContext): Blocker {
  const sets = ctx.sets ?? NO_SETS;
  const people = ctx.people?.get(d.id);
  const owner = d.owner_name?.trim() || null;
  const author = d.author_name?.trim() || owner;
  const none = (text = 'Nothing waiting', tone: Tone = 'neutral'): Blocker => ({ kind: 'none', text, tone, since: null, late: false });
  switch (d.status) {
    case 'archived': return { kind: 'archived', text: 'Taken out of use', tone: 'neutral', since: null, late: false };
    case 'expired': return { kind: 'expired', text: d.expiry_date ? `Ran out on ${dayOf(d.expiry_date)}: no longer applies` : 'No longer applies', tone: 'danger', since: d.expiry_date ?? null, late: true };
    case 'exception_applied': return { kind: 'exception', text: 'An exception is in place: not enforced', tone: 'warning', since: null, late: false };
    default: break;
  }

  // sent back for changes, or held for a proposed change (the route waits)
  const hold = line?.hold ?? null;
  if (hold?.kind === 'changes' || (!hold && sets.changes_requested.has(d.id))) {
    const by = hold?.by ? ` by ${hold.by}` : '';
    const doer = line?.asked && line.asked.kind === 'changes' ? who(line.asked.names, line.asked.more) : author ?? 'the author';
    return { kind: 'changes', text: `Changes requested${by}: ${doer} has to revise it`, tone: 'warning', since: hold?.since ?? null, late: false };
  }
  // a proposed change waits for the owner
  if (line?.proposals || sets.proposals_waiting.has(d.id)) {
    const p = line?.proposals;
    const decider = line?.asked && line.asked.kind === 'decide' ? who(line.asked.names, line.asked.more) : owner ?? 'the owner';
    const text = !p ? `A proposed change waits for ${decider}` : p.count === 1 ? `A change proposed by ${who(p.names, p.more)} waits for ${decider}` : `${p.count} proposed changes wait for ${decider}`;
    return { kind: 'proposals', text, tone: 'warning', since: p?.since ?? null, late: false };
  }

  switch (d.status) {
    case 'pending_review': case 'pending_approval': {
      const w = line?.waiting;
      if (w) {
        const stage = line?.stage && line.stage.name !== 'Review' && line.stage.name !== 'Approval' ? ` at ${line.stage.name}` : '';
        return { kind: 'waiting', text: `Waiting on ${who(w.names, w.more)}${stage}`, tone: w.overdue > 0 ? 'danger' : 'progress', since: w.since, late: w.overdue > 0 };
      }
      const late = sets.late_approvals.has(d.id);
      // the server answered and nobody has a request: nobody can be asked. Without its line, "stuck" without "late" says the same (stuck AND late is a long wait, not a missing person)
      if (line || (sets.stuck.has(d.id) && !late)) return { kind: 'stuck', text: 'Stuck: nobody can be asked', tone: 'danger', since: null, late: true };
      const sent = people?.sent && (people.sent.waiting.length > 0 || people.sent.more > 0) ? who(people.sent.waiting, people.sent.more) : '';
      return { kind: 'unknown_wait', text: sent ? `Waiting on ${sent}` : d.status === 'pending_review' ? 'Waiting for review' : 'Waiting for sign-off', tone: late ? 'danger' : 'progress', since: null, late };
    }
    case 'approved': {
      const when = agoWords(d.approved_at, ctx.now);
      return { kind: 'to_publish', text: `Ready to publish${when ? `: approved ${when}` : ''}`, tone: 'progress', since: d.approved_at ?? null, late: false };
    }
    case 'draft': {
      const name = author ? `${author} is writing it` : 'Being written';
      return { kind: 'writing', text: d.version_in_force ? `${name}. v${d.version_in_force.replace(/^v/i, '')} is still published` : name, tone: 'neutral', since: d.updated_at ?? null, late: false };
    }
    case 'review_required':
      return { kind: 'review_flagged', text: isLiveText(d), tone: 'warning', since: null, late: false };
    case 'published': {
      const r = reviewState(d, ctx.now);
      if (r.bucket === 'overdue') {
        const due = dayOf(d.next_review_date);
        return { kind: 'review_late', text: `${due ? `Review was due ${due}` : 'Review is due'}: ${owner ? `${owner} has to confirm it` : 'it has no owner'}`, tone: 'danger', since: d.next_review_date ?? null, late: true };
      }
      if (sets.late_acknowledgements.has(d.id)) return { kind: 'late_acks', text: 'Some acknowledgements are late', tone: 'danger', since: null, late: true };
      const a = attestationOf(d, ctx.lookups);
      if (a.state === 'not_started') return { kind: 'attestation_not_started', text: 'Attestation asked, not started', tone: 'warning', since: null, late: false };
      if (a.state === 'in_progress') {
        return { kind: 'attestation', text: a.done !== null && a.total !== null ? `Attestation: ${a.done} of ${a.total} acknowledged` : `Attestation: ${a.pct}% acknowledged`, tone: 'progress', since: null, late: false };
      }
      return a.state === 'complete' ? none('Everyone acknowledged', 'success') : none();
    }
    default: return none('');
  }
}

const isLiveText = (d: TrackerDoc): string => (d.version_in_force ? 'Flagged for a fresh review. The published version still applies' : 'Flagged for review');

/** "Needs you" / "You’re late", with what the person is asked to do. */
export function youOf(d: Pick<TrackerDoc, 'id'>, ctx: Pick<TrackerContext, 'people'>): { word: 'Needs you' | 'You’re late'; what: string } | null {
  const m = ctx.people?.get(d.id)?.mine;
  return m ? { word: m.overdue ? 'You’re late' : 'Needs you', what: KIND_META[m.kind].action } : null;
}
