'use client';

/**
 * The parts of the Third-Party Vendor Risk Overview that the cockpit frame (components/overview) is handed besides its charts (visuals.tsx): "My work" (the person's own work in this module,
 * one row each, the most urgent first), the posture card (the board's thirty-second read: the residual score as a ring against the appetite, the verdict, the two coverages) and the list of
 * the latest signals. Each part loads, fails and has nothing on its own: a failed request is said where its numbers would be, with Retry, and never reads as zero or as "all clear".
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, RotateCw } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button, ErrorState, Notice, ProgressBar, SectionCard, SkeletonRows, StatusPill, WorkRow, type ProgressTone } from '@/components/ui/ds';
import { ScoreRing, type StatusColor } from '@/components/overview/charts';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorBand } from '@/lib/statuses/vendor';
import { VERDICT, postureView, signalRows, REGISTER, type Dashboard, type Scope } from '../_lib/overviewModel';
import { residualBand, type Bands } from '../_lib/vendorRules';
import { lateCount, type WorkItem } from './workModel';
import type { TrendAnswer } from './overviewData';

export interface Feed { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

const QUIET = 'm-0 text-ds-body text-ds-fg-muted';
const LIST = 'm-0 list-none p-0';

/** A request's three states in one place: a skeleton while it runs (or while it shows another scope's answer), the failure with its Retry, else what it answered. */
export function Loaded<T>({ q, label, rows = 3, children }: { q: UseQueryResult<T>; label: string; rows?: number; children: (data: T) => ReactNode }) {
  if (q.isPending || q.isPlaceholderData) return <SkeletonRows rows={rows} columns={2} label={`Loading ${label}`} />;
  if (q.isError || q.data === undefined) {
    return <ErrorState compact title={`Couldn't load ${label}`} message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  }
  return <>{children(q.data)}</>;
}

// ── My work ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WorkCardProps {
  id: string;
  items: WorkItem[];
  /** the sources that feed it, each with its own state */
  sources: Array<{ label: string; feed: Feed }>;
  limit: number;
}

