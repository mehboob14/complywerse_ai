'use client';

// "How the programme is running": the coverage of the supplier portfolio today and the programme's own measures (medians over the last 90 days), each with the daily record as a small line, in ONE card
// (seven related figures read as a row, not as seven boxes that push the register off the screen). The figures are the server's (GET tpra/reports/measures); a failed read says so with Retry, a measure
// with no cases is "Not recorded", never 0. The reassessments-overdue figure counts as the register does: the earliest review date of a supplier or its open engagements.
import { useQuery } from '@tanstack/react-query';
import { ErrorState, SectionCard, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { healthTiles, type HealthTile, type Measures } from './reportsModel';

export const MEASURES_KEY = ['tprm-report-measures'] as const;

/** The daily record of one figure as a line; fewer than two points draw nothing. It repeats what the figure says, so a screen reader skips it. */
function Spark({ points }: { points: Array<{ date: string; value: number }> | null }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const line = points.map((p, i) => `${(i / (points.length - 1)) * 100},${hi === lo ? 10 : 18 - ((p.value - lo) / (hi - lo)) * 16}`).join(' ');
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="mt-[4px] h-[20px] w-full text-ds-primary" aria-hidden="true">
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Cell({ t }: { t: HealthTile }) {
  return (
    <div className="min-w-0">
      <dt className="break-words text-ds-label text-ds-fg-muted">{t.label}</dt>
      <dd className="m-0">
        {t.value === null
          ? <span className="block text-ds-body text-ds-fg-muted">Not recorded</span>
          : <span className="block text-[20px] font-[600] leading-[28px] tabular-nums text-ds-fg">{t.value}</span>}
        {t.note && <span className="block break-words text-ds-label text-ds-fg-muted">{t.note}</span>}
        <Spark points={t.trend} />
      </dd>
    </div>
  );
}

export default function HealthBand() {
  const q = useQuery({ queryKey: MEASURES_KEY, queryFn: async () => (await tpraApi.reportMeasures(365)).data as Measures, ...TPRM_QUERY_OPTS });
  const tiles = q.data ? healthTiles(q.data) : null;
  return (
    <SectionCard id="health" title="How the programme is running" info="Coverage as of today; the times are medians over the last 90 days. The lines show the daily record. A supplier counts as overdue when the earliest review date of the supplier or its open engagements has passed.">
      {q.isError && !tiles ? (
        <ErrorState compact title="Couldn't load the programme measures" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : tiles ? (
        <dl className="m-0 grid grid-cols-2 gap-x-[16px] gap-y-[16px] sm:grid-cols-4 xl:grid-cols-7">
          {tiles.map((t) => <Cell key={t.key} t={t} />)}
        </dl>
      ) : (
        <div className="grid grid-cols-2 gap-[16px] sm:grid-cols-4 xl:grid-cols-7" aria-busy="true" aria-label="Loading the programme measures">
          {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-[72px] w-full" />)}
        </div>
      )}
    </SectionCard>
  );
}
