// The words of Issue & Incident Management's issues and corrective actions, one registry per kind of word, on the same tone model as lib/status.ts (own file so builders of
// other groups never touch the same lines; the Incidents' words stay in monitoring.ts). Every word the server writes is registered (issues.test.ts re-reads the comments of
// models/_12_governance.py), every word is said in full, and a word nobody registered reads neutral with a readable label.
// Tones: pending = waiting for someone, progress = moving, success = done or healthy, warning = needs a look, danger = late or off target, neutral = at rest (a kind has no meaning to colour).
import { defineStatuses } from '../status.ts';

/** Issue.workflow_state (the state machine of routers/issues.py). Closure review is the one that waits on a person with the right to approve, so it reads amber. */
export const issueState = defineStatuses('issue state', {
  new: 'neutral',
  triage: 'pending',
  in_progress: { tone: 'progress', label: 'In progress' },
  resolution: 'progress',
  closure_review: { tone: 'warning', label: 'Closure review' },
  closed: 'success',
  cancelled: 'neutral',
});

/** Issue.severity: the four words of the Incidents register (monitoring.ts `severity`, same tones and labels, pinned in issues.test.ts) plus the fifth an issue can carry. */
export const issueSeverity = defineStatuses('issue severity', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
  informational: 'neutral',
});

/** IssueAction.status. Completed is done and waits to be verified; verified is the end. Both are green: the word says which. */
export const actionStatus = defineStatuses('corrective action', {
  planned: 'pending',
  in_progress: { tone: 'progress', label: 'In progress' },
  blocked: 'warning',
  completed: 'success',
  verified: 'success',
  cancelled: 'neutral',
});

/** What a date says about an open item (issue target date, action due date): only the late state is a state; "on time" is the absence of it. */
export const lateness = defineStatuses('lateness', {
  overdue: 'danger',
});

/** IssueAction.action_type. */
export const actionType = defineStatuses('action type', {
  corrective: 'neutral',
  preventive: 'neutral',
  containment: 'neutral',
  verification: 'neutral',
});

/** Issue.issue_type (models/_12_governance.py: incident, audit_finding, non_conformance, vendor_breach, process_gap, capa, other). */
export const issueType = defineStatuses('issue type', {
  incident: 'neutral',
  audit_finding: { tone: 'neutral', label: 'Audit finding' },
  non_conformance: { tone: 'neutral', label: 'Non-conformance' },
  vendor_breach: { tone: 'neutral', label: 'Vendor breach' },
  process_gap: { tone: 'neutral', label: 'Process gap' },
  capa: { tone: 'neutral', label: 'Corrective action' },
  other: 'neutral',
});

/** Issue.category (security, privacy, operations, contract, data, regulatory, safety). */
export const issueCategory = defineStatuses('issue category', {
  security: 'neutral',
  privacy: 'neutral',
  operations: 'neutral',
  contract: 'neutral',
  data: 'neutral',
  regulatory: 'neutral',
  safety: 'neutral',
});

/** Where an issue came from (Issue.source_type): the words the model's comment lists, and the ones the platform's own creators write (vulnerabilities, risks, assets, control tests, BCM
 *  and vendor-assessment findings, KRI breaches, workflow actions, the audit register's imports...). A source has no tone: it is a place, not a state. */
export const issueSource = defineStatuses('issue source', {
  manual: { tone: 'neutral', label: 'Raised by hand' },
  vulnerability: 'neutral',
  risk: 'neutral',
  risk_incident: { tone: 'neutral', label: 'Risk incident' },
  asset: 'neutral',
  control_test: { tone: 'neutral', label: 'Control test' },
  control_test_failed: { tone: 'neutral', label: 'Failed control test' },
  control_framework: { tone: 'neutral', label: 'Framework control' },
  control_parsed: { tone: 'neutral', label: 'Framework control' },
  control_normalized: { tone: 'neutral', label: 'Framework control' },
  control_internal: { tone: 'neutral', label: 'Internal control' },
  audit: 'neutral',
  vendor_review: { tone: 'neutral', label: 'Vendor review' },
  incident_report: { tone: 'neutral', label: 'Vendor incident' },
  tpra_finding: { tone: 'neutral', label: 'Vendor assessment finding' },
  bcm_finding: { tone: 'neutral', label: 'Continuity finding' },
  bcm: { tone: 'neutral', label: 'Business continuity' },
  governance_document: { tone: 'neutral', label: 'Document' },
  policy_statement: { tone: 'neutral', label: 'Policy statement' },
  is_project: { tone: 'neutral', label: 'IS project' },
  kri_breach: { tone: 'neutral', label: 'KRI breach' },
  mitigation_overdue: { tone: 'neutral', label: 'Overdue mitigation' },
  compliance_plugin_run: { tone: 'neutral', label: 'Automated check' },
  workflow: 'neutral',
  import: { tone: 'neutral', label: 'Imported' },
  demo: { tone: 'neutral', label: 'Sample data' },
});
