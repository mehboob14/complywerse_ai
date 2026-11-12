'use client';

// Score against target: one bar per scored area on one 0 to 100 baseline, the weakest first (Bars.tsx draws them). The bar is the area's score in the colour of its grade (the grade's word is
// printed in the pill beside the figure, so the colour is never the only signal), and a dark tick on the same baseline is the target the server scored it against (it differs per area when an
// organisation tuned it). The name is a link to the area; the ONE count of the area that needs attention (its most serious) is the line under the name, in its status colour with its words,
// and opens the records it counts: that is where the page says what to act on, instead of a list of counts. An area with no score yet is a neutral "Not scored" bar, never a 0. The distance
// to the target is in the link's name and the bar's tooltip, not on the screen. Rules: perfCharts.ts (tested).
import Link from 'next/link';
import { RotateCw } from 'lucide-react';
import { Button, StatusPill } from '@/components/ui/ds';
import { ChartCard } from '@/components/overview/charts';
import { STATUS, type StatusColor } from '@/components/overview/charts/palette';
import { GRADE_LINES } from '@/lib/perf/moduleFeeds';
import { statusPill } from '@/lib/status';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { NamedBars, type NamedBar } from './Bars';
import { barName, nameList, scoreEmptyText, scoreView, type ScoreBar } from './perfCharts';
import { retryable, type AreaRow } from './perfModel';

/** The text colour of a count, by its status (always with the count's own words beside it). */
export const COUNT_TEXT: Record<StatusColor, string> = { bad: 'text-ds-danger', warn: 'text-ds-warning', good: 'text-ds-success', progress: 'text-ds-fg-body', pending: 'text-ds-fg-body', neutral: 'text-ds-fg-muted' };

const toRow = (b: ScoreBar): NamedBar => ({
  key: b.key,
  label: b.label,
  linkName: barName(b),
  href: b.href,
  value: b.score ?? 0,
  color: STATUS[b.status],
  tick: b.target,
  tip: b.target !== null ? `Target ${Math.round(b.target)}` : undefined,
  note: b.attention ? (
    <Link href={b.attention.href} aria-label={`Open ${b.label}: ${b.attention.text}`} title={`Open the records: ${b.attention.text}`} className={`rounded-ds-control font-[500] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring ${COUNT_TEXT[b.attention.status]}`}>{b.attention.text}</Link>
  ) : undefined,
  figure: b.score === null || !b.grade ? (
    <StatusPill tone="neutral" label="Not scored" size="sm" />
  ) : (
    <>
      <span className="min-w-[24px] text-right text-ds-body font-[600] tabular-nums text-ds-fg">{Math.round(b.score)}</span>
      <StatusPill {...statusPill(gradeStatus, b.grade)} size="sm" />
    </>
  ),
});

/** The card: every scored area against its target. Each state is its own (waiting, failed with Retry where asking again can help, nothing scored, no scored area open to the person); an
 *  area that answered with no score yet is a bar of its own, and an area that did not answer is named, so the picture says what it leaves out. */
export function ScoreCard({ rows, onRetry }: { rows: readonly AreaRow[]; onRetry: () => void }) {
  const view = scoreView(rows);
  const shown = rows.some((r) => r.area.kind === 'score' && r.state !== 'denied');
  const failed = rows.filter((r) => r.area.kind === 'score' && r.state === 'error');
  const retry = failed.some(retryable) ? onRetry : undefined;
  return (
    <ChartCard
      id="scores"
      title="Score against target"
      info={`Each scored area's score on one 0 to 100 scale, the weakest first, in the colour of its grade (Excellent from ${GRADE_LINES.excellent}, Good from ${GRADE_LINES.good}, Fair from ${GRADE_LINES.fair}, else Poor). The dark tick is the target the area is scored against. Each name opens the area; the count under a name is the area's most serious count and opens the records it counts.`}
      state={view.state}
      loadingHeight={300}
      error={{ title: "Couldn't load the scored areas", message: `${nameList(view.leftOut)} could not be read.`, onRetry: retry }}
      emptyText={scoreEmptyText(view, shown)}
    >
      <NamedBars rows={view.bars.map(toRow)} label="Score against target, by area" nameWidth={200} figureWidth={112} />
      {view.leftOut.length > 0 && (
        <div className="mt-[8px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          {`Leaves out ${nameList(view.leftOut)}: ${view.leftOut.length === 1 ? 'it' : 'they'} did not answer.`}
          {retry && <Button variant="link" size="sm" leftIcon={<RotateCw aria-hidden />} onClick={retry}>Retry</Button>}
        </div>
      )}
    </ChartCard>
  );
}
