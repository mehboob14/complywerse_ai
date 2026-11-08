// The status words of Controls Automation (`/automation/*`, the Connections page, and the Catalog / Library on the Compliance side), one registry per kind of word,
// on the same tone model as lib/status.ts. Before this file the area spoke through four vocabularies (components/soc2/ui.tsx CONTROL_STATUS, the testing workbench's
// effectiveness, the assurance designation and the Catalog's EFF / STATUS_BADGE / IMPL_BADGE maps): "Partial" was amber, "Partially effective" amber, a designation
// "Partial" amber, "Not run" violet and "Not tested" slate. Here one word has one tone wherever it is drawn, and a pill always carries its word.
// Pure, so `node --test src/lib/statuses/controls.test.ts` runs against it; the test re-reads the backend files that write the words, so a word the server starts
// writing fails a test until it is registered here. A word nobody registered is neutral with a readable label, never a guess.
// Tones: success = done and good, danger = failed or refused, warning = needs a look (also: too old to rely on), pending = waiting for a person or not yet collected,
// progress = being worked on, neutral = at rest. REVIEWER TO CONFIRM: "Not collected" is pending (purple) as it was: a connector that cannot authenticate is never red.
import { defineStatuses, type Tone } from '../status.ts';

/** A control's automated status (`overall_status`): automation/router.py `_aggregate_status` over its checks' latest results, plus the three words the list gives a control
 *  with no result to aggregate (`connect_one` automatable and nothing connected, `unbound` automatable and no check reaches it yet, `manual`). `pending` is read as `running`. */
export const controlStatus = defineStatuses('control', {
  passed: { tone: 'success', label: 'Passing' },
  failed: { tone: 'danger', label: 'Failing' },
  partial: { tone: 'warning', label: 'Partial' },
  error: { tone: 'warning', label: 'Check error' },
  // Deliberately not red: neither of these says the control is failing. One says the result is too old to rely on, the other that nothing could be looked at.
  expired: { tone: 'warning', label: 'Expired' },
  collection_failed: { tone: 'pending', label: 'Not collected' },
  running: { tone: 'progress', label: 'Running' },
  not_run: { tone: 'neutral', label: 'Not run' },
  connect_one: { tone: 'neutral', label: 'Connect a source' },
  unbound: { tone: 'neutral', label: 'No check yet' },
  manual: { tone: 'neutral', label: 'Manual' },
});

/** The order the posture bar and the Status facet list the words in: what needs a person first, then what is fine, then what has no result. */
export const CONTROL_STATUS_ORDER = [
  'failed', 'expired', 'collection_failed', 'error', 'partial', 'running', 'passed', 'not_run', 'connect_one', 'unbound', 'manual',
] as const;

/** Design and operating effectiveness of a control (ControlWorkItem.design_effectiveness / operating_effectiveness) and the result of a test (ControlWorkTest.result).
 *  "Not tested" is the word for none. */
export const testResult = defineStatuses('test result', {
  effective: { tone: 'success', label: 'Effective' },
  partially_effective: { tone: 'warning', label: 'Partially effective' },
  ineffective: { tone: 'danger', label: 'Ineffective' },
  not_tested: { tone: 'neutral', label: 'Not tested' },
  pending: { tone: 'neutral', label: 'Not concluded' },
});

/** The assurance designation of a control (SCFControlState.designation, written by test sign-off through testing_rules.control_designation; CDPAS Standard 6.5). */
export const designation = defineStatuses('designation', {
  satisfactory: { tone: 'success', label: 'Satisfactory' },
  partial: { tone: 'warning', label: 'Partial' },
  deficient: { tone: 'danger', label: 'Deficient' },
  alternative_control: { tone: 'success', label: 'Alternative control' },
  na: { tone: 'neutral', label: 'Not applicable' },
  not_assessed: { tone: 'neutral', label: 'Not assessed' },
});

/** One required artifact (and the control's readiness strip): assurance.py gives each artifact `state`, and `readiness` counts the same five words. */
export const evidenceNeed = defineStatuses('evidence need', {
  satisfied: { tone: 'success', label: 'Satisfied' },
  pending_review: { tone: 'pending', label: 'Pending review' },
  failing: { tone: 'danger', label: 'Failing' },
  stale: { tone: 'warning', label: 'Expired' },
  missing: { tone: 'warning', label: 'Needs evidence' },
});

/** One file attached to a control (AssuranceEvidence.state): approved, pending, stale (past its validity) or rejected. */
export const evidenceFile = defineStatuses('control evidence file', {
  approved: { tone: 'success', label: 'Approved' },
  pending: { tone: 'pending', label: 'Pending review' },
  stale: { tone: 'warning', label: 'Expired' },
  rejected: { tone: 'danger', label: 'Rejected' },
});

/** ControlWorkItem.implementation_status (models/_44: not_started | in_progress | implemented | verified | not_applicable). "Implemented" waits for its verification. */
export const workProgress = defineStatuses('work progress', {
  not_started: { tone: 'neutral', label: 'Not started' },
  in_progress: { tone: 'progress', label: 'In progress' },
  implemented: { tone: 'pending', label: 'Implemented' },
  verified: { tone: 'success', label: 'Verified' },
  not_applicable: { tone: 'neutral', label: 'Not applicable' },
});

