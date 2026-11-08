'use client';

/**
 * Task Management > My work: the front door, a worklist-first cockpit (the frame of components/overview, the same as the Governance and Risk overviews). A band of five counters, each a link
 * into All tasks that shows exactly the tasks it counts; "Do next", the person's open tasks most urgent first with ONE action on each row; "Your load" beside it; the latest ten tasks
 * they finished below. What a number or a row means is taskWork.ts (built on taskRecord.ts, the model All tasks shares); the requests are workData.ts (the person's own tasks, complete: the
 * server's own filters, three small requests answered together); a step asks the server and says what it did (useTaskStep).
 * A request that fails is said ONCE, with its Retry, where the cockpit would be (a refusal has no Retry): never as a row of zeros; a refresh that fails keeps what was shown and says it may be
 * out of date; a person whose account could not be read is told so (the old My Work stayed on a skeleton for ever). Needs my action is its own request and fails, loads and has nothing on its own.
 */
import { useMemo } from 'react';
import { RotateCw } from 'lucide-react';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { workOf } from '@/components/overview/workList';
import { Button, ErrorState, Notice, TitleLink } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate } from '@/lib/format';
import { BADGE_SOURCES } from '@/lib/inbox/buildInbox';
import { useInbox } from '@/lib/inbox/inboxApi';
import { canOpenMyWork } from '../../my-work/myWorkAccess';
import { LoadCard } from './LoadCard';
import { WorkCard } from './WorkCard';
import { countersOf, loadOf, orderWork, recentDone } from './taskWork';
import { useTaskStep } from './useTaskStep';
import { useMe, useMyWork } from './workData';

const NO_ID = new Error("We couldn't tell who you are, so your tasks can't be shown. Reload the page, or sign in again.");
const BAND = [['overdue', 'Overdue'], ['week', 'Due this week'], ['approve', 'To approve'], ['open', 'Open'], ['created', 'Created by me']] as const;

function RecentList({ rows }: { rows: ReturnType<typeof recentDone> }) {
  if (rows.length === 0) return <p className="m-0 text-ds-body text-ds-fg-muted">Nothing finished yet. The tasks you complete appear here.</p>;
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((t) => (
        <li key={t.id} className="flex min-h-[44px] flex-wrap items-center gap-x-[12px] gap-y-[2px] border-b border-ds-border py-[4px] last:border-b-0">
          <div className="min-w-0 flex-1"><TitleLink href={`/tasks/${t.id}`} title={t.title} lines={1} tone="title" size="body" /></div>
          <span className="shrink-0 text-ds-label text-ds-fg-muted">Completed {formatDate(t.completed_at)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MyWork() {
  const narrow = useNarrow();
  const { hasAnyPermission, isAdmin } = usePermissions();
  const me = useMe();
  const work = useMyWork(me.id);
  const step = useTaskStep();
  const { inbox, refetch: refetchInbox } = useInbox();
  const needs = workOf(inbox, BADGE_SOURCES);

  const rows = work.data?.rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [work.data]);
  const mine = me.id;
  const failed = me.failed || (work.isError && !work.data);
  const ready = !failed && !!rows && mine != null;
  const ordered = useMemo(() => (ready && rows ? orderWork(rows, mine, now) : []), [ready, rows, mine, now]);
  const mode = layoutOf({ refused: false, workCount: ready ? ordered.length : null });
  const limit = workRowLimit(mode, narrow);

  if (failed) {
    const error: unknown = me.failed ? NO_ID : work.error;
    return <ErrorState title="Couldn't load your tasks" message={errorMessage(error)} onRetry={canRetry(error) ? () => { if (me.failed) me.refetch(); else void work.refetch(); } : undefined} />;
  }

  const state = ready ? 'ready' : 'loading';
  const counters: BandCounter[] = ready && rows
    ? countersOf(rows, mine, now).map((c) => ({ key: c.key, label: c.label, href: c.href, tone: c.tone, state: 'ready' as const, value: c.value }))
    : BAND.map(([key, label]) => ({ key, label, href: '/tasks?tab=all', tone: 'neutral' as const, state: 'loading' as const }));
  const recent = ready && rows ? recentDone(rows, mine) : [];
  const breakdowns: Breakdown[] = ready
    ? [{ id: 'recent', title: 'Recently completed', info: 'The latest ten tasks you finished.', size: 'band', meta: recent.length > 0 ? `${recent.length} of your latest` : undefined, children: <RecentList rows={recent} /> }]
    : [];

  return (
    <>
      <SkipToWork />
      {work.isError && (
        <Notice tone="warning" title="Couldn't refresh your tasks" className="mb-[16px]" action={canRetry(work.error) ? <Button leftIcon={<RotateCw aria-hidden />} loading={work.isFetching} onClick={() => { void work.refetch(); }}>Retry</Button> : undefined}>
          {errorMessage(work.error)} What is shown may be out of date.
        </Notice>
      )}
      <Cockpit
        mode={mode}
        narrow={narrow}
        band={(
          <CounterBand
            id="attention"
            title="Your tasks"
            info="Each count opens the tasks it counts in All tasks. Your tasks are the ones you are on or review that are not finished, and the ones you made."
            counters={counters}
            narrow={narrow}
          />
        )}
        work={<WorkCard id="work" rows={rows ?? []} me={mine as number} now={now} state={state} limit={limit} truncated={!!work.data?.truncated} onStep={step.run} busyId={step.busyId} />}
        posture={(
          <LoadCard
            id="load" state={state} load={ready && rows ? loadOf(rows, mine, now) : null}
            needs={{ state: needs.state === 'loading' ? 'loading' : needs.state === 'unavailable' ? 'error' : 'ready', count: needs.counts.all, onRetry: () => refetchInbox() }}
            myWork={canOpenMyWork(isAdmin, hasAnyPermission)}
          />
        )}
        breakdowns={breakdowns}
      />
    </>
  );
}
