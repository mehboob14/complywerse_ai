// The status words of Evidence Management (the evidence workspace and the requirements catalogue), one registry per kind of word, built with
// defineStatuses (lib/status.ts) so a pill always has its word and a word nobody registered is neutral with its own readable label.
// Pure, so `node --test src/lib/statuses/evidence.test.ts` runs against it. The tone reading is the platform's: success = done and good, danger =
// refused, lapsed or failed, warning = needs a look, pending = waiting for a person, progress = being worked on, neutral = at rest.
import { defineStatuses } from '../status.ts';

// Evidence.status: models/_10 (draft, pending_review, approved, rejected), routers/evidence.py + router.py (the module lists draft, pending_review,
// approved, rejected, expired, archived), lifecycle.py (submit -> pending_review, review approve -> approved, review reject -> back to draft with the
// reviewer's comment, expire -> expired). "stale" is not a status the server writes: it is the is_stale flag (past its validity), which the workspace
// filters by as if it were one and shows as a second pill.
export const evidenceStatus = defineStatuses('evidence', {
  draft: 'neutral',
  pending_review: { tone: 'pending', label: 'Pending review' },
  approved: 'success',
  rejected: 'danger',
  expired: 'danger',
  archived: 'neutral',
  stale: { tone: 'warning', label: 'Stale' },
  // past its validity (the server works it out when it reads: the stored flag is only ever set by hand). A file can be Approved and Lapsed: it was approved, and is no longer in date.
  lapsed: { tone: 'danger', label: 'Lapsed' },
});

// Where a file stands against its date (the Library's Freshness facet and the Insights cards): in date, ending within 30 days, past it, or no date at all.
export const freshnessState = defineStatuses('evidence freshness', {
  in_date: { tone: 'success', label: 'In date' },
  expiring: { tone: 'warning', label: 'Expiring in 30 days' },
  lapsed: { tone: 'danger', label: 'Lapsed' },
  no_expiry: { tone: 'neutral', label: 'No expiry' },
});

// AuditPackage.status (models/_10: draft, finalized, exported, archived; audit_packages.py moves a draft to finalized, a finalized one to exported).
export const packageStatus = defineStatuses('audit package', {
  draft: 'neutral',
  finalized: { tone: 'progress', label: 'Finalized' },
  exported: 'success',
  archived: 'neutral',
});

// AuditPackageAccessLog.action (audit_packages.py writes exported, downloaded, legal_hold_set, legal_hold_removed; the model also names viewed).
export const packageLog = defineStatuses('audit package log', {
  exported: { tone: 'success', label: 'Exported' },
  downloaded: { tone: 'progress', label: 'Downloaded' },
  viewed: { tone: 'neutral', label: 'Viewed' },
  legal_hold_set: { tone: 'warning', label: 'Legal hold set' },
  legal_hold_removed: { tone: 'neutral', label: 'Legal hold removed' },
});

// Where the AI review of an uploaded file stands (services/evidence_review.py writes it on the file: queued -> running (reading, rating, matching)
// -> done | failed | unavailable; a run silent for six minutes is reported failed with `stopped`; a file whose reading never finished for ten
// minutes is `ocr_stalled`). "rated" is the file that has a score, whatever the run did after. A stuck or failed run is said as such: never "rating" for ever.
export const reviewState = defineStatuses('evidence AI review', {
  queued: { tone: 'progress', label: 'Waiting to start' },
  reading: { tone: 'progress', label: 'Reading the file' },
  rating: { tone: 'progress', label: 'AI rating' },
  matching: { tone: 'progress', label: 'Matching to clauses' },
  rated: { tone: 'success', label: 'Rated' },
  failed: { tone: 'danger', label: 'Not rated' },
  stopped: { tone: 'danger', label: 'Review stopped' },
  unavailable: { tone: 'neutral', label: "Can't be rated by AI" },
  ocr_stalled: { tone: 'warning', label: 'Reading stalled' },
  none: { tone: 'neutral', label: 'Not rated yet' },
});

// How mature a file is as audit evidence, from its score: the bands the workspace always drew (80, 60, 40).
export const maturityLevel = defineStatuses('evidence maturity', {
  strong: { tone: 'success', label: 'Strong' },
  fair: { tone: 'progress', label: 'Fair' },
  weak: { tone: 'warning', label: 'Weak' },
  poor: { tone: 'danger', label: 'Poor' },
  unrated: { tone: 'neutral', label: 'Not rated' },
});

// How near a file's validity is to ending (30 days is the line the workspace and the summary always used).
export const expiryState = defineStatuses('evidence expiry', {
  expired: { tone: 'danger', label: 'Expired' },
  expiring: { tone: 'warning', label: 'Expiring soon' },
  valid: { tone: 'success', label: 'Valid' },
  none: { tone: 'neutral', label: 'No expiry' },
});

// Evidence.ocr_status: pending, processing, completed, failed, not_applicable (a file type with no text to read).
export const ocrStatus = defineStatuses('evidence OCR', {
  pending: { tone: 'neutral', label: 'Waiting' },
  processing: { tone: 'progress', label: 'Reading' },
  completed: { tone: 'success', label: 'Done' },
  failed: { tone: 'danger', label: 'Failed' },
  not_applicable: { tone: 'neutral', label: 'Not needed' },
});

// ControlEvidenceRequirement.status (models/_17: "draft -> submitted -> pending_review -> approved/rejected"; framework_upload/routers/parser.py).
export const requirementStatus = defineStatuses('evidence requirement', {
  draft: 'neutral',
  submitted: { tone: 'progress', label: 'Submitted' },
  pending_review: { tone: 'pending', label: 'Pending review' },
  approved: 'success',
  rejected: 'danger',
});
