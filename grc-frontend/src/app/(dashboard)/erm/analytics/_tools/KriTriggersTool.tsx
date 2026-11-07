'use client';

// The KRI triggers tool: the KRIs that are past a threshold now, worst first, and by how much. It reads the same list as the KRI register and uses the same rule (lib/erm/kri.ts), so the
// number here, on the register's chips and in the Overview's red KRIs are one number. A list that did not load is an error with Retry - never the green "all within thresholds"
// the old page drew on a failure - and a KRI that was never measured is counted as such, not as healthy. Each trigger links to its KRI and its risk.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { oneOf } from '@/lib/addressState';
import { EmptyState, ErrorState, NoAccessState, PersonChip, SegmentedControl, StatTile, StatusPill, useAddressState } from '@/components/ui/ds';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { STATE_RANK, kriCounts, kriGap, kriState } from '@/lib/erm/kri';
import { statusPill } from '@/lib/status';
import { kriStatus } from '@/lib/statuses/monitoring';
import { formatMetricValue } from '../../../governance/_metrics/metricModel';
import type { KriRow } from '../../_monitoring/kriModel';
import { ThresholdBar } from '../../_monitoring/ThresholdBar';

const SCHEMA = { show: oneOf(['all', 'red', 'amber'] as const, 'all') };
const KEY = ['metric-report', 'kri'] as const;

export function KriTriggersTool() {
  const [a, set] = useAddressState(SCHEMA);
  const q = useQuery({
    queryKey: KEY,
    queryFn: async () => (await ermApi.kris.report(90, 'kri')).data as { kris: KriRow[] },
    retry: (failures, error) => failures < 2 && statusOf(error) === null,
  });
  const rows = useMemo(() => q.data?.kris ?? [], [q.data]);
  const counts = useMemo(() => kriCounts(rows), [rows]);
  const triggers = useMemo(
    () => rows.filter((k) => { const s = kriState(k); return s === 'red' || s === 'amber'; })
      .sort((x, y) => STATE_RANK[kriState(x)] - STATE_RANK[kriState(y)] || (kriGap(y)?.amount ?? 0) - (kriGap(x)?.amount ?? 0) || x.id - y.id),
    [rows],
  );
  const shown = triggers.filter((k) => a.show === 'all' || kriState(k) === a.show);
  const failed = q.isError && !q.data ? { title: 'Not available', message: errorMessage(q.error), onRetry: () => { void q.refetch(); } } : null;

  if (q.isError && !q.data) {
    return statusOf(q.error) === 403
      ? <NoAccessState title="You don't have access to the KRIs" reason={errorMessage(q.error)} />
      : <ErrorState title="Couldn't load the KRIs" message={`${errorMessage(q.error)} Nothing can be said about thresholds until they load.`} onRetry={() => { void q.refetch(); }} />;
  }
  const show = [
    { value: 'all', label: `All (${formatCount(triggers.length)})` },
    { value: 'red', label: `${kriStatus.label('red')} (${formatCount(counts.red)})` },
    { value: 'amber', label: `${kriStatus.label('amber')} (${formatCount(counts.amber)})` },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <StatTile label={kriStatus.label('red')} value={q.data ? formatCount(counts.red) : null} loading={q.isLoading} error={failed} tone={counts.red ? 'danger' : undefined} note="past the amber threshold" />
        <StatTile label={kriStatus.label('amber')} value={q.data ? formatCount(counts.amber) : null} loading={q.isLoading} error={failed} tone={counts.amber ? 'warning' : undefined} note="past the green threshold" />
        <StatTile label={kriStatus.label('green')} value={q.data ? formatCount(counts.green) : null} loading={q.isLoading} error={failed} />
        <StatTile label="Not measured or not rated" value={q.data ? formatCount(counts.no_value + counts.unrated) : null} loading={q.isLoading} error={failed} info="KRIs with no value yet, or with no amber threshold to judge against. They are not counted as healthy." />
      </div>
      <SegmentedControl label="Show" name="trig-show" options={show} value={a.show} onChange={(v) => set({ show: v as 'all' | 'red' | 'amber' })} />

      {q.isLoading && <p role="status" aria-busy="true" className="text-ds-body text-ds-fg-muted">Reading the KRIs…</p>}
      {q.data && rows.length === 0 && <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState bare kind="firstUse" title="No KRIs yet" description="Triggers appear here once KRIs exist and have thresholds." /></div>}
      {q.data && rows.length > 0 && shown.length === 0 && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState bare kind="noMatches" title={triggers.length === 0 ? 'No KRI is past a threshold' : 'None in this view'}
            description={triggers.length === 0 ? `${formatCount(counts.green)} on track${counts.no_value + counts.unrated ? `; ${formatCount(counts.no_value + counts.unrated)} not measured or not rated` : ''}.` : 'Choose All to see the others.'}
            onClearFilters={triggers.length > 0 ? () => set({ show: 'all' }) : undefined} />
        </div>
      )}
      <ul className="m-0 flex list-none flex-col gap-[8px] p-0" aria-label="KRIs past a threshold">
        {shown.map((k) => {
          const gap = kriGap(k);
          return (
            <li key={k.id} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
              <div className="flex flex-wrap items-start gap-x-[10px] gap-y-[4px]">
                <StatusPill size="sm" {...statusPill(kriStatus, kriState(k))} />
                <Link href={`/erm/kris?id=${k.id}`} className="inline-flex min-w-0 flex-1 items-center gap-[4px] text-ds-body font-[600] text-ds-fg underline-offset-2 hover:text-ds-primary-text hover:underline"><span className="break-words [overflow-wrap:anywhere]">{k.name}</span><ArrowUpRight aria-hidden size={14} className="shrink-0" /></Link>
                <span className="whitespace-nowrap text-[18px] font-[600] tabular-nums text-ds-fg">{formatMetricValue(k.current_value, k.unit)}</span>
              </div>
              <div className="mt-[8px] max-w-[560px]"><ThresholdBar kri={k} unit={k.unit} /></div>
              {gap && <p className="mt-[6px] text-ds-body text-ds-fg-body">{`${k.threshold_direction?.startsWith('higher') ? 'Raise' : 'Reduce'} it by at least ${gap.amount}${k.unit === '%' || k.unit === 'pct' ? ' points' : k.unit && k.unit !== 'count' ? ` ${k.unit}` : ''} to get back to ${kriStatus.label(gap.to)}.`}</p>}
              <p className="mt-[6px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-ds-label text-ds-fg-muted">
                {k.risk_id ? <Link href={`/erm/risks/${k.risk_id}`} className="text-ds-primary-text underline-offset-2 hover:underline">{k.risk_title || `Risk ${k.risk_id}`}</Link> : <span>Not linked to a risk</span>}
                <PersonChip name={k.owner_name} size={20} />
                <span>{k.last_measured_at ? `Measured ${formatDate(k.last_measured_at)}` : k.is_live ? 'Live value' : 'Never measured'}</span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
