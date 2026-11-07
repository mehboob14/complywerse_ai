// The status words of the Risk Register (Risk Management > Risk Register, the risk page, Reviews), one registry per kind of word, on the same tone model as
// lib/status.ts. The words are the ones the server writes: Risk.status (open, in_treatment, mitigated, accepted, closed; the importer and older rows also write
// mitigating, under_review, resolved, cancelled, which the dashboards fold into the five: `_bucket_status` in modules/erm/routers/risks.py), the score band
// (critical >= 20, high >= 12, medium >= 6, low), the SLA state (services/module_settings.sla_state), the treatment state the risk page derives, and
// RiskReview.status / RiskMitigationAction.status. A word nobody registered reads neutral with its own readable label, never a guess; every word is said in words,
// never a colour alone.
// Tones: open = needs a look (amber), in treatment = moving (blue), mitigated = done (green), accepted = a decision taken (purple), closed = at rest (grey).
import { defineStatuses } from '../status.ts';

/** Risk.status. The five canonical words first, then the ones the importer / older rows write. */
export const riskStatus = defineStatuses('risk', {
  open: 'warning',
  in_treatment: { tone: 'progress', label: 'In treatment' },
  mitigating: { tone: 'progress', label: 'Mitigating' },
  under_review: { tone: 'pending', label: 'Under review' },
  mitigated: 'success',
  accepted: 'pending',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
});

/** The score band of a risk (residual score, else inherent): critical >= 20, high >= 12, medium >= 6, low below. "none" is a risk with no score yet. */
export const riskLevel = defineStatuses('risk level', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'success',
  none: { tone: 'neutral', label: 'Not scored' },
});

/** Where a risk stands against the Risk Register SLA (`sla.state`). */
export const riskSla = defineStatuses('risk SLA', {
  breached: { tone: 'danger', label: 'Overdue' },
  due_soon: { tone: 'warning', label: 'Due soon' },
  on_track: { tone: 'success', label: 'On track' },
  paused: { tone: 'neutral', label: 'Paused' },
  no_due_date: { tone: 'neutral', label: 'No due date' },
  closed: { tone: 'neutral', label: 'Closed' },
});

/** The treatment state the risk page derives (never stored): a plan with the risk mitigated is Completed, a plan is In progress, else Not started. */
export const riskTreatment = defineStatuses('risk treatment', {
  not_started: { tone: 'danger', label: 'Not started' },
  in_progress: { tone: 'warning', label: 'In progress' },
  completed: { tone: 'success', label: 'Completed' },
});

/** RiskReview.status (modules/erm/routers/reviews.py). */
export const riskReviewStatus = defineStatuses('risk review', {
  pending: 'pending',
  in_review: { tone: 'progress', label: 'In review' },
  completed: 'success',          // what the Reviews page writes when a review is completed
  approved: 'success',
  rejected: 'danger',
  skipped: 'neutral',
  overdue: 'danger',             // never written by the server: the page works it out from the due date
});

/** RiskMitigationAction.status. */
export const riskActionStatus = defineStatuses('mitigation action', {
  open: 'neutral',
  in_progress: { tone: 'progress', label: 'In progress' },
  completed: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
});

/** `Risk.source_type`: where the risk came from. */
export const riskSource = defineStatuses('risk source', {
  manual: { tone: 'neutral', label: 'Manual entry' },
  register_import: { tone: 'neutral', label: 'Register import' },
  assessment: { tone: 'neutral', label: 'Risk assessment' },
  incident: { tone: 'neutral', label: 'Incident' },
  rcsa: { tone: 'neutral', label: 'RCSA finding' },
  framework_gap: { tone: 'neutral', label: 'Framework gap' },
  risk_library: { tone: 'neutral', label: 'Added from a standard' },
  ubl_import: { tone: 'neutral', label: 'UBL register' },
  nca_import: { tone: 'neutral', label: 'NCA register' },
});

/** The indicator a linked control carries on the risk page (derived from its checks' latest runs; the residual score is never changed by it). Labels are the control pages' own. */
export const controlIndicator = defineStatuses('control indicator', {
  passed: { tone: 'success', label: 'Passing' },
  failed: { tone: 'danger', label: 'Failing' },
  partial: { tone: 'warning', label: 'Partial' },
  error: { tone: 'warning', label: 'Error' },
  expired: { tone: 'warning', label: 'Expired' },
  collection_failed: { tone: 'pending', label: 'Not collected' },
  running: { tone: 'progress', label: 'Running' },
  not_run: { tone: 'neutral', label: 'Not run' },
  connect_one: { tone: 'neutral', label: 'Connect a source' },
  unbound: { tone: 'neutral', label: 'No check yet' },
  manual: { tone: 'neutral', label: 'Manual' },
});
