// The words of Third-Party Vendor Risk > Questionnaires (vendor-questionnaires, 2026-11-10): where a questionnaire sent to a supplier stands, and what a shared (exchange) assessment is.
// Same pattern as the other vendor groups: one registry per kind of word on the platform's tone model (lib/status.ts), every word said in full, a word nobody registered reads neutral with a
// readable label (defineStatuses). The STORED words are the server's and are not touched here; only how a person reads them.
//
// Tones: pending = waiting on someone, progress = being worked, success = done, warning = needs a look, danger = serious or late, neutral = at rest.
import { defineStatuses } from '../status.ts';

/** VendorQuestionnaireResponse.status as the staff reads it. The supplier's own words for the same states are lib/statuses/vendorPortal.ts (what the supplier sees). */
export const questionnaireStatus = defineStatuses('sent questionnaire', {
  pending: { tone: 'pending', label: 'Sent' },
  in_progress: { tone: 'progress', label: 'Being answered' },
  returned: { tone: 'warning', label: 'Returned' },
  submitted: { tone: 'progress', label: 'Submitted' },
  under_review: { tone: 'progress', label: 'In review' },
  accepted: { tone: 'success', label: 'Accepted' },
  expired: { tone: 'neutral', label: 'Expired' },
});

/** TPRASharedAssessment.status (the exchange): active, or revoked by someone. The end date it carries is shown as a date: the server does not stop an import at it, so no word here claims it does. */
export const sharedStatus = defineStatuses('shared assessment', {
  active: { tone: 'success', label: 'Shared' },
  revoked: { tone: 'neutral', label: 'Revoked' },
});

/** The residual rating a shared assessment carries (the publisher's, advisory: the buyer re-scores). Said as a rating, not as a tier. */
export const sharedRating = defineStatuses('shared rating', {
  critical: { tone: 'danger', label: 'Critical' },
  high: { tone: 'warning', label: 'High' },
  medium: { tone: 'progress', label: 'Medium' },
  low: { tone: 'success', label: 'Low' },
  unscored: { tone: 'neutral', label: 'Not scored' },
});

/** What kind of assessment a questionnaire hangs on (VendorAssessment.assessment_type): a kind has no meaning to colour. */
export const assessmentKind = defineStatuses('assessment kind', {
  initial: 'neutral',
  annual: 'neutral',
  reassessment: 'neutral',
  ad_hoc: { tone: 'neutral', label: 'Ad hoc' },
  onboarding: 'neutral',
  incident: 'neutral',
});

/** The statuses that wait on the supplier (tpra/portal.py WAITING_ON_VENDOR), the ones that wait on us (answered, not accepted), and the rest. Held to the server's own lists by the test. */
export const WAITING_ON_SUPPLIER = ['pending', 'in_progress', 'returned'] as const;
export const IN_REVIEW = ['submitted', 'under_review'] as const;
/** The order the board and the filters list them in: the way a questionnaire moves. */
export const STATUS_ORDER = ['pending', 'in_progress', 'submitted', 'under_review', 'returned', 'accepted', 'expired'] as const;
