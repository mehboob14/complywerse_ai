'use client';

/**
 * The parts of the Third-Party Vendor Risk Overview that the cockpit frame (components/overview) is handed: "My work" (the person's own work in this module, one row each, the most urgent
 * first), the posture card (the board's thirty-second read: the verdict against the appetite, the residual score on the tenant's bands, the two coverages), and the breakdowns of the
 * whole portfolio (vendors by next step, by tier, by status, the open findings, the highest residual risk, the latest signals, the 12-month trend). Each part loads, fails and has nothing
 * on its own: a failed request is said where its numbers would be, with Retry, and never reads as zero or as "all clear".
 */
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, RotateCw } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button, CountRow, ErrorState, Notice, ProgressBar, SectionCard, SkeletonRows, StatusPill, WorkRow, type ProgressTone } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorBand, vendorGrade, vendorTier } from '@/lib/statuses/vendor';
import {
  VERDICT, attentionRows, barWidth, domainRows, postureView, severitySlices, signalRows, statusBars, tierGaps, tierSlices, topResidual,
  FINDINGS, REGISTER, type Dashboard, type Scope,
} from '../_lib/overviewModel';
import { residualBand, type Band, type Bands } from '../_lib/vendorRules';
import { lateCount, type WorkItem } from './workModel';
import type { TrendAnswer } from './overviewData';
import TrendChart from './TrendChart';

export interface Feed { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

const QUIET = 'm-0 text-ds-body text-ds-fg-muted';
const LIST = 'm-0 list-none p-0';
const BAND_BAR: Record<Band, ProgressTone> = { critical: 'danger', high: 'warning', medium: 'primary', low: 'success', none: 'primary' };

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

export function PostureCard({ id, dash, trend, bands, scope }: { id: string; dash: UseQueryResult<Dashboard>; trend: UseQueryResult<TrendAnswer>; bands: Bands; scope: Scope }) {
  return (
    <SectionCard id={id} title="Risk posture" info="The residual score is the portfolio's average after controls, against the appetite your organisation set. Critical vendors assessed counts the critical vendors that have a residual score; Reviews in window counts the critical and high vendors that are inside their reassessment window.">
      <Loaded q={dash} label="the posture" rows={4}>
        {(d) => {
          const p = postureView(d, trend.data?.appetite ?? null);
          const band = residualBand(p.residual, bands);
          const v = VERDICT[p.verdict];
          return (
            <>
              <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px]">
                <div className="text-[32px] font-[600] leading-none tabular-nums text-ds-fg">{p.residual}<span className="ml-[4px] text-ds-body font-normal text-ds-fg-muted">/ 100 residual</span></div>
                <div className="flex flex-wrap items-center gap-[6px]">
                  <StatusPill {...statusPill(vendorBand, band)} />
                  {trend.isPending ? <span className="text-ds-label text-ds-fg-muted">Reading the appetite…</span>
                    : trend.isError ? <Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={() => { void trend.refetch(); }}>Appetite unavailable: retry</Button>
                      : <><StatusPill tone={v.tone} label={v.label} />{p.gap && <span className="text-ds-label text-ds-fg-muted">{p.gap}</span>}</>}
                </div>
              </div>
              <p className="m-0 mt-[4px] text-ds-label text-ds-fg-muted">{`${p.headline}. Inherent ${p.inherent}: the controls remove ${p.removed} ${p.removed === 1 ? 'point' : 'points'}.`}</p>
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
                <Measure
                  label="Reviews due in 30 days" value={String(p.reviews.due)}
                  caption={p.reviews.overdue === null ? 'Overdue not available' : p.reviews.overdue > 0 ? `${p.reviews.overdue} reassessment${p.reviews.overdue === 1 ? ' is' : 's are'} overdue` : 'None overdue'}
                  percent={null} tone="primary" href={p.reviews.overdue ? `${REGISTER}?attention=reassessment_overdue${scope === 'mine' ? '&owner=me' : ''}` : undefined}
                />
              </div>
            </>
          );
        }}
      </Loaded>
    </SectionCard>
  );
}

// ── Breakdowns ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function NextStepList({ d, scope }: { d: Dashboard; scope: Scope }) {
  const rows = attentionRows(d.attention_counts, scope);
  if (rows.length === 0) return <p className={QUIET}>Every vendor is where it should be.</p>;
  return <ul className={LIST}>{rows.map((r) => <CountRow key={r.code} label={r.label} count={r.count} href={r.href} tone={r.tone} />)}</ul>;
}

