'use client';

// Verity's Overview: four tiles and seven cards, each a way into the list it counts (the numbers and links are overviewModel.ts).
// White cards in Compliverse's colours; explicit hex because the platform CSS repaints slate and white inside the shell.

import Link from 'next/link';
import { AlertCircle, AlertTriangle, Check, ChevronRight, Clock, Gauge, Users, type LucideIcon } from 'lucide-react';
import { ChartCard, Donut, GradePill, HalfGauge, StatTile, StatusPill, TierBadge, TONE, type Tone } from '../_ui';
import {
  FINDINGS, REGISTER, attentionRows, barWidth, coverageView, intakeRows, registerHref, severitySlices, statusBars, sum, tiles, tierSlices, topResidual,
  type Dashboard, type Scope,
} from '../_lib/overviewModel';

const TILE_ICON: Record<string, LucideIcon> = { not_tiered: Gauge, no_owner: Users, overdue: Clock, critical: AlertTriangle };
const TONE_ICON: Record<Tone, LucideIcon> = { danger: AlertTriangle, warning: AlertCircle, progress: Clock, success: Check, pending: Clock, neutral: AlertCircle };

const ROW_LINK = 'flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[#f3f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const QUIET = 'py-8 text-center text-[13px] leading-5 text-[#64707e]';

export function Tiles({ d, scope }: { d: Dashboard; scope: Scope }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles(d, scope).map((t) => (
        <StatTile key={t.key} label={t.label} value={t.value} icon={TILE_ICON[t.key]} tone={t.tone} caption={t.caption} href={t.href} />
      ))}
    </div>
  );
}

export function AttentionCard({ d, scope }: { d: Dashboard; scope: Scope }) {
  const rows = attentionRows(d.attention_counts, scope);
  return (
    <ChartCard title="Needs attention" link={{ href: '/vendor-risk/attention', label: 'Queue' }}>
      {rows.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-8 text-[14px] font-medium" style={{ color: TONE.success.text }}>
          <Check aria-hidden className="h-4 w-4" strokeWidth={2.25} /> All clear
        </p>
      ) : (
        <ul>
          {rows.map((r) => {
            const Icon = TONE_ICON[r.tone];
            const c = TONE[r.tone];
            return (
              <li key={r.code}>
                <Link href={r.href} className={ROW_LINK}>
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: c.tint, color: c.text }}>
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </span>
                  <span className="text-[20px] font-semibold leading-6 tabular-nums" style={{ color: c.text }}>{r.count}</span>
                  <span className="min-w-0 truncate text-[13px] leading-5 text-[#586472]">{r.label}</span>
                  <ChevronRight aria-hidden className="ml-auto h-4 w-4 shrink-0 text-[#9aa5b1]" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}

export function TierCard({ d, scope }: { d: Dashboard; scope: Scope }) {
  const slices = tierSlices(d.tier_counts, scope);
  return (
    <ChartCard title="Portfolio by tier">
      <Donut slices={slices} centerValue={sum(slices)} centerLabel="Total" emptyText="No vendors yet." />
    </ChartCard>
  );
}

export function CoverageCard({ d, scope }: { d: Dashboard; scope: Scope }) {
  const c = coverageView(d.coverage);
  return (
    <ChartCard title="Assessment coverage" link={c.outside > 0 ? { href: registerHref({ attention: 'reassessment_overdue' }, scope), label: `${c.outside} outside ›` } : undefined}>
      {c.percent === null ? <p className={QUIET}>No critical or high vendors yet.</p> : <HalfGauge percent={c.percent} label="In window" caption={c.caption} />}
    </ChartCard>
  );
}

export function OpenFindingsCard({ d }: { d: Dashboard }) {
  const slices = severitySlices(d.findings_severity);
  return (
    <ChartCard title="Open findings" link={{ href: FINDINGS, label: 'View all' }}>
      {slices.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-8 text-[14px] font-medium" style={{ color: TONE.success.text }}>
          <Check aria-hidden className="h-4 w-4" strokeWidth={2.25} /> None open
        </p>
      ) : (
        <Donut slices={slices} centerValue={sum(slices)} centerLabel="Open" />
      )}
    </ChartCard>
  );
}

export function StatusCard({ d }: { d: Dashboard }) {
  const bars = statusBars(d.by_status);
  return (
    <ChartCard title="By status">
      {bars.length === 0 ? <p className={QUIET}>No vendors yet.</p> : (
        <ul className="space-y-3.5">
          {bars.map((b) => (
            <li key={b.key}>
              <div className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
                <span className="min-w-0 truncate text-[#26323d]">{b.label}</span>
                <span className="shrink-0 tabular-nums text-[#64707e]"><span className="font-semibold text-[#1f2933]">{b.count}</span> ({b.percent}%)</span>
              </div>
              <div aria-hidden className="mt-1 h-2 overflow-hidden rounded-full bg-[#eef1f4]">
                <div className="h-2 rounded-full" style={{ width: `${b.percent}%`, background: b.color }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function IntakeCard({ d }: { d: Dashboard }) {
  const rows = intakeRows(d.intake_pending?.items);
  return (
    <ChartCard title="Intake" link={{ href: '/vendor-risk/intake', label: 'View all' }}>
      {rows.length === 0 ? <p className={QUIET}>Nothing waiting.</p> : (
        <ul className="divide-y divide-[#eef1f4]">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/vendor-risk/intake/${r.id}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-[#f3f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold leading-5 text-[#1f2933]">{r.name}</span>
                  <span className="block truncate text-[12px] leading-4 text-[#64707e]">{r.byline}</span>
                </span>
                {r.duplicate && <StatusPill tone="warning" title="Another vendor has this name or website">Duplicate?</StatusPill>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

export function ResidualCard({ d }: { d: Dashboard }) {
  const rows = topResidual(d.top_residual_vendors);
  return (
    <ChartCard title="Highest residual risk" link={{ href: REGISTER, label: 'View register' }} className="lg:col-span-3">
      {rows.length === 0 ? <p className={QUIET}>No scored assessments yet.</p> : (
        <ul>
          {rows.map((v) => (
            <li key={v.id}>
              <Link href={`${REGISTER}/${v.id}`} className={`${ROW_LINK} flex-wrap gap-x-4 gap-y-1.5`}>
                <span className="min-w-[8rem] flex-1 truncate text-[14px] font-medium leading-5 text-[#1f2933]">{v.name}</span>
                <TierBadge tier={v.tier} />
                <span className="flex w-full items-center gap-2 sm:w-64">
                  <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef1f4]">
                    <span className="block h-2 rounded-full" style={{ width: `${barWidth(v.residual)}%`, background: TONE.danger.dot }} />
                  </span>
                  <span className="w-9 text-right text-[13px] font-semibold tabular-nums text-[#1f2933]">{v.residual ?? '—'}</span>
                </span>
                <GradePill grade={v.grade} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
