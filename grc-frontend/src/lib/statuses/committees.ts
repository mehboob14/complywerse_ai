// The words of the Committees screens that are not a committee's, a meeting's or an action's status (those are in lib/status.ts): what a committee DECIDED about an
// agenda item (the outcome), whether a member was in the room (the roll call) and where an agenda item stands. The words are the ones the server writes
// (routers/committees.py: OUTCOME_WORDS, ATTENDANCE_WORDS, _VALID_AGENDA_VOTES, the agenda item's status); statuses/committees.test.ts re-reads that file, so a word the server starts writing fails a
// test until it is registered here. A word nobody registered (an outcome typed by hand through the raw API: "Escalated") is neutral with its own readable label, never a guess.
// Tones: success = agreed or present, danger = refused, warning = put off or arrived late, neutral = at rest or noted. Always shown as a word, never a colour alone.
import { defineStatuses } from '../status.ts';

/** MeetingAgendaItem.outcome: Approved and Rejected are what the audit register writes when a committee decides an extension request; Deferred and Noted complete the four. */
export const decisionOutcome = defineStatuses('decision outcome', {
  approved: 'success',
  rejected: 'danger',
  deferred: 'warning',
  noted: 'neutral',
});

/** A member's place on the roll of a meeting (MeetingAttendance.status). `not_marked` is a member the roll has no row for yet (no roll has been taken). */
export const rollStatus = defineStatuses('roll call', {
  present: 'success',
  late: 'warning',
  absent: 'neutral',
  not_marked: { tone: 'neutral', label: 'Not marked' },
});

/** MeetingAgendaItem.status: a decided item is discussed (or deferred), one nobody has dealt with is pending. */
export const agendaStatus = defineStatuses('agenda item', {
  pending: 'neutral',
  discussed: 'success',
  deferred: 'warning',
});

/** A member's vote on an agenda item (MeetingAgendaItemVote.vote): the four the server accepts, said the way the vote buttons say them. */
export const agendaVote = defineStatuses('agenda vote', {
  agreed: { tone: 'success', label: 'Agree' },
  partial: { tone: 'warning', label: 'Partly agree' },
  disagreed: { tone: 'danger', label: 'Disagree' },
  abstain: 'neutral',
});
