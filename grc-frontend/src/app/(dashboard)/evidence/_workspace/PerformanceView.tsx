'use client';

/**
 * L5 — Performance & Accountability. Gap-tolerant owner analytics.
 *
 * Owner performance comes from the additive `/dashboard/by-owner` endpoint
 * (fetchByOwner → OwnerPerf[]), which returns [] on 404 until the backend
 * ships it. When empty we render a graceful placeholder rather than
 * fabricating leaderboard data. On-time % and committee coverage have no
 * backing data yet, so they render as muted "—" with a "not yet tracked" note.
 *
 * Charter: single teal brand, category tints only as markers, no gradients,
 * hairline borders, dense.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type ColumnDef } from '@/components/ui';
import { InitialsAvatar } from './lib';
import type { EvidenceSummary } from './lib';
import { fetchByOwner, type OwnerPerf } from './api';

export interface PerformanceViewProps {
  summary?: EvidenceSummary;
}

/** DataTable requires rows carry an `id`; OwnerPerf keys on owner_id. */
type OwnerRow = OwnerPerf & { id: string | number; rank: number };

function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

// Small summary card — value + label + optional sublabel.
function StatCard({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'emerald' | 'amber' | 'slate';
}) {
  const toneText: Record<string, string> = {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    slate: 'text-slate-900',
  };
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1.5 text-lg font-semibold ${toneText[tone]}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

// muted placeholder cell used for the two not-yet-tracked columns
function NotTrackedCell() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-300">
      —
      <span className="text-[10px] font-medium text-slate-400">not yet tracked</span>
    </span>
  );
}

export function PerformanceView({ summary }: PerformanceViewProps) {
  void summary;

  const { data, isLoading } = useQuery({
    queryKey: ['evidence', 'by-owner'],
    queryFn: fetchByOwner,
    staleTime: 60 * 1000,
  });

  const owners = useMemo<OwnerPerf[]>(() => data ?? [], [data]);

  const derived = useMemo(() => {
    if (!owners.length) return null;
    // Leaderboard: highest approval rate first (ties broken by volume).
    const ranked = [...owners].sort((a, b) => {
      const ra = pct(a.approved, a.total);
      const rb = pct(b.approved, b.total);
      if (rb !== ra) return rb - ra;
      return b.total - a.total;
    });
    const rows: OwnerRow[] = ranked.map((o, i) => ({
      ...o,
      id: o.owner_id ?? o.owner_name ?? `row-${i}`,
      rank: i + 1,
    }));
    const top = ranked[0];
    // Needs support: highest pending backlog.
    const needsSupport = [...owners].sort((a, b) => b.pending - a.pending)[0];
    const totalItems = owners.reduce((s, o) => s + o.total, 0);
    const totalApproved = owners.reduce((s, o) => s + o.approved, 0);
    const teamAvg = pct(totalApproved, totalItems);
    return { rows, top, needsSupport, teamAvg };
  }, [owners]);

  const columns = useMemo<ColumnDef<OwnerRow>[]>(
    () => [
      {
        id: 'rank',
        header: '#',
        width: '48px',
        render: (row) => <span className="text-sm font-semibold text-slate-400">{row.rank}</span>,
      },
      {
        id: 'owner',
        header: 'Owner',
        accessor: (row) => row.owner_name ?? '',
        sortable: true,
        render: (row) => (
          <span className="inline-flex items-center gap-2 text-sm text-slate-700">
            <InitialsAvatar name={row.owner_name} />
            <span className="truncate">
              {row.owner_name || <span className="text-slate-400">Unassigned</span>}
            </span>
          </span>
        ),
      },
      {
        id: 'total',
        header: 'Items',
        accessor: (row) => row.total,
        sortable: true,
        render: (row) => <span className="text-sm font-medium text-slate-900">{row.total}</span>,
      },
      {
        id: 'approved',
        header: 'Approved',
        accessor: (row) => row.approved,
        sortable: true,
        render: (row) => (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {row.approved}
          </span>
        ),
      },
      {
        id: 'pending',
        header: 'Pending',
        accessor: (row) => row.pending,
        sortable: true,
        render: (row) =>
          row.pending > 0 ? (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              {row.pending}
            </span>
          ) : (
            <span className="text-sm text-slate-400">0</span>
          ),
      },
      {
        id: 'expired',
        header: 'Expired',
        accessor: (row) => row.expired,
        sortable: true,
        render: (row) =>
          row.expired > 0 ? (
            <span className="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
              {row.expired}
            </span>
          ) : (
            <span className="text-sm text-slate-400">0</span>
          ),
      },
      {
        id: 'ontime',
        header: 'On-time %',
        render: () => <NotTrackedCell />,
      },
      {
        id: 'coverage',
        header: 'Committee coverage',
        render: () => <NotTrackedCell />,
      },
    ],
    [],
  );

  // ── Empty / not-yet-live: graceful placeholder (no fabricated data) ──
  if (!isLoading && !owners.length) {
    return (
      <div className="card p-8 text-center">
        <h3 className="text-base font-semibold text-slate-900">Performance analytics</h3>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">
          Owner leaderboard and committee coverage will appear here after the next backend update.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {derived && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Top performer"
            value={derived.top.owner_name || 'Unassigned'}
            sub={`${pct(derived.top.approved, derived.top.total)}% approved · ${derived.top.total} items`}
            tone="emerald"
          />
          <StatCard
            label="Team avg approval"
            value={`${derived.teamAvg}%`}
            sub={`${owners.length} owner${owners.length === 1 ? '' : 's'} tracked`}
            tone="slate"
          />
          <StatCard
            label="Needs support"
            value={derived.needsSupport.owner_name || 'Unassigned'}
            sub={`${derived.needsSupport.pending} pending review`}
            tone="amber"
          />
        </div>
      )}

      {/* Owner leaderboard */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Owner leaderboard
          </h3>
          <p className="text-xs text-slate-400">Ranked by approval rate</p>
        </div>
        <DataTable
          columns={columns}
          data={derived?.rows ?? []}
          loading={isLoading}
          emptyMessage="No owner performance data"
        />
      </div>
    </div>
  );
}
