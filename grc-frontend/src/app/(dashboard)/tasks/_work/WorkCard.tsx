'use client';

// "Do next": the person's open tasks, most urgent first, ONE action on every row (the kit's WorkRow): Start, Send for review, Complete, Verify, Request approval, Approve, or a document
// request's own step. The order and the words of a row are taskWork.ts; this file draws them and says what each state is: a skeleton while the tasks load, the server's words with a Retry when
// they could not be read (never "nothing to do" over a failure), the first task, all caught up, and "only part is loaded" when the answer was cut. The title opens the task; a status step
// asks the server and says what it did (useTaskStep).
import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Notice, SectionCard, SkeletonRows, TitleLink, WorkRow } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { isOverdue, type NextStep, type RegisterTask } from '../taskRecord';
import { tasksHref } from '../taskTabs';
import { emptyKind, orderWork, rowOf } from './taskWork';

export interface WorkCardProps {
  id: string;
  rows: readonly RegisterTask[];
  me: number;
  now: Date;
  state: 'loading' | 'ready';
  /** how many rows before "Show more" */
  limit: number;
  /** only part of the person's tasks could be loaded */
  truncated: boolean;
  onStep: (task: RegisterTask, step: NextStep) => void;
  /** the task whose step is being saved */
  busyId: number | null;
}

export function WorkCard({ id, rows, me, now, state, limit, truncated, onStep, busyId }: WorkCardProps) {
  const [extra, setExtra] = useState(0);
  const ordered = state === 'ready' ? orderWork(rows, me, now) : [];
  const shown = limit + extra;
  const late = ordered.filter((t) => isOverdue(t, now)).length;
  const empty = state === 'ready' ? emptyKind(rows, me) : null;
  const byId = new Map(rows.map((t) => [t.id, t]));

  return (
    <SectionCard
      id={id}
      title="Do next"
      info="Your open tasks, the most urgent first: what is late, then what waits for your decision, then by due date. Every row has the one step you do next."
      meta={state === 'ready' && ordered.length > 0 ? <>{`${formatCount(ordered.length)} ${ordered.length === 1 ? 'task' : 'tasks'}`}{late > 0 && <> · <span className="font-[600] text-ds-danger">{`${formatCount(late)} overdue`}</span></>}</> : undefined}
    >
      {state === 'loading' && <SkeletonRows rows={Math.min(limit, 5)} columns={3} label="Loading your tasks" />}
      {state === 'ready' && truncated && (
        <Notice tone="info" title="Only part of your tasks is loaded" className="mb-[8px]">The first {formatCount(rows.length)} are here. Open All tasks and filter to find the rest.</Notice>
      )}
      {empty === 'none' && (
        <p className="m-0 px-[4px] py-[8px] text-ds-body text-ds-fg-muted">Nothing is assigned to you yet. Tasks you own, are assigned to or review appear here.</p>
      )}
      {empty === 'caught-up' && (
        <p className="m-0 flex items-center gap-[8px] px-[4px] py-[8px] text-ds-body text-ds-fg-muted">
          <CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />
          You&apos;re all caught up. New tasks and decisions asked of you appear here.
        </p>
      )}
      {state === 'ready' && ordered.length > 0 && (
        <>
          <ul aria-label="Do next" className="m-0 list-none p-0">
            {ordered.slice(0, shown).map((t) => {
              const r = rowOf(t, me, now);
              const task = byId.get(r.id) as RegisterTask;
              return (
                <WorkRow
                  key={r.id}
                  kind={r.kind}
                  title={r.title}
                  href={r.href}
                  context={r.context || undefined}
                  requester={r.requester}
                  due={r.due}
                  calendar
                  overdue={r.overdue}
                  action={r.action ? (r.action.href ? { label: r.action.label, href: r.action.href } : { label: r.action.label, loading: busyId === r.id, onClick: () => onStep(task, r.action?.step as NextStep) }) : undefined}
                />
              );
            })}
          </ul>
          <div className="mt-[4px] flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px] border-t border-ds-border px-[8px] pt-[8px] text-ds-label text-ds-fg-muted">
            <span role="status">{ordered.length > shown ? `Showing ${formatCount(shown)} of ${formatCount(ordered.length)}` : `${formatCount(ordered.length)} ${ordered.length === 1 ? 'task' : 'tasks'}`}</span>
            <span className="flex flex-wrap items-center gap-x-[12px]">
              {ordered.length > shown && <Button variant="link" size="sm" onClick={() => setExtra((n) => n + 25)}>Show 25 more</Button>}
              <TitleLink href={tasksHref('all', { quick: 'mine' })} title="See all in All tasks" lines={1} tone="text" size="label" />
            </span>
          </div>
        </>
      )}
    </SectionCard>
  );
}
