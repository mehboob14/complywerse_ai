// The words of the RCSA module (Risk Management > RCSA): one registry per kind of word, on the tone model of status.ts. Every word the server stores is registered
// (rcsa.test.ts re-reads the lists in backend/grc/models/_26_*.py), so a unit the reviewer sent back (`requires_changes`) or rejected has a label and a colour
// like any other: the old pages knew six of the seven words of an assessment and threw on the seventh (G8 P-4).
//
// Tones, one reading of what a word means to the person looking at the row: pending = waiting for someone, progress = moving, success = done, warning =
// needs a look (a returned unit, an open finding), danger = refused or critical, neutral = at rest. A word that only names a kind has no meaning to colour.
import { defineStatuses } from '../status.ts';

/** RCSAAssessment.status: the unit of one business unit in one campaign. `requires_changes` is what "Return" leaves; `rejected` is what "Reject" leaves and nothing leaves it. */
export const assessmentStatus = defineStatuses('RCSA unit', {
  not_started: { tone: 'neutral', label: 'Not started' },
  in_progress: { tone: 'progress', label: 'In progress' },
  submitted: { tone: 'pending', label: 'Submitted' },
  under_review: { tone: 'pending', label: 'Under review' },
  approved: 'success',
  rejected: 'danger',
  requires_changes: { tone: 'warning', label: 'Returned' },
});

/** RCSACampaign.status (`cancelled` is in the model's comment and no route sets it). */
export const campaignStatus = defineStatuses('RCSA campaign', {
  draft: 'neutral',
  active: 'progress',
  closed: 'success',
  cancelled: 'neutral',
});

/** RCSAFinding.status. */
export const findingStatus = defineStatuses('RCSA finding', {
  open: 'warning',
  in_progress: { tone: 'progress', label: 'In progress' },
  remediated: 'success',
  accepted: 'pending',
  closed: 'neutral',
});

/** RCSAFinding.severity: the platform's priority scale. */
export const findingSeverity = defineStatuses('RCSA finding severity', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
});

/** RCSAFinding.finding_type. */
export const findingType = defineStatuses('RCSA finding type', {
  risk_identified: { tone: 'neutral', label: 'Risk identified' },
  control_gap: { tone: 'neutral', label: 'Control gap' },
  control_weakness: { tone: 'neutral', label: 'Control weakness' },
  process_issue: { tone: 'neutral', label: 'Process issue' },
});

/** RCSAQuestion.question_type. */
export const questionType = defineStatuses('RCSA question type', {
  risk_rating: { tone: 'neutral', label: 'Risk rating' },
  control_rating: { tone: 'neutral', label: 'Control rating' },
  yes_no: { tone: 'neutral', label: 'Yes or no' },
  text: { tone: 'neutral', label: 'Text' },
  multiple_choice: { tone: 'neutral', label: 'Multiple choice' },
});

/** RCSAApprovalHistory.action: what happened to a unit, for the trail. */
export const approvalAction = defineStatuses('RCSA review step', {
  submitted: { tone: 'pending', label: 'Submitted' },
  approved: 'success',
  rejected: 'danger',
  returned: { tone: 'warning', label: 'Returned' },
  delegated: { tone: 'neutral', label: 'Handed over' },
});

/** RCSACustomRow inherent / residual label of a register item. */
export const registerLevel = defineStatuses('RCSA register level', {
  critical: 'danger',
  very_high: { tone: 'danger', label: 'Very high' },
  high: 'warning',
  medium: 'progress',
  moderate: 'progress',
  low: 'neutral',
  very_low: { tone: 'neutral', label: 'Very low' },
});

/** The controls scale of the form (RCSAResponse.control_effectiveness). */
export const effectiveness = defineStatuses('control effectiveness', {
  effective: 'success',
  partially_effective: { tone: 'warning', label: 'Partly effective' },
  ineffective: 'danger',
  not_applicable: { tone: 'neutral', label: 'Not applicable' },
});

/** Options of a select in the registry's own order: `[{ value: 'high', label: 'High' }]`. */
export const optionsOf = (registry: { words: readonly string[]; label: (w: string) => string }) => registry.words.map((value) => ({ value, label: registry.label(value) }));
