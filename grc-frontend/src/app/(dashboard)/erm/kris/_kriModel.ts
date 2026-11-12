/** The RAG legend under a KRI, read the way the backend rates a value (calculate_kri_status): lower-is-better is
 *  green <= G, amber <= A, red > A; higher-is-better is green >= G, amber >= A, red < A. None until both are set. */
export function thresholdLegend(
  direction: string | null | undefined,
  green: number | null | undefined,
  amber: number | null | undefined,
): [string, string, string] | null {
  if (green == null || amber == null) return null;
  return direction === 'higher_is_better'
    ? [`≥${green}`, `≥${amber}`, `<${amber}`]
    : [`≤${green}`, `≤${amber}`, `>${amber}`];
}

/** The move between the last two measurements (oldest first), and whether it went the good way. None without a move. */
export function trendOf(values: readonly number[], direction: string | null | undefined): { delta: number; better: boolean } | null {
  if (values.length < 2) return null;
  const delta = values[values.length - 1] - values[values.length - 2];
  if (delta === 0) return null;
  return { delta, better: direction === 'higher_is_better' ? delta > 0 : delta < 0 };
}

/** Indicators tab order: red first, then amber, then the rest; drafts waiting for approval last. Stable within a band. */
export function sortIndicators<T extends { current_status?: string | null; status?: string | null }>(kris: readonly T[]): T[] {
  const rank = (k: T) => (k.status === 'draft' ? 3 : k.current_status === 'red' ? 0 : k.current_status === 'amber' ? 1 : 2);
  return kris.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map(({ k }) => k);
}

/** The threshold inputs' labels, worded by direction: lower-is-better thresholds are ceilings, higher-is-better floors. */
export function thresholdLabels(direction: string | null | undefined): [string, string] {
  return direction === 'higher_is_better' ? ['Green from', 'Amber from'] : ['Green up to', 'Amber up to'];
}

/** The change a submitted value makes against the last published one. None when nothing was published yet. */
export function changeFromLast(value: number, previous: number | null | undefined): number | null {
  return previous == null ? null : Math.round((value - previous) * 100) / 100;
}

/** "Overdue 3 days", "Due today", "Due in 2 days" — whole days between the due date and now. */
export function dueText(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
  if (days > 0) return `Overdue ${days} day${days === 1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  return `Due in ${-days} day${days === -1 ? '' : 's'}`;
}

/** A proposed change to an active KRI's thresholds and its decision (RiskKRI.threshold_change on the server). */
export interface ThresholdChange {
  status: 'pending' | 'approved' | 'rejected';
  changes: { green_threshold?: number | null; amber_threshold?: number | null; threshold_direction?: string | null };
  proposed_by: number | null;
  proposed_at: string | null;
  decided_by?: number | null;
  decided_at?: string | null;
  note?: string | null;
}

const DIRECTION_TEXT: Record<string, string> = { lower_is_better: 'lower is better', higher_is_better: 'higher is better' };
const shown = (v: number | string | null | undefined) => (v == null || v === '' ? '—' : String(v));

/** "Green threshold: 1 → 2" for each field the change moves, against the values in force now. */
export function thresholdChangeLines(
  inForce: { green_threshold?: number | null; amber_threshold?: number | null; threshold_direction?: string | null },
  change: Pick<ThresholdChange, 'changes'>,
): string[] {
  const lines: string[] = [];
  const c = change.changes;
  if ('green_threshold' in c) lines.push(`Green threshold: ${shown(inForce.green_threshold)} → ${shown(c.green_threshold)}`);
  if ('amber_threshold' in c) lines.push(`Amber threshold: ${shown(inForce.amber_threshold)} → ${shown(c.amber_threshold)}`);
  if ('threshold_direction' in c) {
    const text = (d?: string | null) => (d ? DIRECTION_TEXT[d] || d : '—');
    lines.push(`Direction: ${text(inForce.threshold_direction)} → ${text(c.threshold_direction)}`);
  }
  return lines;
}
