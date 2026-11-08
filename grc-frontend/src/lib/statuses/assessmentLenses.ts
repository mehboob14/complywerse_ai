// The words of the assessment lenses that no other registry holds (lib/statuses/assessments.ts has the answer, the fix status, the lifecycle and the grade): the audit plan's status,
// the risk band of the DPIA and the NCA registers, and where a KPI stands. Built with defineStatuses (lib/status.ts) so a pill always has its word and a word nobody registered is
// neutral with its own readable label. Pure: `node --test src/lib/statuses/assessmentLenses.test.ts`.
import { defineStatuses } from '../status.ts';

// The NCA audit plan's entry: planned, in_progress, completed, cancelled (the older tab drew the raw word).
export const planStatus = defineStatuses('audit plan entry', {
  planned: { tone: 'neutral', label: 'Planned' },
  in_progress: { tone: 'progress', label: 'In progress' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
});

// A risk band: the colour is never the only sign, the word is always drawn. Critical and high ask for a look.
export const riskBand = defineStatuses('risk band', {
  critical: { tone: 'danger', label: 'Critical' },
  high: { tone: 'warning', label: 'High' },
  medium: { tone: 'progress', label: 'Medium' },
  low: { tone: 'success', label: 'Low' },
  none: { tone: 'neutral', label: 'Not rated' },
});

// Where a KPI of the report stands: below its target, on it, or measured outside the platform (no number is shown).
export const kpiStanding = defineStatuses('kpi standing', {
  below: { tone: 'danger', label: 'Below target' },
  on: { tone: 'success', label: 'On target' },
  external: { tone: 'neutral', label: 'External' },
});
