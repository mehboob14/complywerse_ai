'use client';

/**
 * SnapshotView — L2 Board / Committee snapshot for the Evidence workspace.
 *
 * A minimalist, on-brand board readout composed from the summary payload and
 * the expiring-soon list. Ports the exact fragments the SME built on the
 * evidence library page (KPI-style tiles, "Coverage by type" mini-tile,
 * "Status split" segmented bar, and the TrendSparkline for 6-month
 * Added-vs-Approved) and frames them as a board snapshot: a headline approval
 * rate with a donut, action items, and an expiring-soon watchlist.
 *
 * Charter: single teal brand (primary-*), category tints only as status
 * markers, no gradients, hairline borders, dense.
 */

import {
  CheckCircle2,
  Clock,
  CalendarClock,
  Layers,
  FileText,
  TrendingUp,
  Users,
  Building2,
} from 'lucide-react';
import type { EvidenceItem, EvidenceSummary } from './lib';
import { ExpiryStatus, EvidenceLetterTile } from './lib';

export interface SnapshotViewProps {
  summary?: EvidenceSummary;
  expiringSoon: EvidenceItem[];
}

// ─── local helpers ───────────────────────────────────────────────────────────
function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short' });
}

// Section label — matches the charter's uppercase muted label spec.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>
  );
}

