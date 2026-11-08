'use client';

/**
 * Evidence Management > Insights: the readout for a committee or an audit, one scroll of cards (it replaces the old Snapshot, the orphan Coverage page and the unreachable Performance
 * view). The tiles are the server's summary (true totals): Approved (the status, as it always was) beside In force (approved AND still in date). Under them: the status split and the
 * six-month trend, coverage by framework (with the stricter reading beside the old one), what needs a look (lapsed, ending within 30 days, rated below 50%: the Library's own rows and
 * rules, each opening the Library on that file or that view) and who owns the files. Every card has its own loading, empty and failed state with Retry: a failed request is never a zero.
 * Each chart is a picture with its numbers as a table for a screen reader (ChartFrame).
 */
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { ChartFrame, ErrorState, PersonChip, ProgressBar, RegisterTable, SectionCard, SkeletonLines, StatTile, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { evidenceStatus } from '@/lib/statuses/evidence';
import { approvalRate, monthName, statusSplit, topTypes, trendReading, typeLabel, type EvidenceSummary } from '../_workspace/evidenceModel';
import { ExpiryText } from '../_workspace/lib';
import { COVERAGE_KEY, RETRY_AFTER, retryRead, useLibrary, useSummary } from '../_library/libraryData';
import type { LibraryRow } from '../_library/libraryModel';
import {
  WATCH_SHOWN, attention, coverageLine, coverageRows, insightTiles, libraryLinkForFramework, ownerTable, type Coverage, type OwnerRow,
} from './insightsModel';

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
        <circle cx="50" cy="50" r={R} fill="none" stroke={TONE.neutral.border} strokeWidth={10} />
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
    <ChartFrame title="Last 6 months" height={80} data={{ columns: ['Month', 'Added', 'Approved'], rows: months.map((m) => [monthName(m.month), m.uploaded, m.approved]) }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
        <polyline points={points('uploaded')} fill="none" stroke={TONE.success.dot} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={points('approved')} fill="none" stroke={TONE.neutral.dot} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </ChartFrame>
  );
}

