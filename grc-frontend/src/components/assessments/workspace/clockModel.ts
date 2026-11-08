// The Remediation clock of one assessment: how many gaps are open, overdue, due soon and closed, and how the open ones age. The headline numbers are the server's
// (`/overview?assessment_id=` -> `sla_counts`, the ones the board and the Performance Overview show); the due-soon count and the ageing are worked out from the controls
// with the server's own due-date rule (itemModel.dueMs), so for the checklist, ASVS, DCC and Mobile formats the two agree. Pure (`node --test clockModel.test.ts`).
import { DEFAULT_SLA_DAYS, dueMs, isGap, isOpenGap, type SlaDays, type WorkItem } from './itemModel.ts';
import type { Metric, SlaCounts } from './types.ts';

const DAY = 86_400_000;

export type AgeKey = 'overdue' | 'd30' | 'd60' | 'd90' | 'later' | 'none';
export interface AgeBucket { key: AgeKey; label: string; count: number; tone: 'danger' | 'warning' | 'progress' | 'success' | 'neutral' }

export interface Clock {
  /** the server's counts; null when the board does not count this assessment (a draft, an unanswered questionnaire) */
  gaps: number | null;
  open: number | null;
  overdue: number | null;
  closed: number | null;
  /** open gaps due within the policy's due-soon days (not yet overdue) */
  dueSoon: number;
  dueSoonDays: number;
  /** "closed on time": gaps closed on or before their date, of those closed, as the server scores it */
  closedOnTime: { done: number; of: number } | null;
  /** the same counts worked out from the controls (the checklist rule): shown when the board does not count this assessment, so a plain upload still has its numbers */
  local: { gaps: number; open: number; overdue: number; closed: number };
  /** the open gaps by how far off their date is */
  aging: AgeBucket[];
  agingTotal: number;
}

/** The days a gap lies from `now`, rounded down as the server does (`(target - now).days`); negative = overdue. */
const daysTo = (due: number, now: number): number => Math.floor((due - now) / DAY);

export function remediationClock(items: readonly WorkItem[], days: SlaDays = DEFAULT_SLA_DAYS, now: number = Date.now(), server: SlaCounts | null = null, metrics: readonly Metric[] = []): Clock {
  const age: Record<AgeKey, number> = { overdue: 0, d30: 0, d60: 0, d90: 0, later: 0, none: 0 };
  let dueSoon = 0;
  let gaps = 0;
  let closed = 0;
  for (const it of items) {
    if (isGap(it)) { gaps += 1; if (it.closedAt) closed += 1; }
    if (!isOpenGap(it)) continue;
    const due = dueMs(it, days);
    if (due === null) { age.none += 1; continue; }
    const d = daysTo(due, now);
    if (due < now) age.overdue += 1;
    else {
      if (d <= days.due_soon_days) dueSoon += 1;
      if (d <= 30) age.d30 += 1; else if (d <= 60) age.d60 += 1; else if (d <= 90) age.d90 += 1; else age.later += 1;
    }
  }
  const aging: AgeBucket[] = [
    { key: 'overdue', label: 'Overdue', count: age.overdue, tone: 'danger' },
    { key: 'd30', label: 'Within 30 days', count: age.d30, tone: 'warning' },
    { key: 'd60', label: '31 to 60 days', count: age.d60, tone: 'progress' },
    { key: 'd90', label: '61 to 90 days', count: age.d90, tone: 'progress' },
    { key: 'later', label: 'Later', count: age.later, tone: 'success' },
    { key: 'none', label: 'No date', count: age.none, tone: 'neutral' },
  ];
  const onTime = metrics.find((m) => m.key === 'on_time');
  return {
    gaps: server && typeof server.gaps === 'number' ? server.gaps : null,
    open: server && typeof server.open === 'number' ? server.open : null,
    overdue: server && typeof server.overdue === 'number' ? server.overdue : null,
    closed: server && typeof server.closed === 'number' ? server.closed : null,
    dueSoon, dueSoonDays: days.due_soon_days,
    closedOnTime: onTime && onTime.denominator > 0 ? { done: onTime.numerator, of: onTime.denominator } : null,
    local: { gaps, open: gaps - closed, overdue: age.overdue, closed },
    aging, agingTotal: aging.reduce((n, b) => n + b.count, 0),
  };
}

/** The share of the bar one bucket takes, whole percent, at least 2 when it has any (so a single gap is still a visible mark); 0 when nothing is open. */
export function barShares(aging: readonly AgeBucket[]): number[] {
  const total = aging.reduce((n, b) => n + b.count, 0);
  return aging.map((b) => (total === 0 || b.count === 0 ? 0 : Math.max(2, Math.round((b.count / total) * 100))));
}
