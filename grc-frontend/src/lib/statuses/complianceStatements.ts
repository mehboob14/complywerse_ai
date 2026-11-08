// The words of the Compliance statements register and the Compliance Overview's score bands, one registry per kind of word, built with defineStatuses
// (lib/status.ts) so a pill always has its word and a word nobody registered is neutral with a readable label. Pure: `node --test` runs the test beside it.
import { defineStatuses } from '../status.ts';

// PolicyStatementCompliance.compliance_status (compliance/routers/statements.py valid_statuses): the five words the server accepts.
export const statementCompliance = defineStatuses('policy statement compliance', {
  compliant: 'success',
  partially_compliant: { tone: 'warning', label: 'Partially compliant' },
  non_compliant: { tone: 'danger', label: 'Non-compliant' },
  not_assessed: { tone: 'neutral', label: 'Not assessed' },
  not_applicable: { tone: 'neutral', label: 'Not applicable' },
});

// PolicyStatement.priority (critical, high, medium, low; the page showed a missing one as "medium").
export const statementPriority = defineStatuses('policy statement priority', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
});

// How strong an area of the Compliance score is (the server's section score: 80 and over strong, 60 and over fair, below weak; no score = no data).
export const areaBand = defineStatuses('compliance area', {
  strong: 'success',
  fair: 'warning',
  weak: 'danger',
  no_data: { tone: 'neutral', label: 'No data' },
});
