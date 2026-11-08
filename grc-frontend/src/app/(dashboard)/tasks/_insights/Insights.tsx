'use client';

// Task Management > Reports, the INSIGHTS tab: the numbers of the tasks the person may see (an administrator or View all sees every task, everyone else the tasks they take part in) and what to
// open from each of them. Every number is a link into All tasks that shows exactly the tasks it counts; a row of a breakdown is a filter; the trend keeps its numbers in a table; the AI helpers open
// in a sheet. "Include document requests" (on: today's numbers) leaves the tasks a document review or acknowledgement raised out of every figure and every link when it is off, and is kept in the
// address (?documents=off). The numbers are worked out from the lean list the All tasks register loads (insightsModel.ts: the server's own formulas, each its own tested function) so they are the
// register's counts; where each one opens is insightsLinks.ts. A load that fails is an error with the server's words and Retry, never a row of zeros; a load cut at the ceiling is said.
import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { RotateCw } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Checkbox, EmptyState, ErrorState, Notice, SectionCard, SkeletonRows, StatTile, linkClasses, useAddressState, type ProgressTone } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount, formatPercent } from '@/lib/format';
import { taskPriority, taskStatus } from '@/lib/statuses/tasks';
import { useLeanTasks } from '../_register/taskData';
import { AiHelpers } from './AiSheets';
import { DrillBars, type DrillRow } from './DrillBars';
import { INSIGHTS_SCHEMA, linksOf } from './insightsLinks';
import { countedRows, documentCount, insightsOf, type CountRow } from './insightsModel';
import { Trend } from './Trend';

const TONES: Record<string, ProgressTone> = { success: 'success', danger: 'danger', warning: 'warning' };
const toneOf = (registry: { tone: (word: string) => string }) => (word: string): ProgressTone => TONES[registry.tone(word)] ?? 'primary';
const rowsOf = (rows: readonly CountRow[], href: (key: string) => string | null, tone?: (key: string) => ProgressTone): DrillRow[] =>
  rows.map((r) => ({ key: r.key, label: r.label, count: r.count, percent: r.percent, href: href(r.key), tone: tone?.(r.key) }));

