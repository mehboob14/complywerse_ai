'use client';

/**
 * Remediation: the clock of this assessment's gaps and the open gaps by due date. The headline numbers are the server's (the ones the board and the Performance Overview show);
 * the due-soon count and the ageing bar follow the server's own due-date rule (clockModel.ts). Nothing here is a made-up zero: a board that does not count the assessment says
 * so, and a failed read says what failed with Retry.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';
import { EmptyState, ErrorState, Notice, PersonStack, RegisterTable, SectionCard, StatTile, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatDate, EMPTY } from '@/lib/format';
import { statusPill, TONE, priority as priorityWords } from '@/lib/status';
import { controlStatus } from '@/lib/statuses/assessments';
import { barShares, remediationClock } from './clockModel';
import { DEFAULT_SLA_DAYS, dueMs, isOpenGap, sortItems, type SlaDays, type WorkItem } from './itemModel';
import { KEYS, workspaceApi } from './workspaceApi';
import type { OverviewEntry } from './types';

/** The tenant's SLA days (a read of its own); until it answers, or if it fails, the defaults the server uses when a tenant set none. */
export function useSlaDays(): { days: SlaDays; failed: boolean } {
  const q = useQuery({ queryKey: KEYS.policy, queryFn: workspaceApi.slaPolicy, staleTime: 60_000, retry: 1 });
  const d = q.data;
  const days = useMemo<SlaDays>(() => (d ? {
    critical_days: d.critical_days ?? DEFAULT_SLA_DAYS.critical_days, high_days: d.high_days ?? DEFAULT_SLA_DAYS.high_days, medium_days: d.medium_days ?? DEFAULT_SLA_DAYS.medium_days,
    low_days: d.low_days ?? DEFAULT_SLA_DAYS.low_days, due_soon_days: d.due_soon_days ?? DEFAULT_SLA_DAYS.due_soon_days,
  } : DEFAULT_SLA_DAYS), [d]);
  return { days, failed: q.isError };
}

