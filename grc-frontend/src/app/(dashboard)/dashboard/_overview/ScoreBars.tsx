'use client';

// Score against target: one bar per scored area on one 0 to 100 baseline, the weakest first (Bars.tsx draws them). The bar is the area's score in the colour of its grade (the grade's word is
// printed in the pill beside the figure, so the colour is never the only signal), and a dark tick on the same baseline is the target the server scored it against (it differs per area when an
// organisation tuned it). The distance to the target is in words under the name. The name is a link to the area, so every part opens what it summarises.
import Link from 'next/link';
import { RotateCw } from 'lucide-react';
import { Button, StatusPill } from '@/components/ui/ds';
import { ChartCard } from '@/components/overview/charts';
import { STATUS } from '@/components/overview/charts/palette';
import { GRADE_LINES } from '@/lib/perf/moduleFeeds';
import { statusPill } from '@/lib/status';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { NamedBars, type NamedBar } from './Bars';
import { nameList, scoreEmptyText, scoreView, type ScoreBar } from './perfCharts';
import { retryable, type AreaRow } from './perfModel';

const toRow = (b: ScoreBar): NamedBar => ({
  key: b.key,
  label: b.label,
  note: b.gap,
  href: b.href,
  value: b.score,
  color: STATUS[b.status],
  tick: b.target,
  figure: (
    <>
      <span className="min-w-[24px] text-right text-ds-body font-[600] tabular-nums text-ds-fg">{Math.round(b.score)}</span>
      <StatusPill {...statusPill(gradeStatus, b.grade)} size="sm" />
    </>
  ),
});

/** The card: every scored area against its target. Each state is its own (waiting, failed with Retry where asking again can help, nothing scored, no scored area open to the person); an
 *  area that answered with no score yet is named, and so is an area that did not answer, so the picture says what it leaves out. */
export function ScoreCard({ rows, onRetry }: { rows: readonly AreaRow[]; onRetry: () => void }) {
  const view = scoreView(rows);
  const shown = rows.some((r) => r.area.kind === 'score' && r.state !== 'denied');
  const failed = rows.filter((r) => r.area.kind === 'score' && r.state === 'error');
  const retry = failed.some(retryable) ? onRetry : undefined;
  return (
    <ChartCard
      id="scores"
      title="Score against target"
      info={`Each scored area's score on one 0 to 100 scale, the weakest first, in the colour of its grade (Excellent from ${GRADE_LINES.excellent}, Good from ${GRADE_LINES.good}, Fair from ${GRADE_LINES.fair}, else Poor). The tick is the target the area is scored against. Each name opens the area.`}
      meta={view.bars.length > 0 ? `${view.bars.length} ${view.bars.length === 1 ? 'area' : 'areas'}` : undefined}
      state={view.state}
      loadingHeight={300}
      error={{ title: "Couldn't load the scored areas", message: `${nameList(view.leftOut)} could not be read.`, onRetry: retry }}
      emptyText={scoreEmptyText(view, shown)}
    >
      <NamedBars rows={view.bars.map(toRow)} label="Score against target, by area" nameWidth={200} figureWidth={112} />
      <p aria-hidden className="m-0 mt-[12px] flex items-center gap-[6px] text-ds-label text-ds-fg-muted">
        <span className="block h-[12px] w-[2px] rounded-full bg-ds-fg" />
        The tick is the target the area is scored against
      </p>
      {view.noScore.length > 0 && (
        <p className="m-0 mt-[12px] text-ds-label text-ds-fg-muted">
          {'No score yet: '}
          {view.noScore.map((a, i) => (
            <span key={a.key}>
              {i > 0 && ', '}
              <Link href={a.href} className="rounded-ds-control text-ds-fg-body underline focus-visible:outline-none focus-visible:shadow-ds-ring">{a.label}</Link>
            </span>
          ))}
        </p>
      )}
      {view.leftOut.length > 0 && (
        <div className="mt-[8px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          {`Leaves out ${nameList(view.leftOut)}: ${view.leftOut.length === 1 ? 'it' : 'they'} did not answer.`}
          {retry && <Button variant="link" size="sm" leftIcon={<RotateCw aria-hidden />} onClick={retry}>Retry</Button>}
        </div>
      )}
    </ChartCard>
  );
}
