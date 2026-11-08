'use client';

/**
 * "Trend and recent activity": what the old Dashboard showed under its gauges, kept behind one disclosure on the Journeys tab and read only once it is opened (the page no longer asks the
 * server for the aggregate every time it opens, and no longer asks again every minute). The trend is the controls-weighted daily record of the platform's own history: it grows when a snapshot is
 * captured on a journey (Activity tab) and when the history is written; the recent activity is the latest evidence uploads and requirements marked implemented, each opening its journey.
 * Both have their own loading, empty and failed state with Retry; the chart is a picture with its numbers as a table for a screen reader. The aggregate's per-journey figures are not read.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Disclosure, ChartFrame, ErrorState, Select, SkeletonLines, TextInput, FormField } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatRelative } from '@/lib/format';
import { useActivity, useTrend, type ActivityItem, type TrendPoint } from './hubData';
import { journeyHref } from './hubModel';

const RANGES = [{ label: 'Last 7 days', days: 7 }, { label: 'Last 15 days', days: 15 }, { label: 'Last 30 days', days: 30 }, { label: 'Last year', days: 365 }, { label: 'Choose the days', days: -1 }] as const;
const IMPLEMENTED = '#0f766e';                    // --ds-primary: an SVG attribute cannot read a class
const READY = '#586472';                          // --ds-fg-muted

function Lines({ points }: { points: TrendPoint[] }) {
  const W = 600;
  const H = 120;
  const pad = 6;
  const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const line = (key: 'completion' | 'readiness') => points.map((p, i) => `${(pad + i * step).toFixed(1)},${(pad + (1 - Math.max(0, Math.min(100, p[key])) / 100) * (H - pad * 2)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      <polyline points={line('completion')} fill="none" stroke={IMPLEMENTED} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <polyline points={line('readiness')} fill="none" stroke={READY} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Trend({ open }: { open: boolean }) {
  const [range, setRange] = useState(0);
  const [custom, setCustom] = useState('30');
  const days = RANGES[range].days === -1 ? Math.max(1, Math.min(3650, Number(custom) || 1)) : RANGES[range].days;
  const q = useTrend(days, open);
  const points = q.data ?? [];
  const last = points[points.length - 1];
  return (
    <section aria-label="Trend" className="min-w-0">
      <div className="mb-[8px] flex flex-wrap items-end gap-[8px]">
        <FormField label="Period"><Select value={String(range)} onChange={(e) => setRange(Number(e.target.value))} className="w-[11rem]">{RANGES.map((r, i) => <option key={r.label} value={String(i)}>{r.label}</option>)}</Select></FormField>
        {RANGES[range].days === -1 && <FormField label="Days"><TextInput type="number" min={1} max={3650} value={custom} onChange={(e) => setCustom(e.target.value)} className="w-[6rem]" /></FormField>}
      </div>
      {q.isPending ? <SkeletonLines lines={4} label="Loading the trend" /> : q.isError ? (
        <ErrorState compact title="Couldn't load the trend" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : points.length < 2 ? (
        <p className="m-0 text-ds-body text-ds-fg-muted">{`The trend builds up over time: ${points.length} ${points.length === 1 ? 'point' : 'points'} so far for this period. A snapshot captured on a journey adds one.`}</p>
      ) : (
        <>
          <ChartFrame title="Implemented and ready over time" note="Solid: implemented. Dashed: ready." height={120} data={{ columns: ['Day', 'Implemented %', 'Ready %'], rows: points.map((p) => [p.label, p.completion, p.readiness]) }}>
            <Lines points={points} />
          </ChartFrame>
          <p className="m-0 mt-[4px] flex flex-wrap justify-between gap-x-[12px] text-ds-label text-ds-fg-muted">
            <span>{points[0].label}</span>
            {last && <span>{`Latest: ${last.completion}% implemented, ${last.readiness}% ready`}</span>}
            <span>{last?.label}</span>
          </p>
        </>
      )}
    </section>
  );
}

const WORDS: Record<string, string> = { evidence_uploaded: 'Evidence uploaded', implemented: 'Marked implemented' };

function Activity({ open }: { open: boolean }) {
  const q = useActivity(open);
  const items: ActivityItem[] = useMemo(() => (q.data ?? []).slice(0, 12), [q.data]);
  return (
    <section aria-label="Recent activity" className="min-w-0">
      <h3 className="m-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg">Recent activity</h3>
      {q.isPending ? <SkeletonLines lines={4} label="Loading the recent activity" /> : q.isError ? (
        <ErrorState compact title="Couldn't load the recent activity" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : items.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No activity yet.</p> : (
        <ul className="m-0 flex list-none flex-col divide-y divide-ds-border p-0">
          {items.map((a, i) => (
            <li key={`${a.journey_id}-${a.when}-${i}`} className="flex min-h-ds-control flex-wrap items-center gap-x-[10px] gap-y-[2px] py-[4px]">
              <Link href={journeyHref(a.journey_id)} className="min-w-0 truncate rounded-ds-control text-ds-body font-[500] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{a.control_code || 'A requirement'}</Link>
              <span className="min-w-0 flex-1 truncate text-ds-label text-ds-fg-muted">{`${WORDS[a.type] ?? 'Updated'} · ${a.framework_name}${a.status === 'approved' ? ' · approved' : a.status === 'rejected' ? ' · rejected' : ''}`}</span>
              <span className="shrink-0 text-ds-label text-ds-fg-muted">{formatRelative(a.when)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TrendActivity() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px]">
      <Disclosure label="Trend and recent activity" level={2} region open={open} onOpenChange={setOpen}>
        <div className="grid min-w-0 gap-[20px] pb-[12px] lg:grid-cols-2">
          <Trend open={open} />
          <Activity open={open} />
        </div>
      </Disclosure>
    </div>
  );
}
