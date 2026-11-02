'use client';

/**
 * SnapshotView: the board / committee readout of the evidence library, from the server's summary and the expiring-soon list: the approval rate with its split, the
 * six-month trend, three action figures, what expires next, coverage by type, the status split. Every figure is the server's and says what it counts (the old
 * "Approved this quarter" was the six-month sum; the "+51" beside the rate had no words). The two cards that promised data "after the next backend update" are gone.
 * Each chart is a picture with its numbers as a table for a screen reader (ChartFrame); colours are the platform's tone colours, with the words beside them.
 */
import Link from 'next/link';
import { ChartFrame, ErrorState, ProgressBar, SectionCard, SkeletonLines, StatTile } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { evidenceStatus } from '@/lib/statuses/evidence';
import { approvalRate, monthName, statusSplit, topTypes, trendReading, typeLabel, type EvidenceItem, type EvidenceSummary } from './evidenceModel';
import { ExpiryText, LetterTile } from './lib';

const WATCHLIST = 6;
const MUTED = 'text-ds-fg-muted';
/** the colour of each part of the split: the platform's tone colours (the words are beside every colour) */
const SPLIT_COLOUR: Record<string, string> = {
  approved: TONE.success.dot, pending_review: TONE.pending.dot, draft: TONE.neutral.dot, rejected: TONE.danger.dot, expired: TONE.warning.dot,
  archived: TONE.neutral.border, other: TONE.neutral.border,
};
const splitWord = (key: string): string => (key === 'other' ? 'Other' : evidenceStatus.label(key));

function Donut({ parts, rate }: { parts: Array<{ key: string; count: number }>; rate: number | null }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const total = parts.reduce((s, p) => s + p.count, 0);
  let acc = 0;
  const arcs = parts.filter((p) => p.count > 0).map((p) => {
    const len = (p.count / total) * C;
    const arc = { key: p.key, dash: `${len} ${C - len}`, offset: -acc };
    acc += len;
    return arc;
  });
  return (
    <div className="relative h-[112px] w-[112px] shrink-0">
      <svg viewBox="0 0 100 100" className="h-[112px] w-[112px] -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#E1E6EB" strokeWidth={10} />
        {arcs.map((a) => <circle key={a.key} cx="50" cy="50" r={R} fill="none" stroke={SPLIT_COLOUR[a.key]} strokeWidth={10} strokeDasharray={a.dash} strokeDashoffset={a.offset} />)}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-ds-section font-[600] tabular-nums text-ds-fg">{rate === null ? '—' : `${rate}%`}</span>
        <span className={`text-ds-label ${MUTED}`}>approved</span>
      </div>
    </div>
  );
}

