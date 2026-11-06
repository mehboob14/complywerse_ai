'use client';

// The Needs action lane of the Committees home: the open oversight actions of every committee (or the chosen one, or only the person's own), in three groups that
// each come from their own request, so each has its TRUE total: Overdue (the server's own test), Due this week, Later (everything after, and what has no due date).
// "Later" skips the rows the first two groups hold, so it waits for their totals. While a search is typed the lane reads one page of open actions and groups it here:
// the API has no text search, and the words under the lane say so when that page is not all of them. A tick marks an action completed (a reported mutation, with
// Retry); the whole list, paged and filtered, is Oversight Actions.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { Button, EmptyState, ErrorState, FilterChips, Skeleton } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount, truncate } from '@/lib/format';
import { listOf } from '@/lib/committees';
import {
  GROUP_LABEL, GROUP_MORE, GROUP_SHOWN, OPEN_STATUSES, SEARCH_ROWS, actionsListAddress, groupActions, groupQuery, laterTotal, matchesSearch, searchCut,
  type ActionGroup, type ActionScope,
} from '@/lib/committeeHome';
import { ActionRow, GroupHead, Lane, MoreButton, MoreRow, type LaneAction } from './LaneParts';

type Page = { total: number; items: LaneAction[] };
const GROUPS: ActionGroup[] = ['overdue', 'week', 'later'];

const normalise = (items: Array<Record<string, unknown>>): LaneAction[] =>
  items.map((item) => ({ ...item, assigned_to_name: (item.assigned_to_name as string) || (item.assignee_name as string) || '' })) as unknown as LaneAction[];

async function readGroup(group: ActionGroup, scope: ActionScope, limit: number, skip: number): Promise<Page> {
  const { items, total } = listOf<Record<string, unknown>>((await committeeApi.getActions(groupQuery(group, scope, new Date(), { limit, skip }))).data);
  return { total, items: normalise(items) };
}