function useCoverage() {
  return useQuery({
    queryKey: [...COVERAGE_KEY],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/links/coverage')).data as Coverage,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

/** A small list of files that need a look; each name opens the Library on that file. */
function WatchList({ id, title, rows, total, empty, href, viewAll, note }: { id: string; title: string; rows: LibraryRow[]; total: number; empty: string; href?: string; viewAll?: string; note?: (r: LibraryRow) => ReactNode }) {
  const shown = rows.slice(0, WATCH_SHOWN);
  return (
    <SectionCard id={id} title={title} meta={total > 0 ? `${formatCount(total)} in all` : undefined}>
      {shown.length === 0 ? <p className={`text-ds-body ${MUTED}`}>{empty}</p> : (
        <>
          <ul className="m-0 list-none divide-y divide-ds-border p-0">
            {shown.map((r) => (
              <li key={r.id} className="flex items-center gap-[12px] py-[6px]">
                <Link href={`/evidence?open=${r.id}`} title={r.name} className="min-w-0 flex-1 truncate rounded-ds-control text-ds-body text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.name}</Link>
                {note ? note(r) : <ExpiryText expiry={r.expiry_date} />}
              </li>
            ))}
          </ul>
          {total > shown.length && href && <Link href={href} className="mt-[8px] inline-flex min-h-ds-control items-center rounded-ds-control text-ds-body font-[500] text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{viewAll}</Link>}
          {total > shown.length && !href && <p className={`mt-[8px] text-ds-label ${MUTED}`}>{`And ${formatCount(total - shown.length)} more`}</p>}
        </>
      )}
    </SectionCard>
  );
}

export function InsightsView() {
  const summaryQ = useSummary();
  const libraryQ = useLibrary();
  const coverageQ = useCoverage();
  const summary = summaryQ.data;
  const tiles = insightTiles(summary);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [libraryQ.data]);
  const rows = useMemo(() => libraryQ.data?.items ?? [], [libraryQ.data]);
  const watch = useMemo(() => attention(rows, now), [rows, now]);
  const owners = useMemo(() => ownerTable(rows, now), [rows, now]);
  const frameworks = useMemo(() => coverageRows(coverageQ.data), [coverageQ.data]);
  const summaryError = summaryQ.isError && !summary ? { title: "Couldn't load the figures", message: errorMessage(summaryQ.error), onRetry: canRetry(summaryQ.error) ? () => { void summaryQ.refetch(); } : undefined } : null;
  const listError = libraryQ.isError && !libraryQ.data ? { title: "Couldn't load the files", message: errorMessage(libraryQ.error), onRetry: canRetry(libraryQ.error) ? () => { void libraryQ.refetch(); } : undefined } : null;
  const cutFiles = !!libraryQ.data?.truncated;

  const rate = approvalRate(summary);
  const parts = statusSplit(summary);
  const trend = trendReading(summary);
  const types = topTypes(summary);
  const typeCount = Object.keys(summary?.by_type ?? {}).length;

  const ownerColumns: RegisterColumn<OwnerRow>[] = [
    { key: 'owner', header: 'Owner', isRowHeader: true, cell: (r) => (r.name ? <PersonChip name={r.name} /> : <span className={MUTED}>Unassigned</span>) },
    { key: 'total', header: 'Files', align: 'right', width: 'w-[80px]', card: 'meta', cell: (r) => <span className="tabular-nums">{formatCount(r.total)}</span> },
    { key: 'inforce', header: 'In force', align: 'right', width: 'w-[96px]', card: 'meta', cell: (r) => <span className="tabular-nums">{formatCount(r.inForce)}</span> },
    { key: 'pending', header: 'Pending', align: 'right', width: 'w-[96px]', card: 'meta', cell: (r) => <span className={`tabular-nums ${r.pending ? '' : MUTED}`}>{formatCount(r.pending)}</span> },
    { key: 'lapsed', header: 'Lapsed', align: 'right', width: 'w-[96px]', card: 'meta', cell: (r) => <span className={`tabular-nums ${r.lapsed ? 'font-[600] text-ds-danger' : MUTED}`}>{formatCount(r.lapsed)}</span> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Files" value={tiles ? formatCount(tiles.total) : null} loading={summaryQ.isLoading} error={summaryError} note="In the library" />
        <StatTile
          label="In force" value={tiles?.inForcePct == null ? null : `${tiles.inForcePct}%`} loading={summaryQ.isLoading} error={summaryError} tone="success"
          note={tiles ? `${formatCount(tiles.inForce)} of ${formatCount(tiles.total)}` : undefined} info="Approved and still in date. A file that was approved and has lapsed since is not in force."
        />
        <StatTile
          label="Approved" value={tiles?.approvedPct == null ? null : `${tiles.approvedPct}%`} loading={summaryQ.isLoading} error={summaryError}
          note={tiles ? `${formatCount(tiles.approved)} of ${formatCount(tiles.total)}` : undefined} info={tiles && tiles.approvedPct == null ? 'Nothing has been uploaded yet.' : 'Every file whose status is Approved, lapsed or not.'}
        />
        <StatTile
          label="Pending review" value={tiles ? formatCount(tiles.pending) : null} loading={summaryQ.isLoading} error={summaryError}
          link={tiles && tiles.pending > 0 ? { href: '/evidence?status=pending_review', label: `${formatCount(tiles.pending)} pending review. Open the pending files` } : undefined}
        />
        <StatTile
          label="Expiring" value={tiles ? formatCount(tiles.expiring) : null} loading={summaryQ.isLoading} error={summaryError} tone={tiles && tiles.expiring > 0 ? 'warning' : 'default'} note="Within 30 days"
          link={tiles && tiles.expiring > 0 ? { href: '/evidence?quick=expiring', label: `${formatCount(tiles.expiring)} expiring. Open them in the library` } : undefined}
        />
        <StatTile
          label="Lapsed" value={tiles ? formatCount(tiles.lapsed) : null} loading={summaryQ.isLoading} error={summaryError} tone={tiles && tiles.lapsed > 0 ? 'danger' : 'default'} note="Past their date"
          link={tiles && tiles.lapsed > 0 ? { href: '/evidence?quick=lapsed', label: `${formatCount(tiles.lapsed)} lapsed. Open them in the library` } : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard id="status-split" title="Files by status" info="Every file in the library by the status it has. The share in the middle is Approved.">
            {summaryQ.isLoading ? <SkeletonLines lines={4} label="Loading the status split" /> : summaryError ? (
              <ErrorState compact title={summaryError.title} message={summaryError.message} onRetry={summaryError.onRetry} />
            ) : (summary?.total_count ?? 0) === 0 ? <p className={`text-ds-body ${MUTED}`}>No evidence yet.</p> : (
              <div className="flex flex-col gap-[16px] sm:flex-row sm:items-center">
                <ChartFrame title="Files by status" height={112} data={{ columns: ['Status', 'Files'], rows: parts.map((p) => [splitWord(p.key), p.count]) }} className="w-[112px]">
                  <Donut parts={parts} rate={rate} />
                </ChartFrame>
                <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
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
          </SectionCard>
        </div>
        <SectionCard id="trend" title="Added and approved" info="Files added (by upload date) and approved (by approval date) in each of the last six months.">
          {summaryQ.isLoading ? <SkeletonLines lines={3} label="Loading the trend" /> : summaryError ? (
            <ErrorState compact title={summaryError.title} message={summaryError.message} onRetry={summaryError.onRetry} />
          ) : trend ? (
            <>
              <Trend months={trend.months} />
              <div className="mt-[4px] flex justify-between">{trend.months.map((m) => <span key={m.month} className={`text-ds-label ${MUTED}`}>{monthName(m.month)}</span>)}</div>
              <div className="mt-[8px] flex flex-wrap items-center gap-x-[16px] gap-y-[4px] text-ds-label text-ds-fg-body">
                <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[2px] w-[12px] rounded-full" style={{ background: TONE.success.dot }} />Added</span>
                <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[2px] w-[12px] rounded-full" style={{ background: TONE.neutral.dot }} />Approved</span>
              </div>
            </>
          ) : <p className={`text-ds-body ${MUTED}`}>Not recorded: the server sent no monthly figures.</p>}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <SectionCard
          id="coverage" title="Coverage by framework"
          info="A control counts as covered when any evidence is linked to it, whatever its status. The second bar counts only controls with approved evidence that is still in date."
        >
          {coverageQ.isLoading ? <SkeletonLines lines={4} label="Loading the coverage" /> : coverageQ.isError && !coverageQ.data ? (
            <ErrorState compact title="Couldn't load the coverage" message={errorMessage(coverageQ.error)} onRetry={canRetry(coverageQ.error) ? () => { void coverageQ.refetch(); } : undefined} />
          ) : frameworks.length === 0 ? <p className={`text-ds-body ${MUTED}`}>No framework has controls to cover yet.</p> : (
            <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
              {frameworks.map((f) => (
                <li key={f.framework_id} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-[8px]">
                    <Link href={libraryLinkForFramework(f.framework_name)} title={`${f.framework_name}. Open its evidence in the library`} className="min-w-0 truncate rounded-ds-control text-ds-body font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{f.framework_name}</Link>
                    <span className={`shrink-0 text-ds-label ${MUTED}`}>{coverageLine(f)}</span>
                  </div>
                  <ProgressBar value={Math.round(f.coverage_percentage)} label={`${f.framework_name}: controls with evidence linked`} tone={f.coverage_percentage >= 80 ? 'success' : f.coverage_percentage >= 50 ? 'warning' : 'danger'} className="mt-[4px] w-full" />
                  {f.in_force_percentage != null && (
                    <ProgressBar value={Math.round(f.in_force_percentage)} label={`${f.framework_name}: controls with approved evidence that is in date`} tone="primary" className="mt-[4px] w-full" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard id="by-type" title="Files by type" meta={typeCount > types.length ? `Top ${types.length} of ${formatCount(typeCount)} types` : undefined}>
          {summaryQ.isLoading ? <SkeletonLines lines={4} label="Loading the types" /> : summaryError ? (
            <ErrorState compact title={summaryError.title} message={summaryError.message} onRetry={summaryError.onRetry} />
          ) : types.length === 0 ? <p className={`text-ds-body ${MUTED}`}>No evidence yet.</p> : (
            <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
              {types.map((t) => (
                <li key={t.type} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-[12px]">
                  <span className="truncate text-ds-body text-ds-fg-body" title={typeLabel(t.type)}>{typeLabel(t.type)}</span>
                  <ProgressBar value={t.pctOfMax} valueText={formatCount(t.count)} label={`${typeLabel(t.type)}: ${t.count} files`} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {listError ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface"><ErrorState compact title={listError.title} message={listError.message} onRetry={listError.onRetry} /></div>
      ) : libraryQ.isLoading ? (
        <SkeletonLines lines={5} label="Loading the files that need a look" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
            <WatchList id="lapsed" title="Lapsed" rows={watch.lapsed} total={watch.lapsed.length} empty="Nothing has lapsed." href="/evidence?quick=lapsed" viewAll="See all lapsed files" />
            <WatchList id="expiring" title="Expiring in 30 days" rows={watch.expiring} total={watch.expiring.length} empty="Nothing expires in the next 30 days." href="/evidence?quick=expiring" viewAll="See all expiring files" />
            <WatchList
              id="low-maturity" title="Rated below 50%" rows={watch.low} total={watch.low.length} empty="No rated file is below 50%."
              note={(r) => <span className={`shrink-0 text-ds-label tabular-nums ${MUTED}`}>{Math.round(((r.quality_score ?? 0) <= 1 ? (r.quality_score ?? 0) * 100 : (r.quality_score ?? 0)))}%</span>}
            />
          </div>
          <SectionCard id="by-owner" title="Who owns the files" meta={cutFiles ? `Counted over the newest ${formatCount(rows.length)} files` : undefined}>
            <RegisterTable
              caption="Files by owner"
              columns={ownerColumns}
              rows={owners.slice(0, 10)}
              getRowId={(r) => r.key}
              empty={<p className={`py-[8px] text-ds-body ${MUTED}`}>No evidence yet.</p>}
              cardTitle={(r) => (r.name ? <PersonChip name={r.name} /> : <span className={MUTED}>Unassigned</span>)}
            />
          </SectionCard>
        </>
      )}
    </div>
  );
}
