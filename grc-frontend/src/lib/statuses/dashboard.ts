// The words of the Performance Overview (the main dashboard): what a module's score band, the risk posture, a Cyber Security KPI against its target and a
// control's implementation status are called, and the tone each carries. Pure (no React), so `node --test` runs statuses/dashboard.test.ts against it.
// Every word here is one the dashboard's own code or the server writes (each registry says where); a word nobody registered reads as neutral with its own
// readable label (defineStatuses). The thresholds are not here: the score bands (80 / 60) live in components/dashboard/score-kit.tsx (shared with the module
// pages), the posture thresholds (70 / 50) in the dashboard's overviewModel.ts; this file only names what they produce.
import { defineStatuses } from '../status.ts';

/** `scoreBand(score).label` of components/dashboard/score-kit.tsx: "strong" from 80, "fair" from 60, else "weak"; "no data" when there is no score. */
export const bandStatus = defineStatuses('score band', {
  strong: { tone: 'success', label: 'Strong' },
  fair: { tone: 'warning', label: 'Fair' },
  weak: { tone: 'danger', label: 'Weak' },
  'no data': { tone: 'neutral', label: 'No data' },
});

/** The Risk Posture tile (overviewModel.posture): from the ERM risk score, 70 and above is low, 50 and above moderate, else elevated. */
export const riskPosture = defineStatuses('risk posture', {
  low: 'success',
  moderate: 'warning',
  elevated: 'danger',
});

/** A live Cyber Security KPI against its target (kpiShared `Kpi.onTarget`: true, false, or null when nothing is measured yet). */
export const kpiTarget = defineStatuses('KPI against target', {
  on_target: { tone: 'success', label: 'On target' },
  below_target: { tone: 'danger', label: 'Below target' },
  not_measured: { tone: 'neutral', label: 'Not measured' },
});

/** `status_mix[].key` of GET /compliance/policies/dashboard/frameworks-aggregate (the Frameworks card's donut): backend/grc/modules/compliance/routers/dashboard.py. */
export const controlImplementation = defineStatuses('control implementation', {
  verified: 'success',
  implemented: 'progress',
  in_progress: { tone: 'warning', label: 'In progress' },
  not_started: 'neutral',
  not_applicable: 'neutral',
});