export function RemediationTab({ items, days, entry, score }: {
  items: readonly WorkItem[];
  days: SlaDays;
  /** this assessment's entry in the board's answer; null when the board does not count it */
  entry: OverviewEntry | null;
  score: { loading: boolean; error: unknown; retry: () => void };
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const clock = useMemo(() => remediationClock(items, days, Date.now(), entry?.sla_counts ?? null, entry?.sla_metrics ?? []), [items, days, entry]);
  const open = useMemo(() => sortItems(items.filter(isOpenGap), { key: 'due', dir: 'asc' }, days), [items, days]);
  const shares = barShares(clock.aging);
  const counted = !!entry && clock.gaps !== null;
  const local = !counted;                                             // the board does not score this assessment: the numbers come from its controls
  const num = (server: number | null, own: number): string => formatCount(server ?? own);
  const errored = score.error ? { title: "Couldn't load the counts", message: errorMessage(score.error), onRetry: canRetry(score.error) ? score.retry : undefined } : null;

  const columns: Array<RegisterColumn<WorkItem>> = [
    {
      key: 'control', header: 'Control', isRowHeader: true, width: 'w-[42%]',
      cell: (it) => (<span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{it.number || EMPTY}</span><span className="line-clamp-2 break-words text-ds-body text-ds-fg">{it.description}</span></span>),
    },
    { key: 'status', header: 'Answer', card: 'meta', cell: (it) => <StatusPill {...statusPill(controlStatus, it.status)} size="sm" /> },
    { key: 'priority', header: 'Priority', priority: 2, card: 'meta', cell: (it) => (it.priority ? <StatusPill {...statusPill(priorityWords, it.priority)} size="sm" /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>) },
    { key: 'owner', header: 'Assigned to', priority: 2, card: 'meta', cell: (it) => <PersonStack people={it.assignees.map((x) => x.name)} max={2} label="Assigned to" emptyLabel={it.responsible || 'Unassigned'} /> },
    {
      key: 'due', header: 'Due', card: 'meta',
      cell: (it) => {
        const due = dueMs(it, days);
        if (due === null) return <span className="text-ds-body text-ds-fg-muted">No date</span>;
        const late = due < Date.now();
        return <span className={`text-ds-body ${late ? 'font-[600] text-ds-danger' : 'text-ds-fg-body'}`}>{formatDate(due, { calendar: true })}{late ? ' · overdue' : ''}</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="clock" title="Remediation clock" meta={clock.closedOnTime ? `${formatCount(clock.closedOnTime.done)} of ${formatCount(clock.closedOnTime.of)} closed on time` : undefined}
        info="Gaps are the controls that are not complied with or that have a fix under way. A gap is due on its own date, or when its priority allows from the day it was raised; the days are your organization's SLA days.">
        {local && !score.loading && !errored && (
          <div className="mb-[12px]"><Notice tone="info" title="Counted from the controls">The board does not score this assessment, so these numbers are counted from its controls: a gap is a control that is not complied with or has a fix recorded.</Notice></div>
        )}
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
          <StatTile label="Open gaps" value={num(clock.open, clock.local.open)} loading={score.loading} error={errored} unit={(clock.open ?? clock.local.open) === 1 ? 'gap' : 'gaps'} note={`${formatCount(clock.gaps ?? clock.local.gaps)} in all`} />
          <StatTile label="Overdue" value={num(clock.overdue, clock.local.overdue)} loading={score.loading} error={errored} tone={(clock.overdue ?? clock.local.overdue) ? 'danger' : 'default'} unit="gaps" />
          <StatTile label="Due soon" value={formatCount(clock.dueSoon)} unit="gaps" note={`within ${formatCount(clock.dueSoonDays)} days`} />
          <StatTile label="Closed" value={num(clock.closed, clock.local.closed)} loading={score.loading} error={errored} tone={(clock.closed ?? clock.local.closed) ? 'success' : 'default'} unit="gaps" />
        </div>
        <div className="mt-[16px]">
          <p className="mb-[6px] text-ds-label text-ds-fg-muted">Open gaps by due date</p>
          {clock.agingTotal === 0 ? (
            <p className="text-ds-body text-ds-fg-muted">{items.length ? 'No open gaps.' : 'Nothing to track yet.'}</p>
          ) : (
            <>
              <div role="img" aria-label={clock.aging.filter((b) => b.count).map((b) => `${b.count} ${b.label.toLowerCase()}`).join(', ')} className="flex h-[12px] w-full overflow-hidden rounded-full bg-ds-border">
                {clock.aging.map((b, i) => (shares[i] ? <span key={b.key} style={{ width: `${shares[i]}%`, background: TONE[b.tone].dot }} /> : null))}
              </div>
              <ul className="mt-[8px] flex flex-wrap gap-x-[16px] gap-y-[4px]">
                {clock.aging.filter((b) => b.count > 0).map((b) => (
                  <li key={b.key} className="flex items-center gap-[6px] text-ds-label text-ds-fg-body"><span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: TONE[b.tone].dot }} />{b.label} <span className="font-[600] tabular-nums text-ds-fg">{formatCount(b.count)}</span></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </SectionCard>
      <SectionCard id="gaps" title="Open gaps" meta={`${formatCount(open.length)} ${open.length === 1 ? 'gap' : 'gaps'}, soonest first`}>
        {score.error && !items.length ? (
          <ErrorState title="Couldn't load the gaps" message={errorMessage(score.error)} onRetry={score.retry} />
        ) : open.length === 0 ? (
          <EmptyState kind="firstUse" bare icon={Clock} title="No open gaps" description="Every gap is closed, or nothing is recorded as one." />
        ) : (
          <RegisterTable
            caption="Open gaps by due date" columns={columns} rows={open} getRowId={(r) => r.id}
            onRowActivate={(r) => router.push(`${pathname}?tab=controls&item=${r.id}`)}
            cardTitle={(r) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{r.number || EMPTY}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{r.description}</span></span>}
          />
        )}
      </SectionCard>
    </div>
  );
}
