// The words of the Vendor Risk Intake page (the requests to bring a vendor in) that `lib/statuses/vendor.ts` does not already say. Own file so the other vendor groups never touch the same
// lines. A request is a vendor record with an `intake_status` (tpra/intake.py STATUSES): the requester writes a draft and submits it, the review team picks it up (in_review), turns it down
// (rejected) or the lifecycle's approval gate approves it. A word nobody registered reads neutral with a readable label, never a guess; every word is said in words, never a colour alone.
// Pure (no React), so `node --test` runs statuses/vendorIntake.test.ts against it (it re-reads the server's list of statuses).
import { defineStatuses } from '../status.ts';

/** `Vendor.intake_status`: where a request stands, in the words the review team and the requester use. */
export const intakeRequest = defineStatuses('intake request', {
  draft: { tone: 'neutral', label: 'Draft' },
  submitted: { tone: 'pending', label: 'Awaiting decision' },
  in_review: { tone: 'progress', label: 'In review' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Declined' },
});

/** The duplicate screening of a request that is still open: "flagged" when it may already be on record, "screened" when it was checked and is not. */
export const intakeScreening = defineStatuses('intake screening', {
  flagged: { tone: 'warning', label: 'Possible duplicate' },
  screened: { tone: 'success', label: 'No duplicate found' },
});

/** How soon the requester needs it (`request.urgency`): high is the one the queue puts first. */
export const intakeUrgency = defineStatuses('intake urgency', {
  low: { tone: 'neutral', label: 'Low urgency' },
  normal: { tone: 'progress', label: 'Normal urgency' },
  high: { tone: 'warning', label: 'High urgency' },
});
