'use client';

/**
 * PerformanceView: who owns the evidence and how much of it is approved. From the by-owner figures the server sends: the top performer, the team's average approval
 * rate and the owner with the largest pending backlog, then a leaderboard ranked by approval rate (ties by volume). It is built and open from the address
 * (?view=performance); the switcher does not offer it. A failed request is an error with Retry (it used to be drawn as "will appear after the next backend
 * update", though the route exists); the two permanently empty columns ("On-time %", "Committee coverage": the server has no due dates to work them out from) are gone.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, PersonChip, RegisterTable, StatTile, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { EMPTY, formatCount } from '@/lib/format';
import { fetchByOwner } from './api';
import { approvedShare, ownerBoard, type OwnerPerf } from './evidenceModel';

type Row = OwnerPerf & { rank: number };
const MUTED = 'text-ds-fg-muted';
const count = (n: number) => (n > 0 ? <span className="tabular-nums">{formatCount(n)}</span> : <span className={MUTED}>{EMPTY}</span>);

export function PerformanceView() {
  const owners = useQuery({ queryKey: ['evidence', 'by-owner'], queryFn: fetchByOwner, staleTime: 60 * 1000, retry: (failures, e) => canRetry(e) && failures < 1, retryDelay: 800 });
  const board = useMemo(() => ownerBoard(owners.data ?? []), [owners.data]);

  const columns: RegisterColumn<Row>[] = [
    { key: 'rank', header: '#', width: 'w-[56px]', cell: (r) => <span className={`tabular-nums ${MUTED}`}>{r.rank}</span> },
    { key: 'owner', header: 'Owner', isRowHeader: true, cell: (r) => <PersonChip name={r.owner_name} /> },
    { key: 'total', header: 'Items', align: 'right', width: 'w-[96px]', card: 'meta', cell: (r) => <span className="tabular-nums">{formatCount(r.total)}</span> },
    { key: 'approved', header: 'Approved', align: 'right', width: 'w-[112px]', card: 'meta', cell: (r) => <StatusPill size="sm" tone="success" label={formatCount(r.approved)} /> },
    { key: 'rate', header: 'Approval rate', align: 'right', width: 'w-[128px]', card: 'meta', cell: (r) => <span className="tabular-nums">{approvedShare(r)}%</span> },
    { key: 'pending', header: 'Pending', align: 'right', width: 'w-[104px]', card: 'meta', cell: (r) => count(r.pending) },
    { key: 'expired', header: 'Expired', align: 'right', width: 'w-[104px]', card: 'meta', cell: (r) => count(r.expired) },
  ];

  if (owners.isError && !owners.data) {
    return <ErrorState title="Couldn't load the owner figures" message={errorMessage(owners.error)} onRetry={canRetry(owners.error) ? () => { void owners.refetch(); } : undefined} />;
  }
  if (!owners.isLoading && !board) {
    return <EmptyState kind="firstUse" title="No owner figures yet" description="They appear once evidence has been uploaded." />;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
        <StatTile label="Top performer" value={board ? (board.top.owner_name || 'Unassigned') : null} loading={owners.isLoading} tone="success" note={board ? `${approvedShare(board.top)}% approved · ${formatCount(board.top.total)} items` : undefined} />
        <StatTile label="Team average approval" value={board ? `${board.teamAvg}%` : null} loading={owners.isLoading} note={board ? `${formatCount(board.rows.length)} ${board.rows.length === 1 ? 'owner' : 'owners'} counted` : undefined} />
        <StatTile label="Needs support" value={board ? (board.needsSupport.owner_name || 'Unassigned') : null} loading={owners.isLoading} tone="warning" note={board ? `${formatCount(board.needsSupport.pending)} pending review` : undefined} />
      </div>
      <RegisterTable
        caption="Owner leaderboard, ranked by approval rate"
        columns={columns}
        rows={board?.rows ?? []}
        getRowId={(r) => String(r.owner_id ?? r.owner_name ?? `row-${r.rank}`)}
        loading={owners.isLoading}
        cardTitle={(r) => <span className="flex items-center gap-[8px]"><span className={`tabular-nums ${MUTED}`}>{r.rank}.</span><PersonChip name={r.owner_name} /></span>}
      />
    </div>
  );
}