export function SnapshotView({ summary, expiringSoon }: SnapshotViewProps) {
  const total = summary?.total_count ?? 0;
  const byStatus = summary?.by_status ?? {};
  const byType = summary?.by_type ?? {};
  const trend = summary?.by_month ?? [];

  const approvedCount = byStatus.approved ?? 0;
  const pendingCount = byStatus.pending_review ?? summary?.pending_review_count ?? 0;
  const draftCount = byStatus.draft ?? 0;
  const expiredCount = byStatus.expired ?? 0;
  const rejectedCount = byStatus.rejected ?? 0;

  const approvalRate = total > 0 ? Math.round((approvedCount / total) * 100) : null;

  // Approval-rate delta: first vs last month's approved from by_month (if present).
  const approvalDelta =
    trend.length >= 2 ? (trend[trend.length - 1].approved - trend[0].approved) : null;

  // Action items.
  const approvedThisQuarter = trend.reduce((s, m) => s + (m.approved ?? 0), 0);
  const overdueExpiring = summary?.expiring_soon_count ?? 0;

  // ── Donut of by_status (Approved/Pending/Draft/Expired/Rejected) ──
  const donutSegments = [
    { key: 'approved', label: 'Approved', count: approvedCount, color: '#1ed4b0' },
    { key: 'pending', label: 'Pending', count: pendingCount, color: '#f59e0b' },
    { key: 'draft', label: 'Draft', count: draftCount, color: '#cbd5e1' },
    { key: 'expired', label: 'Expired', count: expiredCount, color: '#fb923c' },
    { key: 'rejected', label: 'Rejected', count: rejectedCount, color: '#f43f5e' },
  ];
  const donutTotal = donutSegments.reduce((s, seg) => s + seg.count, 0);

  // Build stroke-dasharray arcs on a single circle (r = 42, C = 2πr ≈ 263.9).
  const R = 42;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = donutSegments
    .filter((seg) => seg.count > 0)
    .map((seg) => {
      const frac = donutTotal > 0 ? seg.count / donutTotal : 0;
      const len = frac * C;
      const arc = { ...seg, dash: `${len} ${C - len}`, offset: -acc };
      acc += len;
      return arc;
    });

  // ── Status split segmented bar (ported fragment) ──
  const statusSegments: Array<{ key: string; label: string; count: number; tint: string }> = [
    { key: 'draft', label: 'Draft', count: draftCount, tint: 'bg-slate-300' },
    { key: 'pending_review', label: 'Pending', count: pendingCount, tint: 'bg-amber-400' },
    { key: 'approved', label: 'Approved', count: approvedCount, tint: 'bg-emerald-500' },
    { key: 'rejected', label: 'Rejected', count: rejectedCount, tint: 'bg-rose-400' },
    { key: 'expired', label: 'Expired', count: expiredCount, tint: 'bg-orange-400' },
  ];
  const statusTotal = statusSegments.reduce((s, seg) => s + seg.count, 0);

  // ── Coverage by type mini-tile (ported fragment) — top 5 ──
  const topTypes = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topTypeMax = topTypes.length ? Math.max(...topTypes.map(([, n]) => n)) : 0;

  const watchlist = (expiringSoon ?? []).slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Row 1 — headline approval rate + donut, and the trend sparkline. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Approval rate + donut */}
        <div className="card p-4 lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionLabel>Approval rate</SectionLabel>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight text-slate-900">
                  {approvalRate === null ? '–' : `${approvalRate}%`}
                </span>
                {approvalDelta !== null && approvalDelta !== 0 && (
                  <span
                    className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                      approvalDelta > 0 ? 'text-emerald-700' : 'text-rose-600'
                    }`}
                  >
                    <TrendingUp
                      className={`h-3.5 w-3.5 ${approvalDelta > 0 ? '' : 'rotate-180'}`}
                      strokeWidth={1.75}
                    />
                    {approvalDelta > 0 ? '+' : ''}
                    {approvalDelta}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {approvedCount} of {total} evidence items approved
              </p>
            </div>

            {/* Donut */}
            <div className="flex items-center gap-4">
              <div className="relative h-28 w-28 shrink-0">
                <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
                  <circle cx="50" cy="50" r={R} fill="none" stroke="#f1f5f9" strokeWidth={10} />
                  {arcs.map((arc) => (
                    <circle
                      key={arc.key}
                      cx="50"
                      cy="50"
                      r={R}
                      fill="none"
                      stroke={arc.color}
                      strokeWidth={10}
                      strokeDasharray={arc.dash}
                      strokeDashoffset={arc.offset}
                      strokeLinecap="butt"
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-lg font-semibold text-slate-900">
                    {approvalRate === null ? '–' : `${approvalRate}%`}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">approved</span>
                </div>
              </div>

              {/* Legend */}
              <div className="space-y-1">
                {donutSegments.map((seg) => (
                  <div key={seg.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="w-16 truncate">{seg.label}</span>
                    <span className="font-semibold text-slate-800">{seg.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 6-month trend — ported TrendSparkline; renders only with by_month */}
        {trend.length > 0 ? (
          <TrendSparkline data={trend} formatMonth={formatMonth} />
        ) : (
          <div className="card flex flex-col justify-center p-4">
            <SectionLabel>Added vs approved · 6 mo</SectionLabel>
            <p className="mt-2 text-xs text-slate-400">Trend available after the next backend update.</p>
          </div>
        )}
      </div>

      {/* Row 2 — action items (3 stat tiles). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ActionTile
          icon={CheckCircle2}
          tint="bg-emerald-50 text-emerald-600"
          value={approvedThisQuarter}
          label="Approved this quarter"
          hint={trend.length > 0 ? undefined : 'Awaiting trend data'}
        />
        <ActionTile
          icon={Clock}
          tint="bg-amber-50 text-amber-600"
          value={pendingCount}
          label="Pending review"
        />
        <ActionTile
          icon={CalendarClock}
          tint="bg-orange-50 text-orange-600"
          value={overdueExpiring}
          label="Expiring soon"
        />
      </div>

      {/* Row 3 — expiring watchlist + coverage by type. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Expiring soon watchlist */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <SectionLabel>Expiring soon</SectionLabel>
            <span className="text-xs text-slate-400">{overdueExpiring} total</span>
          </div>
          {watchlist.length === 0 ? (
            <p className="py-2 text-xs text-slate-400">Nothing expiring in the near term.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {watchlist.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-2">
                  <EvidenceLetterTile name={item.name} evidenceType={item.evidence_type} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{item.name}</span>
                  <ExpiryStatus expiry={item.expiry_date} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Coverage by type — ported mini-tile */}
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex rounded-lg bg-primary-50 p-1.5 text-primary-600">
              <Layers className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <SectionLabel>Coverage by type</SectionLabel>
          </div>
          {topTypes.length === 0 ? (
            <p className="py-2 text-xs text-slate-400">No evidence yet.</p>
          ) : (
            <div className="space-y-2">
              {topTypes.map(([type, count]) => (
                <div key={type} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-xs capitalize text-slate-700">
                    {type.replace(/_/g, ' ')}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary-500"
                      style={{ width: `${topTypeMax > 0 ? Math.round((count / topTypeMax) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-xs font-medium text-slate-800">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 4 — status split segmented bar (ported fragment) full width. */}
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex rounded-lg bg-primary-50 p-1.5 text-primary-600">
            <FileText className="h-4 w-4" strokeWidth={1.75} />
          </span>
          <SectionLabel>Status split</SectionLabel>
        </div>
        {statusTotal === 0 ? (
          <p className="py-2 text-xs text-slate-400">No evidence yet.</p>
        ) : (
          <>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              {statusSegments
                .filter((seg) => seg.count > 0)
                .map((seg) => (
                  <div
                    key={seg.key}
                    className={`h-full ${seg.tint}`}
                    style={{ width: `${(seg.count / statusTotal) * 100}%` }}
                    title={`${seg.label}: ${seg.count}`}
                  />
                ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {statusSegments.map((seg) => (
                <span key={seg.key} className="inline-flex items-center gap-1 text-xs text-slate-600">
                  <span className={`h-2 w-2 rounded-full ${seg.tint}`} />
                  {seg.label} {seg.count}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Row 5 — placeholder cards, clearly labeled, no fake data. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PlaceholderCard
          icon={Users}
          label="Top performers"
          note="Available after the next backend update."
        />
        <PlaceholderCard
          icon={Building2}
          label="Coverage by committee"
          note="Available after the next backend update."
        />
      </div>
    </div>
  );
}

// ─── Action stat tile ────────────────────────────────────────────────────────
function ActionTile({
  icon: Icon,
  tint,
  value,
  label,
  hint,
}: {
  icon: typeof CheckCircle2;
  tint: string;
  value: number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="card p-4">
      <div className={`mb-2 inline-flex rounded-lg p-2 ${tint}`}>
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <p className="text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

// ─── Placeholder card (labeled, not fake data) ───────────────────────────────
function PlaceholderCard({
  icon: Icon,
  label,
  note,
}: {
  icon: typeof Users;
  label: string;
  note: string;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex rounded-lg bg-slate-100 p-1.5 text-slate-400">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <SectionLabel>{label}</SectionLabel>
      </div>
      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-200">
        <p className="text-xs text-slate-400">{note}</p>
      </div>
    </div>
  );
}

// ─── Ported TrendSparkline (verbatim from evidence/page.tsx, `card` shell) ────
// Compact two-line SVG sparkline for the "Added vs Approved" 6-month trend.
// Pure inline SVG (no chart lib): uploaded in brand teal, approved in muted
// slate. Thin strokes, no fill, no gradient — on-brand per the design charter.
function TrendSparkline({
  data,
  formatMonth,
}: {
  data: Array<{ month: string; uploaded: number; approved: number }>;
  formatMonth: (ym: string) => string;
}) {
  const W = 260;
  const H = 72;
  const padX = 6;
  const padY = 8;
  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.uploaded, d.approved)));
  const stepX = data.length > 1 ? (W - padX * 2) / (data.length - 1) : 0;
  const pointsFor = (key: 'uploaded' | 'approved') =>
    data
      .map((d, i) => {
        const x = padX + i * stepX;
        const y = padY + (1 - d[key] / maxVal) * (H - padY * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-800">Added vs Approved · last 6 months</p>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs text-slate-600">
            <span className="h-0.5 w-3 rounded-full bg-primary-500" />
            Added
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-slate-600">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: '#64748b' }} />
            Approved
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[72px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Evidence added versus approved over the last six months"
      >
        <polyline
          points={pointsFor('uploaded')}
          fill="none"
          stroke="#1ed4b0"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={pointsFor('approved')}
          fill="none"
          stroke="#64748b"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between">
        {data.map((d) => (
          <span key={d.month} className="text-[10px] text-slate-500">
            {formatMonth(d.month)}
          </span>
        ))}
      </div>
    </div>
  );
}
