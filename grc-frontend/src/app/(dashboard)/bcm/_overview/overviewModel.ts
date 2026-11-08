// What the Business Continuity Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts): the five counters of "Needs attention" and the list each one opens, the
// rows of "Do now" (the signed-in person's own work, most urgent first, one action each), and the words under them. Every figure is the SERVER's (GET /bcm/dashboard: `totals`, `attention`,
// `mine`); this only arranges and words them. A counter opens the register it counts: the number on the chip is the number of rows the list shows.
import { dayGap, dueWords, plural, type Dashboard, type Mine } from '../bcmModel.ts';
import { drillType, severity } from '../../../../lib/statuses/bcm.ts';
import type { Tone } from '../../../../lib/status.ts';

export interface Counter { key: string; label: string; href: string; tone: Tone; value: number | null }

/** The counters of the band, in the order of urgency. `value` is null when the server did not send it (an older server): the band then shows a dash, never 0. */
export function countersOf(d: Dashboard): Counter[] {
  const a = d.attention;
  return [
    { key: 'overdue-drills', label: 'Overdue drills', href: '/bcm/drills?quick=overdue', tone: 'danger', value: d.totals.overdue_drills },
    { key: 'reviews-due', label: 'Reviews due', href: '/bcm/plans?quick=review', tone: 'warning', value: a ? a.reviews_due : null },
    { key: 'draft-plans', label: 'Draft plans', href: '/bcm/plans?quick=draft', tone: 'pending', value: d.plans_by_status.draft ?? 0 },
    { key: 'no-strategy', label: 'Plans with no recovery strategy', href: '/bcm/plans?quick=nostrategy', tone: 'warning', value: a ? a.plans_without_strategy ?? null : null },
    { key: 'no-issue', label: 'Findings with no issue', href: '/bcm/findings?quick=noissue', tone: 'warning', value: a ? a.findings_without_issue : null },
  ];
}

/** The sum of the counters that were sent (the band's "N in total"); null when none was. */
export function attentionTotal(counters: readonly Counter[]): number | null {
  const sent = counters.filter((c) => c.value !== null);
  return sent.length === 0 ? null : sent.reduce((n, c) => n + (c.value as number), 0);
}

export interface WorkItem {
  key: string;
  kind: { label: string; tone: Tone };
  title: string;
  context: string | null;
  /** a day (written as a DateTime) or none */
  due: string | null;
  href: string;
  action: string;
  /** days from today to its day (negative: late); undated work goes last */
  rank: number;
}

const UNDATED = 100000;

/** The person's own work as rows, the most urgent first: what is late (the oldest first), what is due soon, then work with no day. */
export function workItems(mine: Mine | undefined, now: number): WorkItem[] {
  if (!mine) return [];
  const rank = (day: string | null | undefined): number => dayGap(day, now) ?? UNDATED;
  const out: WorkItem[] = [];
  (mine.overdue_drills ?? []).forEach((d) => out.push({
    key: `drill:${d.id}`, kind: { label: 'Drill overdue', tone: 'danger' }, title: d.title, context: [d.plan_title, drillType.label(d.drill_type)].filter(Boolean).join(' · '),
    due: d.scheduled_date, href: `/bcm/drills/${d.id}`, action: 'Open', rank: rank(d.scheduled_date),
  }));
  (mine.reviews_due ?? []).forEach((p) => out.push({
    key: `review:${p.id}`, kind: { label: 'Review due', tone: 'warning' }, title: p.title, context: 'Plan review', due: p.next_review_due, href: `/bcm/plans/${p.id}`, action: 'Open', rank: rank(p.next_review_due),
  }));
  (mine.findings_without_issue ?? []).forEach((f) => out.push({
    key: `finding:${f.id}`, kind: { label: 'No issue yet', tone: 'warning' }, title: f.title, context: [severity.label(f.severity), f.drill_title].filter(Boolean).join(' · '), due: f.due_date,
    href: `/bcm/drills/${f.drill_id}?tab=findings`, action: 'Open', rank: rank(f.due_date),
  }));
  (mine.bia_without_strategy ?? []).forEach((b) => out.push({
    key: `bia:${b.id}`, kind: { label: 'No strategy', tone: 'pending' }, title: b.process_name, context: [b.plan_title, `${severity.label(b.criticality_rating)} criticality`].filter(Boolean).join(' · '), due: null,
    href: `/bcm/plans/${b.plan_id}?tab=bia&process=${b.id}`, action: 'Add strategy', rank: UNDATED - (severity.words.length - Math.max(0, severity.words.indexOf(b.criticality_rating))),
  }));
  return out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

/** The true number of items the person has (the lists are cut at ten per kind; the counts beside them are not). null when the server sent no `mine` block. */
export function mineTotal(mine: Mine | undefined): number | null {
  if (!mine) return null;
  return Object.values(mine.counts).reduce<number>((n, c) => n + (c ?? 0), 0);
}

/** "Showing 10 of 14" when the lists were cut, else "14 items". */
export function mineLine(shown: number, total: number): string {
  return total > shown ? `Showing ${shown} of ${total}` : plural(total, 'item');
}

/** The words under a row's due: a finding or a drill with a day says how late or how soon. Work with no day says nothing. */
export const rowDue = (item: WorkItem, now: number): string => (item.due ? dueWords(item.due, now) : '');
