// The words of the supplier portal, as a supplier reads them (own file, like the other groups'). Two records, two registries: a questionnaire sent to the supplier
// and a request (a document, some information, a finding to fix). Every word the server writes is registered (vendorPortal.test.ts re-reads the server's lists), every
// word is said in full, and a word nobody registered reads neutral with a readable label. "closed" is not a stored word: it is what the portal says about a
// questionnaire that is still waiting but whose link has run out.
// Tones: pending = waiting on the supplier, progress = under way, warning = needs a look, success = done, danger = late, neutral = at rest.
import { defineStatuses } from '../status.ts';

/** VendorQuestionnaireResponse.status (+ the portal's own "closed"). Sent and in review are green: the supplier has nothing left to do. */
export const portalQuestionnaire = defineStatuses('supplier questionnaire', {
  pending: { tone: 'pending', label: 'Not started' },
  in_progress: { tone: 'progress', label: 'In progress' },
  returned: { tone: 'warning', label: 'Questions for you' },
  submitted: { tone: 'success', label: 'Submitted' },
  under_review: { tone: 'success', label: 'In review' },
  accepted: { tone: 'success', label: 'Accepted' },
  closed: { tone: 'neutral', label: 'Closed' },
});

/** TPRASupplierRequest.status: open -> submitted -> accepted, or returned (open to the supplier again), or cancelled. */
export const portalRequest = defineStatuses('supplier request', {
  open: { tone: 'pending', label: 'To do' },
  returned: { tone: 'warning', label: 'Returned to you' },
  submitted: { tone: 'success', label: 'Sent' },
  accepted: { tone: 'success', label: 'Accepted' },
  cancelled: { tone: 'neutral', label: 'Withdrawn' },
});

/** What a thing on the supplier's list is. A kind has no meaning to colour. */
export const portalKind = defineStatuses('supplier item', {
  questionnaire: 'neutral',
  document: 'neutral',
  information: 'neutral',
  finding: { tone: 'neutral', label: 'Finding to fix' },
});

/** What a due day says about something still open: only "late" is a state; on time is the absence of it. */
export const portalLateness = defineStatuses('supplier lateness', {
  late: 'danger',
});