function Trend({ months }: { months: NonNullable<EvidenceSummary['by_month']> }) {
  const W = 260;
  const H = 72;
  const padX = 6;
  const padY = 8;
  const maxVal = Math.max(1, ...months.map((d) => Math.max(d.uploaded, d.approved)));
  const stepX = months.length > 1 ? (W - padX * 2) / (months.length - 1) : 0;
  const points = (key: 'uploaded' | 'approved') => months.map((d, i) => `${(padX + i * stepX).toFixed(1)},${(padY + (1 - d[key] / maxVal) * (H - padY * 2)).toFixed(1)}`).join(' ');
  return (
    <ChartFrame
      title="Last 6 months"
      height={80}
      data={{ columns: ['Month', 'Added', 'Approved'], rows: months.map((m) => [monthName(m.month), m.uploaded, m.approved]) }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
        <polyline points={points('uploaded')} fill="none" stroke="#0F766E" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={points('approved')} fill="none" stroke="#64748B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </ChartFrame>
  );
}

export function SnapshotView({ summary, summaryState, expiringSoon, expiringState }: {
  summary: EvidenceSummary | undefined;
  summaryState: { loading: boolean; error: unknown; onRetry: () => void };
  expiringSoon: EvidenceItem[];
  expiringState: { loading: boolean; error: unknown; onRetry: () => void };
}) {
  if (summaryState.loading) return <SkeletonLines lines={8} label="Loading the snapshot" />;
  if (!summary) {
    return <ErrorState title="Couldn't load the snapshot" message={errorMessage(summaryState.error)} onRetry={canRetry(summaryState.error) ? summaryState.onRetry : undefined} />;
  }

  const total = summary.total_count ?? 0;
  const rate = approvalRate(summary);
  const parts = statusSplit(summary);
  const trend = trendReading(summary);
  const types = topTypes(summary);
  const typeCount = Object.keys(summary.by_type ?? {}).length;
  const pending = summary.by_status?.pending_review ?? summary.pending_review_count ?? 0;
  const approved = summary.by_status?.approved ?? 0;
  const expiring = summary.expiring_soon_count ?? 0;
  const watchlist = expiringSoon.slice(0, WATCHLIST);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard id="approval-rate" title="Approval rate" info="The share of all evidence items that are approved.">
            <div className="flex flex-col gap-[16px] sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[32px] font-[600] leading-[40px] tabular-nums text-ds-fg">{rate === null ? 'Not recorded' : `${rate}%`}</p>
                <p className="text-ds-body text-ds-fg-body">{formatCount(approved)} of {formatCount(total)} evidence items approved</p>
                {trend && trend.delta !== null && trend.delta !== 0 && (
                  <p className={`mt-[4px] text-ds-label ${MUTED}`}>{trend.delta > 0 ? `${formatCount(trend.delta)} more` : `${formatCount(-trend.delta)} fewer`} approvals in the latest month than in the earliest of the last six.</p>
                )}
              </div>
              {total > 0 && (
                <div className="flex items-center gap-[16px]">
                  <ChartFrame title="Items by status" height={112} data={{ columns: ['Status', 'Items'], rows: parts.map((p) => [splitWord(p.key), p.count]) }} className="w-[112px]">
                    <Donut parts={parts} rate={rate} />
                  </ChartFrame>
                  <ul className="flex flex-col gap-[4px]">
                    {parts.map((p) => (
                      <li key={p.key} className="flex items-center gap-[8px] text-ds-label text-ds-fg-body">
                        <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: SPLIT_COLOUR[p.key] }} />
                        <span className="w-[112px] truncate">{splitWord(p.key)}</span>
                        <span className="font-[600] tabular-nums text-ds-fg">{formatCount(p.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
        <SectionCard id="trend" title="Added and approved" info="Evidence added (by upload date) and approved (by approval date) in each of the last six months.">
          {trend ? <Trend months={trend.months} /> : <p className={`text-ds-body ${MUTED}`}>Not recorded: the server sent no monthly figures.</p>}
          {trend && (
            <div className="mt-[4px] flex justify-between">{trend.months.map((m) => <span key={m.month} className={`text-ds-label ${MUTED}`}>{monthName(m.month)}</span>)}</div>
          )}
          {trend && (
            <div className="mt-[8px] flex flex-wrap items-center gap-x-[16px] gap-y-[4px] text-ds-label text-ds-fg-body">
              <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[2px] w-[12px] rounded-full" style={{ background: '#0F766E' }} />Added</span>
              <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[2px] w-[12px] rounded-full" style={{ background: '#64748B' }} />Approved</span>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
        <StatTile label="Approved in the last 6 months" value={trend ? formatCount(trend.approvedInWindow) : null} info={trend ? undefined : 'The server sent no monthly figures.'} tone="success" />
        <StatTile
          label="Pending review" value={formatCount(pending)}
          link={pending > 0 ? { href: '/evidence?status=pending_review', label: `${formatCount(pending)} pending review. Open the pending files` } : undefined}
        />
        <StatTile label="Expiring soon" value={formatCount(expiring)} note="Within the next 30 days" tone={expiring > 0 ? 'warning' : 'default'} />
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <SectionCard id="expiring" title="Expiring soon" meta={`${formatCount(expiring)} in total`}>
          {expiringState.loading ? <SkeletonLines lines={3} label="Loading what expires next" /> : expiringState.error ? (
            <ErrorState compact title="Couldn't load what expires next" message={errorMessage(expiringState.error)} onRetry={canRetry(expiringState.error) ? expiringState.onRetry : undefined} />
          ) : watchlist.length === 0 ? (
            <p className={`text-ds-body ${MUTED}`}>Nothing expires in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-ds-border">
              {watchlist.map((item) => (
                <li key={item.id} className="flex items-center gap-[12px] py-[8px]">
                  <LetterTile name={item.name} size={24} />
                  <Link href={`/evidence/${item.id}`} title={item.name} className="min-w-0 flex-1 truncate rounded-ds-control text-ds-body text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{item.name}</Link>
                  <ExpiryText expiry={item.expiry_date} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard id="by-type" title="Coverage by type" meta={typeCount > types.length ? `Top ${types.length} of ${formatCount(typeCount)} types` : undefined}>
          {types.length === 0 ? <p className={`text-ds-body ${MUTED}`}>No evidence yet.</p> : (
            <ul className="flex flex-col gap-[8px]">
              {types.map((t) => (
                <li key={t.type} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-[12px]">
                  <span className="truncate text-ds-body text-ds-fg-body" title={typeLabel(t.type)}>{typeLabel(t.type)}</span>
                  <ProgressBar value={t.pctOfMax} valueText={formatCount(t.count)} label={`${typeLabel(t.type)}: ${t.count} items`} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
