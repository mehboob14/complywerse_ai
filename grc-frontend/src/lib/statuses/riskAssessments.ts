// The words of Risk Management > Risk Assessments: one tone and one label per word on EVERY page of the area (the old pages coloured "in progress" amber on one and mint on the next).
// The words are the ones the server writes: RiskAssessment.status (draft, in_progress, under_review, approved, closed: VALID_STATUS_TRANSITIONS in
// modules/erm/routers/risk_assessments.py), FrameworkRiskAssessment.status (in_progress, completed, archived; the UI also met not_started), FrameworkRiskQuestion.status
// (not_started, in_progress, completed, blocked), the AI-system register's status (Open, In Progress, Closed, Accepted: Title-Case strings), the treatment decision and
// control effectiveness an assessed risk carries, and the residual level the AI-system register stores (High / Medium / Low). A word nobody registered reads neutral with its
// own readable label, never a guess; every word is said in words, never a colour alone. The score bands are NOT here: they are the Risk Register's (statuses/risk.ts riskLevel).
import { defineStatuses } from '../status.ts';

/** RiskAssessment.status: a manual assessment's life (draft, in progress, under review, approved, closed). */
export const assessmentStatus = defineStatuses('risk assessment', {
  draft: 'neutral',
  in_progress: { tone: 'progress', label: 'In progress' },
  under_review: { tone: 'pending', label: 'Under review' },
  approved: 'success',
  closed: 'neutral',
});

/** FrameworkRiskAssessment.status: in progress, completed, archived (not_started is the word a question and the older cards used). */
export const frameworkAssessmentStatus = defineStatuses('framework risk assessment', {
  not_started: { tone: 'neutral', label: 'Not started' },
  in_progress: { tone: 'progress', label: 'In progress' },
  completed: 'success',
  archived: 'neutral',
});

/** FrameworkRiskQuestion.status. */
export const questionStatus = defineStatuses('framework question', {
  not_started: { tone: 'neutral', label: 'Not started' },
  in_progress: { tone: 'progress', label: 'In progress' },
  completed: 'success',
  blocked: 'danger',
});

/** The AI-system register's status, as the server stores it (Title-Case words with a space). */
export const aiEntryStatus = defineStatuses('AI system risk', {
  open: 'warning',
  in_progress: { tone: 'progress', label: 'In progress' },
  closed: 'success',
  accepted: 'pending',
});

/** The residual level an AI-system risk stores. It is the person's (or the rules') word, shown as recorded. */
export const residualWord = defineStatuses('residual level', {
  high: 'warning',
  medium: 'progress',
  low: 'success',
});

/** AssessedRisk.treatment_decision. */
export const treatmentDecision = defineStatuses('treatment decision', {
  accept: 'pending',
  mitigate: 'progress',
  transfer: 'progress',
  avoid: 'warning',
});

/** AssessedRisk.control_effectiveness. */
export const controlEffectiveness = defineStatuses('control effectiveness', {
  effective: 'success',
  partially_effective: { tone: 'warning', label: 'Partly effective' },
  ineffective: 'danger',
});

/** A KRI linked to an assessed risk: its threshold state. */
export const thresholdStatus = defineStatuses('KRI threshold', {
  breached: 'danger',
  warning: 'warning',
  within: { tone: 'success', label: 'Within limits' },
  normal: { tone: 'success', label: 'Within limits' },
});

/** Where an AI suggestion came from: the rules (a template) or the AI. The two read differently so nobody edits and saves a template believing it was drafted. */
export const suggestionSource = defineStatuses('suggestion source', {
  rules: { tone: 'neutral', label: 'Suggested by rules' },
  ai: { tone: 'progress', label: 'Suggested by AI' },
});