export function TierList({ d, scope }: { d: Dashboard; scope: Scope }) {
  const slices = tierSlices(d.tier_counts, scope);
  if (slices.length === 0) return <p className={QUIET}>No vendors yet.</p>;
  return <ul className={LIST}>{slices.map((s) => <CountRow key={s.key} label={s.label} count={s.value} href={s.href} tone={vendorTier.tone(s.key)} />)}</ul>;
}

export function StatusList({ d }: { d: Dashboard }) {
  const bars = statusBars(d.by_status);
  if (bars.length === 0) return <p className={QUIET}>No vendors yet.</p>;
  return <ul className={LIST}>{bars.map((b) => <CountRow key={b.key} label={`${b.label} · ${b.percent}%`} count={b.count} tone="neutral" />)}</ul>;
}

export function FindingsList({ d }: { d: Dashboard }) {
  const severity = severitySlices(d.findings_severity);
  const domains = domainRows(d.findings_by_domain);
  if (severity.length === 0) {
    return <p className="m-0 flex items-center gap-[8px] text-ds-body text-ds-fg-muted"><CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />No findings are open.</p>;
  }
  return (
    <>
      <ul className={LIST}>{severity.map((s) => <CountRow key={s.key} label={s.label} count={s.value} href={s.href} tone={vendorTier.tone(s.key)} />)}</ul>
      {domains.length > 0 && (
        <>
          <h3 className="m-0 mt-[8px] border-t border-ds-border px-[8px] pt-[8px] !text-ds-label !font-[600] !text-ds-fg-muted">Where they gather</h3>
          <ul className={LIST}>{domains.map((r) => <CountRow key={r.key} label={r.label} count={r.value} href={r.href} />)}</ul>
        </>
      )}
      <p className="m-0 mt-[6px] px-[8px] text-ds-label text-ds-fg-muted">{`${d.kpis.closure_rate}% of every finding ever raised is closed or accepted. `}<Link href={FINDINGS} className="rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">All findings</Link></p>
    </>
  );
}

export function ResidualList({ d, bands }: { d: Dashboard; bands: Bands }) {
  const rows = topResidual(d.top_residual_vendors);
  if (rows.length === 0) return <p className={QUIET}>No scored assessments yet.</p>;
  return (
    <ol className={LIST}>
      {rows.map((v) => {
        const band = residualBand(v.residual, bands);
        return (
          <li key={v.id} className="border-b border-ds-border py-[6px] last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
              <Link href={`${REGISTER}/${v.id}`} className="min-w-0 flex-1 truncate rounded-ds-control text-ds-body font-[500] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring" title={v.name}>{v.name}</Link>
              <StatusPill size="sm" {...statusPill(vendorTier, v.tier ?? 'not_tiered')} />
              {v.grade && <StatusPill size="sm" {...statusPill(vendorGrade, v.grade)} />}
            </div>
            <div className="mt-[4px] flex items-center gap-[8px]">
              <ProgressBar value={barWidth(v.residual)} label={`${v.name}: residual score`} showValue={false} tone={BAND_BAR[band]} className="flex-1" />
              <span className="w-[56px] text-right text-ds-body font-[600] tabular-nums text-ds-fg">{v.residual ?? '—'}</span>
              <span className="w-[64px] text-ds-label text-ds-fg-muted">{vendorBand.label(band)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TierGapList({ d }: { d: Dashboard }) {
  const rows = tierGaps(d.inherent_vs_residual);
  if (rows.length === 0) return <p className={QUIET}>No scored assessments yet.</p>;
  return (
    <ul className={LIST}>
      {rows.map((r) => (
        <li key={r.tier} className="flex min-h-ds-control flex-wrap items-center gap-x-[8px] border-b border-ds-border py-[4px] last:border-b-0">
          <span className="min-w-0 flex-1 text-ds-body text-ds-fg">{r.label}</span>
          <span className="text-ds-body tabular-nums text-ds-fg-muted">{`Inherent ${r.inherent}`}</span>
          <span className="text-ds-body font-[600] tabular-nums text-ds-fg">{`Residual ${r.residual}`}</span>
        </li>
      ))}
    </ul>
  );
}

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

export function TrendCard({ trend }: { trend: UseQueryResult<TrendAnswer> }) {
  return (
    <Loaded q={trend} label="the trend" rows={4}>
      {(t) => (t.series.some((s) => s.residual != null || s.inherent != null)
        ? <TrendChart trend={t} />
        : <p className={QUIET}>No history yet. The trend builds up as assessments are scored.</p>)}
    </Loaded>
  );
}

