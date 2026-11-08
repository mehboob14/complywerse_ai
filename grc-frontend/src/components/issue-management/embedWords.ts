// The words an issue is said in on a record's page ("Issues on a record" and "Create issue"): its workflow state, its type and its category, on the same tone model as lib/status.ts.
// Every word the server writes is registered (embedWords.test.ts re-reads the comments of models/_12_governance.py); a word nobody registered reads neutral with a readable label.
// Severity is not here: it is the platform's priority scale in lib/statuses/monitoring.ts (`severity`), so "High" is one pill everywhere.
// Temporary home: the Issues register builder owns lib/statuses/issues.ts; these three registries move there when it lands (one import changes).
import { defineStatuses } from '../../lib/status.ts';

/** Issue.workflow_state: models/_12_governance.py (the comment on the column) and ALLOWED_TRANSITIONS in routers/issues.py. Closure review is waiting for a person. */
export const issueState = defineStatuses('issue state', {
  new: 'neutral',
  triage: 'neutral',
  in_progress: 'progress',
  resolution: 'progress',
  closure_review: { tone: 'pending', label: 'Closure review' },
  closed: 'success',
  cancelled: 'neutral',
});

/** Issue.issue_type. A kind has no meaning to colour. */
export const issueType = defineStatuses('issue type', {
  incident: 'neutral',
  audit_finding: { tone: 'neutral', label: 'Audit finding' },
  non_conformance: { tone: 'neutral', label: 'Non-conformance' },
  vendor_breach: { tone: 'neutral', label: 'Vendor breach' },
  process_gap: { tone: 'neutral', label: 'Process gap' },
  capa: { tone: 'neutral', label: 'CAPA' },
  other: 'neutral',
});

/** Issue.category. A kind has no meaning to colour. */
export const issueCategory = defineStatuses('issue category', {
  security: 'neutral',
  privacy: 'neutral',
  operations: 'neutral',
  contract: 'neutral',
  data: 'neutral',
  regulatory: 'neutral',
  safety: 'neutral',
});

/** The impact and urgency words of the severity matrix (high, medium, low). */
export const LEVELS = ['high', 'medium', 'low'] as const;
/** Every severity an issue can carry, from the worst down (the override list). */
export const SEVERITY_WORDS = ['critical', 'high', 'medium', 'low', 'informational'] as const;