const scopeWords = (scope: 'all' | 'mine' | undefined, includeDocuments: boolean): string =>
  `${scope === 'mine' ? 'Counts of your tasks: the ones you own, are assigned to, review or created.' : 'Counts of every task in the organization.'}${includeDocuments ? '' : ' Document requests are left out.'}`;

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** A tile's way into All tasks: a link under the figure that says where it goes (the tile is a box, its link a control of its own). No address (nothing to show), no link. */
function ToTasks({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  return href ? <Link href={href} aria-label={label} className={linkClasses({ tone: 'text', size: 'label' })}>{children}</Link> : <>{children}</>;
}

export function Insights() {
  const q = useLeanTasks();
  const [address, setAddress] = useAddressState(INSIGHTS_SCHEMA);
  const includeDocuments = address.documents === 'on';
  const loaded = q.data?.items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [q.data]);
  const counted = useMemo(() => countedRows(loaded ?? [], includeDocuments), [loaded, includeDocuments]);
  const data = useMemo(() => insightsOf(counted, now), [counted, now]);
  const links = useMemo(() => linksOf(counted, includeDocuments), [counted, includeDocuments]);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-[16px]" role="status" aria-label="Loading the task reports">
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-5">{['Total tasks', 'Overdue', 'Completion', 'SLA compliance', 'Active'].map((label) => <StatTile key={label} label={label} value={null} loading />)}</div>
        <SkeletonRows rows={5} columns={3} />
      </div>
    );
  }
  if (q.isError && !loaded) return <ErrorState title="Couldn't load the task reports" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  if (!loaded || loaded.length === 0) return <EmptyState kind="firstUse" title="No tasks yet" info="The numbers fill in as tasks are created." />;

  const documents = documentCount(loaded);
  const cut = !!q.data?.truncated;
  const total = formatCount(data.total);

  return (
    <div className="flex flex-col gap-[16px]">
      {q.isError && (
        <Notice tone="warning" title="Couldn't refresh the task reports" action={canRetry(q.error) ? <Button leftIcon={<RotateCw aria-hidden />} loading={q.isFetching} onClick={() => { void q.refetch(); }}>Retry</Button> : undefined}>
          {errorMessage(q.error)} What is shown may be out of date.
        </Notice>
      )}
      {cut && <Notice tone="info" title="Only part of the tasks is loaded">The figures count the first {formatCount(loaded.length)} of {formatCount(q.data?.total ?? loaded.length)} tasks.</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]">
        <div className="flex min-w-0 flex-wrap items-center gap-x-[16px] gap-y-[4px]">
          {(documents > 0 || !includeDocuments) && (
            <span className="inline-flex items-center gap-[4px]">
              <Checkbox label={`Include document requests (${formatCount(documents)})`} checked={includeDocuments} onChange={(e) => setAddress({ documents: e.target.checked ? 'on' : 'off' })} />
              <InfoTip text="Document requests are the tasks that document reviews and acknowledgements raise for a person. Switch them off to see the numbers of the work people plan themselves." label="About document requests" />
            </span>
          )}
          <p className="text-ds-body text-ds-fg-muted">{scopeWords(q.data?.scope, includeDocuments)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]"><AiHelpers rows={loaded} complete={!cut} /></div>
      </div>

      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-5">
        <StatTile label="Total tasks" value={formatCount(data.total)} note={<ToTasks href={links.all} label={`${total} tasks. Open them in All tasks`}>View tasks</ToTasks>} />
        <StatTile
          label="Overdue" value={formatCount(data.overdue)} tone={data.overdue > 0 ? 'danger' : 'default'} info="Tasks that are not Completed or Verified and whose due date has passed."
          note={<ToTasks href={links.overdue} label={`${plural(data.overdue, 'overdue task', 'overdue tasks')}. Open them in All tasks`}>View tasks</ToTasks>}
        />
        <StatTile
          label="Completion" value={formatPercent(data.completionRate)} tone="success" progress={data.completionRate} info="Completed and Verified tasks as a share of all tasks."
          note={<ToTasks href={links.done} label={`${plural(data.done, 'finished task', 'finished tasks')}. Open them in All tasks`}>{`${formatCount(data.done)} of ${total} tasks done`}</ToTasks>}
        />
        <StatTile label="SLA compliance" value={formatPercent(data.slaCompliance)} progress={data.slaCompliance} info="Of the tasks with a due date: the ones finished on time and the ones not yet due." note={`${formatCount(data.slaMet)} of ${formatCount(data.slaTotal)} tasks with a due date`} />
        <StatTile label="Active" value={formatCount(data.active)} info="Tasks that are not Completed or Verified." note={<ToTasks href={links.active} label={`${plural(data.active, 'active task', 'active tasks')}. Open them in All tasks`}>View tasks</ToTasks>} />
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <SectionCard id="report-status" title="Tasks by status"><DrillBars rows={rowsOf(data.byStatus, links.status, toneOf(taskStatus))} noun="tasks" empty="No tasks yet" /></SectionCard>
        <SectionCard id="report-priority" title="Tasks by priority"><DrillBars rows={rowsOf(data.byPriority, links.priority, toneOf(taskPriority))} noun="tasks" empty="No tasks yet" /></SectionCard>
        <SectionCard id="report-source" title="Completion rate by source">
          <DrillBars
            noun="tasks" empty="No data yet"
            rows={data.completionBySource.map((s) => ({ key: s.key, label: s.label, count: s.completed, percent: s.rate, href: links.source(s.key), detail: `${formatCount(s.completed)} of ${formatCount(s.total)} (${formatPercent(s.rate)})`, valueText: `${formatCount(s.completed)} of ${formatCount(s.total)} done` }))}
          />
        </SectionCard>
        <SectionCard
          id="report-aging" title="Overdue aging"
          actions={data.overdue > 0 ? <Button href={links.oldest}>Open them, longest overdue first</Button> : undefined}
        >
          {data.overdue === 0
            ? <p className="py-[8px] text-center text-ds-body text-ds-success">No overdue tasks</p>
            : <DrillBars rows={data.aging.map((a) => ({ key: a.label, label: a.label, count: a.count, percent: a.percent, href: null, tone: 'danger' as const }))} noun="overdue tasks" empty="No overdue tasks" />}
        </SectionCard>
      </div>

      <SectionCard id="report-trend" title="Created and completed" meta="the last 12 months"><Trend months={data.trend} /></SectionCard>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <SectionCard id="report-workload" title="Workload per person" meta="open tasks" info="Each open task counts for everyone on it. A row opens that person's open tasks.">
          <DrillBars rows={rowsOf(data.workload, links.owner)} noun="open tasks" empty="No open tasks are assigned" limit={8} />
        </SectionCard>
        <SectionCard id="report-category" title="Tasks by category"><DrillBars rows={rowsOf(data.byCategory, links.category)} noun="tasks" empty="No data" limit={8} /></SectionCard>
      </div>
    </div>
  );
}
