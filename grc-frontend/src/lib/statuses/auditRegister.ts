// The words of the Issue Register (the client's audit register): a finding's status in the client's own six codes (NS, IP, DE, PD, EXT, CD) said in full, the risk rating the
// workbook carries, where a finding came from, how an extension request stands and what a validation decision is. One registry per kind of word, built with defineStatuses
// (lib/status.ts): a pill always has its word and a word nobody registered is neutral with a readable label. Pure, so `node --test src/lib/statuses/auditRegister.test.ts` runs it.
//
// Exports (other code of the register imports them; the Issues pages do not):
//   findingStatus     summary.effective_status    NS | IP | DE | PD | EXT | CD | unstated
//   riskRating        AuditIssueProfile.risk_rating (free text in the workbook: High, Moderate, Low ...)
//   findingSource     AuditIssueProfile.source    where the finding came from (a place, not a state)
//   extensionStatus   AuditExtensionRequest.status requested | approved | rejected | withdrawn
//   validationStage   validation_state.stage      open | awaiting_validation | closed
//   validationResult  the three things Audit Services can decide: pass | more_info | fail
// The client's codes stay visible beside the words where a person needs to match the workbook (STATUS_CODE), never instead of them.
import { defineStatuses } from '../status.ts';

// summary.effective_status (backend/grc/modules/issue_management/audit_register/summary.py): closed -> CD; DE / PD as recorded; open past the agreed date -> PD;
// validated or in closure review on a sheet that is not the archive -> IP; else the recorded code, else "unstated". Past due is red, delayed amber, an extension violet-ish "pending"
// (it waits for the Audit Committee), closed green.
export const findingStatus = defineStatuses('register finding status', {
  NS: { tone: 'neutral', label: 'Not started' },
  IP: { tone: 'progress', label: 'In progress' },
  DE: { tone: 'warning', label: 'Delayed' },
  PD: { tone: 'danger', label: 'Past due' },
  EXT: { tone: 'pending', label: 'Extension' },
  CD: { tone: 'success', label: 'Closed' },
  unstated: { tone: 'neutral', label: 'No status' },
});

/** The client's code for each status word, for the places that must match their workbook ("Past due (PD)"). */
export const STATUS_CODE: Record<string, string> = { NS: 'NS', IP: 'IP', DE: 'DE', PD: 'PD', EXT: 'EXT', CD: 'CD' };

/** The order the statuses are listed and the board's columns run in. */
export const STATUS_ORDER = ['NS', 'IP', 'DE', 'PD', 'EXT', 'CD', 'unstated'] as const;

// The rating column of the workbook: the client writes High / Moderate / Low (the pen-test sheet also Critical / Medium). Written in their words, toned like the platform's severities.
export const riskRating = defineStatuses('register risk rating', {
  critical: 'danger',
  high: 'danger',
  moderate: 'warning',
  medium: 'warning',
  low: 'neutral',
});

// AuditIssueProfile.source (audit_register/template.py SOURCES): the six sheets of the client's pack. A source is a place; it has no tone.
export const findingSource = defineStatuses('register finding source', {
  regulator: { tone: 'neutral', label: 'Regulator' },
  mercadien: { tone: 'neutral', label: 'CFSB Audit-Mercadien' },
  ey: { tone: 'neutral', label: 'CFSB Audit-EY' },
  internal_audit: { tone: 'neutral', label: 'Internal Audit' },
  self_id: { tone: 'neutral', label: 'Self identified' },
  it_pen: { tone: 'neutral', label: 'IT pen test' },
  credit_review: { tone: 'neutral', label: 'Credit reviews' },
  unassigned: { tone: 'neutral', label: 'Source not stated' },
});

// AuditExtensionRequest.status: requested -> approved | rejected | withdrawn. The Audit Committee decides; a request that waits reads as "Waiting for the committee".
export const extensionStatus = defineStatuses('register extension request', {
  requested: { tone: 'pending', label: 'Waiting for the committee' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Not approved' },
  withdrawn: { tone: 'neutral', label: 'Withdrawn' },
});

// validation_state.stage (workflow.py): open, awaiting_validation (workflow state closure_review), closed.
export const validationStage = defineStatuses('register validation stage', {
  open: { tone: 'neutral', label: 'Not submitted' },
  awaiting_validation: { tone: 'pending', label: 'Awaiting Audit Services' },
  closed: { tone: 'success', label: 'Validated' },
});

// What Audit Services decide when they validate (workflow.DECISIONS). The client's code for the two that are not a pass is in brackets.
export const validationResult = defineStatuses('register validation result', {
  pass: { tone: 'success', label: 'Passed' },
  more_info: { tone: 'warning', label: 'More materials asked' },
  fail: { tone: 'danger', label: 'Did not pass' },
});

/** What Audit Services' "Not passed" can mean (workflow._decision_changes: DE for more materials, PD and "Fail" for a failure on the sheets that use the status codes). */
export const NOT_PASSED = [
  { value: 'more_info', label: 'Needs more materials', hint: 'The finding is marked Delayed and the owner is told what to send.' },
  { value: 'fail', label: 'Did not pass', hint: 'It is recorded as not passed and the finding stays open.' },
] as const;