/** ControlWorkTest.status (assurance.py: in_progress -> completed on conclude -> reviewed on sign-off; reopen goes back to in_progress). */
export const testRun = defineStatuses('test', {
  in_progress: { tone: 'progress', label: 'In progress' },
  completed: { tone: 'pending', label: 'Awaiting sign-off' },
  reviewed: { tone: 'success', label: 'Signed off' },
});

/** The result of one test step or sample (StepResult: pass | exception | not_applicable). */
export const stepResult = defineStatuses('test step', {
  pass: { tone: 'success', label: 'Pass' },
  exception: { tone: 'danger', label: 'Exception' },
  not_applicable: { tone: 'neutral', label: 'Not applicable' },
});

/** One automated result row (SCFCheckResult.status: pass | fail | error | not_run) and `expired` once its validity has passed. An error is a check that could not collect. */
export const checkResult = defineStatuses('automated result', {
  pass: { tone: 'success', label: 'Passed' },
  fail: { tone: 'danger', label: 'Failed' },
  error: { tone: 'pending', label: 'Not collected' },
  not_run: { tone: 'neutral', label: 'Not run' },
  expired: { tone: 'warning', label: 'Expired' },
});

/** How a collector (a check plugin of a connected source) is doing: automation/router.py overview `collection.state`. */
export const collectionHealth = defineStatuses('collection', {
  healthy: { tone: 'success', label: 'Healthy' },
  stale: { tone: 'warning', label: 'Stale' },
  failing: { tone: 'danger', label: 'Failing' },
  never_run: { tone: 'neutral', label: 'Never run' },
});

/** Whether a control has a person answerable for it: scf/ownership.py `ownership_status_for` (no owner, owner with the next due date passed, else ok). */
export const ownership = defineStatuses('ownership', {
  ok: { tone: 'success', label: 'Owned' },
  overdue: { tone: 'danger', label: 'Overdue' },
  unowned: { tone: 'warning', label: 'Needs an owner' },
});

/** A custom control's lifecycle (scf/custom_controls.py VALID_LIFECYCLE) and the Catalog's `deprecated`. */
export const controlLifecycle = defineStatuses('control lifecycle', {
  draft: { tone: 'neutral', label: 'Draft' },
  pending_approval: { tone: 'pending', label: 'In approval' },
  active: { tone: 'success', label: 'Active' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  rejected: { tone: 'danger', label: 'Rejected' },
  deprecated: { tone: 'warning', label: 'Deprecated' },
});

/** An applicability decision (SCFControlState.status: scf/router.py writes pending_review on a request, approved or rejected on the review; draft until anyone asks). */
export const applicabilityRequest = defineStatuses('applicability request', {
  draft: { tone: 'neutral', label: 'No request' },
  pending_review: { tone: 'pending', label: 'Waiting for a reviewer' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
});

/** An audit period (SCFAuditPeriod.status: open | fieldwork | closed). Freezing keeps the status and records the frozen statement. */
export const auditPeriod = defineStatuses('audit period', {
  open: { tone: 'progress', label: 'Open' },
  fieldwork: { tone: 'pending', label: 'In fieldwork' },
  closed: { tone: 'neutral', label: 'Closed' },
});

/** A reviewer's standing decision on a crosswalk mapping (SCFMappingReview.verdict). */
export const mappingVerdict = defineStatuses('mapping decision', {
  confirmed: { tone: 'success', label: 'Confirmed' },
  suppressed: { tone: 'neutral', label: 'Suppressed' },
  retargeted: { tone: 'progress', label: 'Moved to another control' },
});

/** A connector in the catalogue: connected (credentials saved) or not. How well it collects is `collectionHealth`. */
export const connection = defineStatuses('connection', {
  connected: { tone: 'success', label: 'Connected' },
  not_connected: { tone: 'neutral', label: 'Not connected' },
});

/** What accounts for a framework requirement (GET /automation/common/coverage `disposition`): a control discharges it, another party carries it (the regulator, the exchange operator), it falls outside what an
 *  organisation implements, or it is still to be assessed (the only real to-do). The labels are the server's own (DISPOSITION_LABELS), so a page may show either. */
export const requirementDisposition = defineStatuses('requirement', {
  mapped: { tone: 'success', label: 'Mapped to a control' },
  other_party: { tone: 'progress', label: 'Obligation of another party' },
  out_of_scope: { tone: 'neutral', label: 'Outside the control catalogue' },
  pending: { tone: 'warning', label: 'Not yet assessed' },
});

/** How sure the crosswalk is of a mapping (0 to 1): 0.85 and over green, 0.6 and over amber, else red (the Mapping review page's own bands). */
export function confidenceTone(score: number | null | undefined): Tone {
  if (score == null || Number.isNaN(score)) return 'neutral';
  if (score >= 0.85) return 'success';
  if (score >= 0.6) return 'warning';
  return 'danger';
}

/** Every registry in one place, for the style guide and the tests. */
export const CONTROL_REGISTRIES = {
  controlStatus, testResult, designation, evidenceNeed, evidenceFile, workProgress, testRun, stepResult, checkResult,
  collectionHealth, ownership, controlLifecycle, applicabilityRequest, auditPeriod, mappingVerdict, connection, requirementDisposition,
} as const;
