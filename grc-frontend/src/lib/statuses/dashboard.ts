// The words of the Performance Overview (the main dashboard): what a score's grade and a Cyber Security KPI against its target are called, and the tone each carries. Pure
// (no React), so `node --test` runs statuses/dashboard.test.ts against it.
// ONE vocabulary for a 0-100 score: the server's own grade (excellent from 85, good from 70, fair from 50, else poor), the words the Governance, Compliance, Assessments and
// Assurance Overviews already print. The older strong / fair / weak words of components/dashboard/score-kit.tsx stay inside the module pages that still draw that ring; this page
// never prints them, and its Risk posture words (low / moderate / elevated) are gone: Risk is a row with its grade. The thresholds are lib/perf/moduleFeeds.ts GRADE_LINES.
// A word nobody registered reads as neutral with its own readable label (defineStatuses).
import { defineStatuses } from '../status.ts';

/** `performance.grade` of a scorecard (or `gradeOf(score)` of lib/perf/moduleFeeds.ts where a payload sends none). */
export const gradeStatus = defineStatuses('score grade', {
  excellent: { tone: 'success', label: 'Excellent' },
  good: { tone: 'success', label: 'Good' },
  fair: { tone: 'warning', label: 'Fair' },
  poor: { tone: 'danger', label: 'Poor' },
});

/** A live Cyber Security KPI against its target (kpiShared `Kpi.onTarget`: true, false, or null when nothing is measured yet). */
export const kpiTarget = defineStatuses('KPI against target', {
  on_target: { tone: 'success', label: 'On target' },
  below_target: { tone: 'danger', label: 'Below target' },
  not_measured: { tone: 'neutral', label: 'Not measured' },
});