export function ActionsLane({ scope, onMine, search, canTick, hiddenOnPhone }: {
  scope: ActionScope;
  /** the Mine chip was pressed (the page keeps it in the address) */
  onMine: () => void;
  /** the words typed in the search box (already settled) */
  search: string;
  /** may mark an action completed */
  canTick: boolean;
  hiddenOnPhone: boolean;
}) {
  const searching = search.trim().length > 0;
  const [expanded, setExpanded] = useState<Record<ActionGroup, boolean>>({ overdue: false, week: false, later: false });
  const limit = (g: ActionGroup) => (expanded[g] ? GROUP_MORE : GROUP_SHOWN[g]);
  const key = [scope.committeeId ?? 0, scope.mine] as const;

  const overdueQ = useQuery({ queryKey: ['committee-lane-actions', 'overdue', ...key, limit('overdue')], queryFn: () => readGroup('overdue', scope, limit('overdue'), 0), enabled: !searching, placeholderData: keepPreviousData });
  const weekQ = useQuery({ queryKey: ['committee-lane-actions', 'week', ...key, limit('week')], queryFn: () => readGroup('week', scope, limit('week'), 0), enabled: !searching, placeholderData: keepPreviousData });
  const skip = (overdueQ.data?.total ?? 0) + (weekQ.data?.total ?? 0);
  const laterQ = useQuery({
    queryKey: ['committee-lane-actions', 'later', ...key, limit('later'), skip],
    queryFn: () => readGroup('later', scope, limit('later'), skip),
    enabled: !searching && overdueQ.isSuccess && weekQ.isSuccess,
    placeholderData: keepPreviousData,
  });
  // a search: one page of open actions, grouped and filtered here
  const searchQ = useQuery({
    queryKey: ['committee-lane-actions', 'search', ...key, SEARCH_ROWS],
    queryFn: async () => {
      const { items, total } = listOf<Record<string, unknown>>((await committeeApi.getActions({ status: OPEN_STATUSES, limit: SEARCH_ROWS, ...(scope.committeeId ? { committee_id: scope.committeeId } : {}), ...(scope.mine ? { assigned_to: 'me' as const } : {}) })).data);
      return { total, items: normalise(items) } as Page;
    },
    enabled: searching,
    placeholderData: keepPreviousData,
  });

  const tick = useReportedMutation({
    mutationFn: (a: LaneAction) => committeeApi.updateAction(a.id, { status: 'completed' }),
    success: (_r, a) => ({ title: 'Marked completed', message: truncate(a.title, 80).text }),
    failure: "Couldn't mark the action completed",
    invalidate: [['committee-lane-actions'], ['committee-overview'], ['all-actions']],
  });
  const ticking = tick.isPending ? tick.variables?.id ?? null : null;

  // what each group shows and how many it has
  const found = searching ? groupActions((searchQ.data?.items ?? []).filter((a) => matchesSearch(a, search)), new Date()) : null;
  const groups: Record<ActionGroup, { rows: LaneAction[]; count: number | null }> = {
    overdue: found ? { rows: found.overdue, count: found.overdue.length } : { rows: overdueQ.data?.items ?? [], count: overdueQ.data?.total ?? null },
    week: found ? { rows: found.week, count: found.week.length } : { rows: weekQ.data?.items ?? [], count: weekQ.data?.total ?? null },
    later: found
      ? { rows: found.later, count: found.later.length }
      : { rows: laterQ.data?.items ?? [], count: laterQ.data && overdueQ.data && weekQ.data ? laterTotal(laterQ.data.total, overdueQ.data.total, weekQ.data.total) : null },
  };
  const all = searching ? searchQ.data : null;
  const total = found ? found.overdue.length + found.week.length + found.later.length
    : groups.overdue.count !== null && groups.week.count !== null && groups.later.count !== null ? groups.overdue.count + groups.week.count + groups.later.count : null;

  const queries = searching ? [searchQ] : [overdueQ, weekQ, laterQ];
  const failed = queries.find((q) => q.isError && !q.data);
  const waiting = total === null && !failed;                    // nothing to count yet (the later group waits for the other two)
  const empty = total === 0 && !failed;
  const showCommittee = !scope.committeeId;

  return (
    <Lane
      id="lane-actions"
      title="Needs action"
      count={total === null ? undefined : formatCount(total)}
      hiddenOnPhone={hiddenOnPhone}
      controls={(
        <>
          <FilterChips label="Actions shown" chips={[{ key: 'mine', label: 'Mine', active: scope.mine }]} onToggle={onMine} />
          <Button size="sm" href={actionsListAddress(scope)} title="Every action, paged and filtered">All</Button>
        </>
      )}
    >
      {failed ? (
        <ErrorState compact title="Couldn't load the actions" message={errorMessage(failed.error)} onRetry={() => { queries.forEach((q) => { void q.refetch(); }); }} />
      ) : waiting ? (
        <div className="space-y-[10px] p-[12px]" aria-busy="true"><Skeleton className="h-[40px]" /><Skeleton className="h-[40px]" /><Skeleton className="h-[40px]" /></div>
      ) : empty ? (
        <EmptyState
          kind={searching || scope.mine ? 'noMatches' : 'firstUse'}
          bare
          icon={CheckCircle2}
          title={searching ? 'No action matches' : scope.mine ? 'Nothing is assigned to you' : 'No open actions'}
          description={searching ? undefined : scope.mine ? 'No open action has you as its owner.' : 'Actions made in a meeting, or added by hand, show up here.'}
        />
      ) : (
        <div>
          {GROUPS.map((group) => {
            const g = groups[group];
            if (!g.count && g.rows.length === 0) return null;
            const shown = g.rows.slice(0, searching ? (expanded[group] ? g.rows.length : GROUP_SHOWN[group]) : g.rows.length);
            const more = (g.count ?? g.rows.length) - shown.length;
            return (
              <div key={group}>
                <GroupHead label={GROUP_LABEL[group]} count={g.count} tone={group === 'overdue' ? 'danger' : undefined} />
                <ul>
                  {shown.map((a) => (
                    <ActionRow key={a.id} a={a} showCommittee={showCommittee} canTick={canTick} ticking={ticking === a.id} onTick={(row) => tick.mutate(row)} />
                  ))}
                </ul>
                {(more > 0 || expanded[group]) && (
                  <MoreRow>
                    {(more > 0 || expanded[group]) && <MoreButton open={expanded[group]} more={more} noun="actions" onToggle={() => setExpanded((e) => ({ ...e, [group]: !e[group] }))} />}
                    {expanded[group] && (g.count ?? 0) > GROUP_MORE && !searching && (
                      <Button variant="link" size="sm" href={actionsListAddress(scope, group)}>{`All ${formatCount(g.count)} in the list`}</Button>
                    )}
                  </MoreRow>
                )}
              </div>
            );
          })}
          {all && searchCut(all.items.length, all.total) && (
            <p className="border-t border-ds-border px-[12px] py-[8px] text-ds-label font-normal text-ds-fg-muted">{searchCut(all.items.length, all.total)}</p>
          )}
        </div>
      )}
    </Lane>
  );
}
