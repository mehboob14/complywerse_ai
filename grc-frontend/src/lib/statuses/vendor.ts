// The status words of Third-Party Vendor Risk, one registry per kind of word on the platform's tone model (lib/status.ts). They used to live in the module's own kit
// (vendor-risk/_ui/tones.ts, which is now a thin adapter over this file so every old import keeps working); the pages that move to components/ui/ds import the registries from
// here and draw `<StatusPill {...statusPill(vendorX, word)} />`. A word nobody registered reads neutral with its own readable label (defineStatuses), never a guess; every word is
// said in words, never a colour alone. Pure (no React), so `node --test` runs statuses/vendor.test.ts against it.
//
// Tones: the module's own families: Verity's (a vendor is "suspended", a request "in_review") plus the words Compliverse's rows carry.
import { defineStatuses } from '../status.ts';

const STAGE = {
  not_started: 'pending', in_progress: 'progress', complete: 'success', completed: 'success', skipped: 'neutral', blocked: 'warning',
} as const;

/** A vendor's lifecycle status, and the status of one stage of its lifecycle. */
export const vendorLifecycle = defineStatuses('vendor lifecycle', {
  ...STAGE,
  requested: 'pending', prospect: 'pending',
  onboarding: 'progress', under_review: 'progress', in_review: 'progress',
  approved: 'success', active: 'success',
  flagged: 'danger', rejected: 'danger',
  on_hold: 'warning', suspended: 'warning', offboarding: 'warning',
  offboarded: 'neutral', inactive: 'neutral', retired: 'neutral', terminated: 'neutral', archived: 'neutral',
});

/** The status of one stage of the lifecycle (a stage that is "not started" is pending, "blocked" is a warning). */
export const vendorStage = defineStatuses('vendor stage', { ...STAGE });

/** A finding's status (open is the alarm here and only a warning on a condition). */
export const vendorFinding = defineStatuses('vendor finding', {
  open: 'danger', overdue: 'danger',
  in_remediation: 'progress', in_progress: 'progress',
  accepted: 'pending', risk_accepted: 'pending',
  closed: 'success', remediated: 'success', resolved: 'success', verified: 'success',
});

/** The four gate decisions, and how an intake request ends. */
export const vendorDecision = defineStatuses('vendor decision', {
  approve: 'success', approved: 'success', auto_approved: 'success',
  approve_with_conditions: 'warning', approved_with_conditions: 'warning',
  defer: 'pending', deferred: 'pending', pending: 'pending', submitted: 'pending',
  in_review: 'progress',
  draft: 'neutral',
  reject: 'danger', rejected: 'danger', declined: 'danger',
});

/** A condition of an approval: "open" is a warning here. */
export const vendorCondition = defineStatuses('vendor condition', { open: 'warning', met: 'success', overdue: 'danger', waived: 'neutral' });

export const vendorAssessment = defineStatuses('vendor assessment', {
  pending: 'pending', not_started: 'pending',
  draft: 'neutral',
  sent: 'progress', in_progress: 'progress', submitted: 'progress', in_review: 'progress',
  reviewed: 'success', scored: 'success', completed: 'success',
  expired: 'danger', declined: 'danger',
  cancelled: 'neutral', superseded: 'neutral', archived: 'neutral',
});

/** What we collected from a vendor: asked for, in, read; plus how fresh a certificate or report is. */
export const vendorDocument = defineStatuses('vendor document', {
  requested: 'pending', pending: 'pending',
  received: 'progress',
  reviewed: 'success', approved: 'success', valid: 'success', current: 'success',
  expiring: 'warning', outdated: 'warning',
  expired: 'danger', missing: 'danger', overdue: 'danger', rejected: 'danger',
  not_requested: 'neutral',
});

export const vendorContract = defineStatuses('vendor contract', {
  draft: 'neutral', terminated: 'neutral',
  pending: 'pending',
  active: 'success',
  expiring: 'warning', renewal_due: 'warning',
  expired: 'danger',
});

export const vendorUrgency = defineStatuses('request urgency', { low: 'neutral', normal: 'progress', high: 'warning', urgent: 'danger' });

export const vendorScreening = defineStatuses('vendor screening', {
  pending: 'pending', not_screened: 'pending',
  passed: 'success', clear: 'success',
  flagged: 'warning',
  failed: 'danger',
});

/** The grade of an assessment (A best, F worst). */
export const vendorGrade = defineStatuses('vendor grade', {
  a: { tone: 'success', label: 'Grade A' }, b: { tone: 'success', label: 'Grade B' }, c: { tone: 'progress', label: 'Grade C' },
  d: { tone: 'warning', label: 'Grade D' }, e: { tone: 'danger', label: 'Grade E' }, f: { tone: 'danger', label: 'Grade F' },
});

/** A tier (and a finding's severity: one ramp, one set of words). */
export const vendorTier = defineStatuses('vendor tier', {
  critical: 'danger', high: 'warning', medium: 'progress', low: 'success',
  not_tiered: { tone: 'neutral', label: 'Not tiered' },
});

/** The band of a residual score on the tenant's own thresholds (75 / 50 / 25 unless the Policy page changed them): `residualBand` of _lib/vendorRules.ts. */
export const vendorBand = defineStatuses('residual band', {
  critical: 'danger', high: 'warning', medium: 'progress', low: 'success',
  none: { tone: 'neutral', label: 'Not scored' },
});

/** The ONE thing a vendor is waiting on, in the register's order (the server's `next_action.code` and the Overview's `attention_counts`): the first that holds wins.
 *  danger: already late; warning: something is missing; progress: someone is working on it. */
export const vendorNextStep = defineStatuses('vendor next step', {
  suspended: { tone: 'danger', label: 'Suspended' },
  reassessment_overdue: { tone: 'danger', label: 'Reassessment overdue' },
  not_tiered: { tone: 'warning', label: 'Needs tiering' },
  awaiting_approval: { tone: 'progress', label: 'Awaiting approval' },
  response_to_review: { tone: 'progress', label: 'Answers to review' },
  documents_expired: { tone: 'danger', label: 'Documents expired' },
  weak_grade: { tone: 'warning', label: 'Weak grade' },
  no_owner: { tone: 'warning', label: 'No owner' },
  reassessment_due: { tone: 'progress', label: 'Reassessment due' },
  offboarding: { tone: 'warning', label: 'Finish offboarding' },
});

/** A planned action's status (vendorActionsApi). */
export const vendorAction = defineStatuses('planned action', {
  scheduled: { tone: 'progress', label: 'Planned' },
  done: { tone: 'success', label: 'Done' },
  failed: { tone: 'danger', label: 'Could not happen' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
});

/** What a planned action is. */
export const vendorActionKind = defineStatuses('planned action kind', {
  todo: { tone: 'neutral', label: 'To-do' },
  questionnaire: { tone: 'progress', label: 'Questionnaire' },
  checkin: { tone: 'progress', label: 'Check-in' },
  reassessment: { tone: 'progress', label: 'Reassessment' },
});

/** The state of an item of the Work queue (the 23-condition attention queue). */
export const vendorQueueState = defineStatuses('work queue item', {
  open: { tone: 'warning', label: 'Open' },
  snoozed: { tone: 'pending', label: 'Snoozed' },
  closed: { tone: 'neutral', label: 'Closed' },
});