export function WorkCard({ id, items, sources, limit }: WorkCardProps) {
  const [shown, setShown] = useState(limit);
  const failed = sources.filter((s) => s.feed.isError);
  const loading = sources.some((s) => s.feed.isPending);
  const late = lateCount(items);
  const rows = items.slice(0, Math.max(shown, limit));
  return (
    <SectionCard
      id={id}
      title="My work"
      info="What waits for you in this module: items of the Work queue that you own or were given, onboarding requests waiting for a decision, and your planned actions that are due. Late work first, then the oldest."
      meta={loading && items.length === 0 ? undefined : <>{`${formatCount(items.length)} ${items.length === 1 ? 'item' : 'items'}`}{late > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(late)} overdue`}</span></>}</>}
    >
      {failed.map((s) => (
        <Notice key={s.label} tone="warning" title={`${s.label} could not be loaded`} className="mb-[8px]"
          action={canRetry(s.feed.error) ? <Button leftIcon={<RotateCw aria-hidden />} onClick={() => { void s.feed.refetch(); }}>Retry</Button> : undefined}>
          {errorMessage(s.feed.error)} What it holds is not in this list.
        </Notice>
      ))}
      {loading && items.length === 0 && <SkeletonRows rows={Math.min(limit, 5)} columns={3} label="Loading your work" />}
      {!loading && failed.length === 0 && items.length === 0 && (
        <p className="m-0 flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          You&apos;re all caught up. Requests, queue items and planned actions that need you appear here.
        </p>
      )}
      {rows.length > 0 && (
        <ul aria-label="My work" className={LIST}>
          {rows.map((it) => (
            <WorkRow key={it.key} kind={it.kind} title={it.title} href={it.href} context={it.context || undefined} requester={it.requester} due={it.due} calendar overdue={it.due ? it.overdue : undefined} action={it.action} />
          ))}
        </ul>
      )}
      <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
        <span role="status">{items.length > rows.length ? `Showing ${formatCount(rows.length)} of ${formatCount(items.length)}` : ''}</span>
        <span className="flex flex-wrap items-center gap-[8px]">
          {items.length > rows.length && <Button variant="link" size="sm" onClick={() => setShown((n) => n + 25)}>Show more</Button>}
          <Button variant="link" size="sm" href="/vendor-risk/attention">Work queue</Button>
          <Button variant="link" size="sm" href="/vendor-risk/actions">Planned actions</Button>
        </span>
      </div>
    </SectionCard>
  );
}

// ── Posture ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function Measure({ label, value, caption, percent, tone, href }: { label: string; value: string; caption: string; percent: number | null; tone: ProgressTone; href?: string }) {
  return (
    <div className="py-[6px]">
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-ds-body font-[500] text-ds-fg">{label}</span>
        <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{value}</span>
      </div>
      {percent !== null && <ProgressBar value={percent} label={label} showValue={false} tone={tone} className="mt-[4px]" />}
      <p className="m-0 mt-[2px] text-ds-label text-ds-fg-muted">
        {href ? <Link href={href} className="rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{caption}</Link> : caption}
      </p>
    </div>
  );
}

const RING: Record<string, StatusColor> = { unset: 'progress', within: 'good', approaching: 'warn', over: 'bad' };

/** The board's thirty-second read: the residual score as a ring with the appetite as its tick, the verdict in words, and the two coverages. */
export function PostureCard({ id, dash, trend, bands, scope }: { id: string; dash: UseQueryResult<Dashboard>; trend: UseQueryResult<TrendAnswer>; bands: Bands; scope: Scope }) {
  return (
    <SectionCard id={id} title="Risk posture" info="The residual score is the portfolio's average after controls (0 to 100, lower is better), against the appetite your organisation set, the tick on the ring. Critical vendors assessed counts the critical vendors that have a residual score; Reviews in window counts the critical and high vendors that are inside their reassessment window.">
      <Loaded q={dash} label="the posture" rows={4}>
        {(d) => {
          const p = postureView(d, trend.data?.appetite ?? null);
          const band = residualBand(p.residual, bands);
          const v = VERDICT[p.verdict];
          return (
            <>
              <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
                <ScoreRing value={p.scored ? p.residual : null} target={trend.data?.appetite ?? null} tone={RING[p.verdict]} caption="Portfolio residual score" size={112} />
                {p.scored ? (
                <div className="flex min-w-[160px] flex-1 flex-col items-start gap-[6px]">
                  <StatusPill {...statusPill(vendorBand, band)} />
                  {trend.isPending ? <span className="text-ds-label text-ds-fg-muted">Reading the appetite…</span>
                    : trend.isError ? <Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={() => { void trend.refetch(); }}>Appetite unavailable: retry</Button>
                      : <><StatusPill tone={v.tone} label={v.label} />{p.gap && <span className="text-ds-label text-ds-fg-muted">{`${p.gap} (appetite ${trend.data?.appetite})`}</span>}</>}
                  <p className="m-0 text-ds-label text-ds-fg-muted">{`Inherent ${p.inherent}: the controls remove ${p.removed} ${p.removed === 1 ? 'point' : 'points'}.`}</p>
                </div>
                ) : <p className="m-0 min-w-[160px] flex-1 text-ds-body text-ds-fg-muted">No vendor has a residual score yet. The ring fills once an assessment is scored.</p>}
              </div>
              <div className="mt-[8px] border-t border-ds-border pt-[4px]">
                <Measure
                  label="Critical vendors assessed" value={p.assessed.percent === null ? '—' : `${p.assessed.percent}%`} caption={p.assessed.caption}
                  percent={p.assessed.percent} tone={p.assessed.tone === 'success' ? 'success' : 'warning'} href={p.assessed.percent === null ? undefined : `${REGISTER}?tier=critical${scope === 'mine' ? '&owner=me' : ''}`}
                />
                <Measure
                  label="Reviews in window" value={p.window.percent === null ? '—' : `${p.window.percent}%`}
                  caption={p.window.percent === null ? 'No critical or high vendors yet' : `${p.window.caption}${p.window.outside > 0 ? ` · ${p.window.outside} outside` : ''}`}
                  percent={p.window.percent} tone={p.window.percent !== null && p.window.percent >= 85 ? 'success' : 'warning'}
                  href={p.window.outside > 0 ? `${REGISTER}?attention=reassessment_overdue${scope === 'mine' ? '&owner=me' : ''}` : undefined}
                />
              </div>
            </>
          );
        }}
      </Loaded>
    </SectionCard>
  );
}

// ── Latest signals ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function SignalList({ d }: { d: Dashboard }) {
  const rows = signalRows(d.monitoring_feed);
  if (rows.length === 0) return <p className={QUIET}>No signals yet.</p>;
  return (
    <>
      <ul className={LIST}>
        {rows.map((s) => (
          <li key={s.id} className="flex items-start gap-[8px] border-b border-ds-border py-[6px] last:border-b-0">
            <StatusPill size="sm" tone={s.tone} label={s.severity} className="mt-[2px] shrink-0" />
            <div className="min-w-0 flex-1">
              <Link href={`${REGISTER}/${s.vendorId}`} className="block truncate rounded-ds-control text-ds-body font-[500] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring" title={s.title}>{s.title}</Link>
              <span className="block truncate text-ds-label text-ds-fg-muted">{s.meta}</span>
            </div>
            {s.fresh && <StatusPill size="sm" tone="progress" label="New" className="shrink-0" />}
          </li>
        ))}
      </ul>
      <p className="m-0 mt-[6px] px-[8px] text-ds-label"><Link href="/vendor-risk/monitoring" className="rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">All signals</Link></p>
    </>
  );
}
