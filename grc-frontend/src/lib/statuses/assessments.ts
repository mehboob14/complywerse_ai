// The status words of Compliance > Assessments (the assessment workspace and, after it, the register and the types page), one registry per kind of word, built with
// defineStatuses (lib/status.ts) so a pill always has its word and a word nobody registered is neutral with its own readable label.
// Pure, so `node --test src/lib/statuses/assessments.test.ts` runs against it. The tone reading is the platform's: success = done and good, danger = failed or refused,
// warning = needs a look, pending = waiting for a person, progress = being worked on, neutral = at rest.
import { defineStatuses, norm } from '../status.ts';

// ComplianceAssessmentDocumentItem.compliance_status: the server writes complied, partially_complied, not_complied, in_progress (nobody answered yet) and na
// (scoring.py, the item PUT). One vocabulary for every type (audit decision 12): "in_progress" is read "Not answered", because it is the state of a question
// nobody has answered, not of work under way (the DCC tool's five states map onto these five).
export const controlStatus = defineStatuses('assessment control', {
  complied: { tone: 'success', label: 'Complied' },
  partially_complied: { tone: 'warning', label: 'Partially complied' },
  not_complied: { tone: 'danger', label: 'Not complied' },
  in_progress: { tone: 'neutral', label: 'Not answered' },
  na: { tone: 'neutral', label: 'Not applicable' },
});

// The order the five are offered in (a select, a facet): the answers first, then the two that are not one.
export const CONTROL_STATUS_ORDER = ['complied', 'partially_complied', 'not_complied', 'in_progress', 'na'] as const;

// remediation_status: the item PUT stores open, in_progress or closed (lower case since 2026-11-08; rows written before keep "Open", "In Progress", "Closed", and
// norm() reads them as the same words).
export const remediationState = defineStatuses('assessment remediation', {
  open: { tone: 'warning', label: 'Open' },
  in_progress: { tone: 'progress', label: 'In progress' },
  closed: { tone: 'success', label: 'Closed' },
});

// What an assessment is at: a scoped draft being filled in (phase 'scoping'), or the document's own status: draft (an upload nobody moved on), in_progress,
// in_review, completed (PUT /{id} takes any word; the screens use these four), archived.
export const lifecycle = defineStatuses('assessment lifecycle', {
  scoping: { tone: 'pending', label: 'Scoping' },
  draft: { tone: 'neutral', label: 'Draft' },
  in_progress: { tone: 'progress', label: 'In progress' },
  in_review: { tone: 'pending', label: 'In review' },
  completed: { tone: 'success', label: 'Completed' },
  archived: { tone: 'neutral', label: 'Archived' },
});

/** The one word for an assessment: a scoped draft is "scoping" whatever its stored status says; otherwise the stored status. */
export function lifecycleOf(a: { phase?: string | null; status?: string | null }): string {
  if (a.phase === 'scoping') return 'scoping';
  return norm(a.status) || 'draft';
}

// The server's grade of the score (routers/compliance_assessments_router.py /overview: >= 85 excellent, >= 70 good, >= 50 fair, else poor).
export const grade = defineStatuses('assessment grade', {
  excellent: { tone: 'success', label: 'Excellent' },
  good: { tone: 'progress', label: 'Good' },
  fair: { tone: 'warning', label: 'Fair' },
  poor: { tone: 'danger', label: 'Poor' },
});

// AssessmentItemEvidence.status: draft (attached, not sent), pending_review, pending_tier_N (the tier it waits at), approved, rejected, returned; and the two the list
// adds: framework_link (evidence the Evidence module matched to this requirement). "Draft" reads "Not submitted": the file is attached and nobody was asked yet.
export const evidenceApproval = defineStatuses('assessment evidence approval', {
  draft: { tone: 'neutral', label: 'Not submitted' },
  pending_review: { tone: 'pending', label: 'In review' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  returned: { tone: 'warning', label: 'Returned' },
  framework_linked: { tone: 'progress', label: 'Matched from Evidence' },
});

/** "pending_tier_2" is the review at its second step: one word for the pill. */
export function approvalWord(status: string | null | undefined): string {
  const w = norm(status);
  return w.startsWith('pending_tier_') ? 'pending_review' : w || 'draft';
}
