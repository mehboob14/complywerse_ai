'use client';

// Task Reports: the server's summary of the tasks the person may see (GET critical-tasks/reports/summary: an administrator or View all sees every task, everyone else the tasks they take part
// in) as five counts, the breakdowns behind them, a twelve-month trend and the workload per owner, with the two AI helpers (Predict escalations, Balance workload). It is the Task Management
// page's "Reports" tab and the page at /tasks/reports. The numbers are the server's, unchanged (percentages show whole numbers from ten up, as everywhere); a bar is a share of its total with its
// figures in words; the trend has its numbers in a table you can open. A failed read is an error with the server's words, never "No report data available".
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Scale, Sparkles, X } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { NOT_SET, formatCount, formatDate, formatPercent } from '@/lib/format';
import { reassignReport } from '@/lib/documentTasks';
import { Button, EmptyState, ErrorState, IconButton, ProgressBar, SectionCard, SkeletonRows, StatTile, StatusPill, useConfirm, useNotify, useReportedMutation, type ProgressTone } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { taskPriority, taskStatus } from '@/lib/statuses/tasks';
import { retryRead } from './_queries';
import { PRIORITIES, STATUSES, activeCount, bars, orderBars, trendHeight, trendMax, workloadBars, type Bar } from './tasksModel';

interface ReportSummary {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_source: Record<string, number>;
  by_category: Record<string, number>;
  overdue: number;
  overdue_aging: Record<string, number>;
  completion_rate: number;
  sla_compliance: number;
  owner_workload: Record<string, number>;
  completion_by_source: Record<string, { total: number; completed: number; rate: number }>;
  trend_data: Array<{ month: string; created: number; completed: number }>;
  /** 'mine': counts of the tasks the person takes part in; 'all': every task (an administrator or View all) */
  scope?: 'all' | 'mine';
}

interface Prediction { title?: string; risk_score?: number; confidence?: number; predicted_breach_date?: string; risk_factors?: string[]; recommended_actions?: string[] }
interface Rebalance { task_id?: number; task_title?: string; current_owner?: string; suggested_owner?: string; suggested_owner_id?: number; reason?: string }
interface Escalations { predictions?: Prediction[] }
interface Workload { summary?: string; current_workload?: Record<string, unknown>; suggestions?: Rebalance[] }

type ToneOf = (label: string) => ProgressTone;
const PRIMARY: ToneOf = () => 'primary';
const TONES: Record<string, ProgressTone> = { success: 'success', danger: 'danger', warning: 'warning' };
const byWords = (registry: { tone: (w: string) => string }): ToneOf => (label) => TONES[registry.tone(label)] ?? 'primary';
const counted = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

function BarRows({ rows, total, noun, tone = PRIMARY, empty }: { rows: Bar[]; total?: number; noun: string; tone?: ToneOf; empty: string }) {
  if (rows.length === 0) return <p className="py-[8px] text-center text-ds-body text-ds-fg-muted">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
      {rows.map((b) => (
        <li key={b.label}>
          <div className="mb-[4px] flex items-baseline justify-between gap-[8px] text-ds-body">
            <span className="min-w-0 text-ds-fg [overflow-wrap:anywhere]">{b.label}</span>
            <span className="shrink-0 tabular-nums text-ds-fg-muted">{formatCount(b.count)}</span>
          </div>
          <ProgressBar value={b.percent} label={`${b.label}: ${noun}`} valueText={total != null ? `${formatCount(b.count)} of ${formatCount(total)}` : formatCount(b.count)} showValue={false} tone={tone(b.label)} />
        </li>
      ))}
    </ul>
  );
}

function Trend({ data }: { data: ReportSummary['trend_data'] }) {
  const max = trendMax(data);
  return (
    <div>
      <div aria-hidden className="flex h-[160px] items-end gap-[4px]">
        {data.map((t, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-[4px]">
            <div className="flex w-full flex-1 items-end justify-center gap-[2px]">
              <div className="w-[8px] rounded-t-[2px] bg-ds-primary" style={{ height: `${trendHeight(t.created, max)}%`, minHeight: t.created > 0 ? '4px' : '0' }} />
              <div className="w-[8px] rounded-t-[2px] bg-ds-success" style={{ height: `${trendHeight(t.completed, max)}%`, minHeight: t.completed > 0 ? '4px' : '0' }} />
            </div>
            <span className="w-full truncate text-center text-ds-label text-ds-fg-muted">{t.month.split(' ')[0]}</span>
          </div>
        ))}
      </div>
      <div className="mt-[12px] flex items-center justify-center gap-[24px] text-ds-label text-ds-fg-muted">
        <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px] bg-ds-primary" /> Created</span>
        <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px] bg-ds-success" /> Completed</span>
      </div>
      <details className="mt-[8px]">
        <summary className="cursor-pointer rounded-ds-control text-ds-body font-medium text-ds-primary-text focus-visible:outline-none focus-visible:shadow-ds-ring">Show the numbers</summary>
        <div className="mt-[8px] max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Tasks created and completed in each of the last 12 months</caption>
            <thead><tr><th scope="col" className="py-[4px] pr-[12px] text-ds-label font-[600] text-ds-fg-muted">Month</th><th scope="col" className="px-[12px] py-[4px] text-right text-ds-label font-[600] text-ds-fg-muted">Created</th><th scope="col" className="px-[12px] py-[4px] text-right text-ds-label font-[600] text-ds-fg-muted">Completed</th></tr></thead>
            <tbody>{data.map((t, i) => <tr key={i}><th scope="row" className="py-[4px] pr-[12px] text-ds-body font-normal text-ds-fg">{t.month}</th><td className="px-[12px] py-[4px] text-right text-ds-body tabular-nums text-ds-fg">{formatCount(t.created)}</td><td className="px-[12px] py-[4px] text-right text-ds-body tabular-nums text-ds-fg">{formatCount(t.completed)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** the risk of an escalation as a word and a tone: from 80% critical, from 50% a warning, below that fine */
const riskPill = (score: number | undefined) => ({ tone: (score ?? 0) >= 80 ? 'danger' : (score ?? 0) >= 50 ? 'warning' : 'success', label: `Risk ${formatPercent(score ?? 0)}` } as const);

export function ReportsView() {
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [escalations, setEscalations] = useState<Escalations | null>(null);
  const [workload, setWorkload] = useState<Workload | null>(null);

  const q = useQuery<ReportSummary>({
    queryKey: ['task-reports'],
    queryFn: async () => (await criticalTasksApi.reportsSummary()).data,
    retry: retryRead,
  });

  const predict = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiPredictEscalations(),
    success: 'Done',
    failure: "AI couldn't predict escalations",
    toast: 'errors',
    onSuccess: (res) => setEscalations((res.data as Escalations) ?? { predictions: [] }),
  });
  const balance = useReportedMutation({
    mutationFn: () => criticalTasksApi.aiBalanceWorkload(),
    success: 'Done',
    failure: "AI couldn't balance the workload",
    toast: 'errors',
    onSuccess: (res) => setWorkload((res.data as Workload) ?? { suggestions: [] }),
  });
  // Apply Reassignments: one update per suggestion, each outcome kept (null = it worked, else the server's refusal), said by reassignReport as it always was
  const reassign = useReportedMutation({
    mutationFn: async (suggestions: Rebalance[]) => {
      const outcomes: (string | null)[] = [];
      for (const s of suggestions) {
        if (!s.task_id || !s.suggested_owner_id) continue;
        try {
          await criticalTasksApi.update(s.task_id, { assigned_owner_id: s.suggested_owner_id });
          outcomes.push(null);
        } catch (e: unknown) {
          const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
          outcomes.push(typeof detail === 'string' ? detail : '');
        }
      }
      return outcomes;
    },
    success: 'Done',
    failure: "Couldn't reassign the tasks",
    invalidate: [['task-reports'], ['critical-tasks']],
    toast: 'errors',
    onSuccess: (outcomes) => {
      const { moved, message } = reassignReport(outcomes);
      const title = `${counted(moved, 'task', 'tasks')} reassigned`;
      if (message) notify.warning(message, { title });
      else notify.success(title);
      setWorkload(null);
    },
  });

  const applyReassignments = async (suggestions: Rebalance[]) => {
    const yes = await confirm({
      title: `Reassign ${counted(suggestions.length, 'task', 'tasks')}?`,
      message: 'Each task goes to the person the AI suggests. A task from a document request follows its request and cannot be given to someone else: it is skipped.',
      confirmLabel: `Reassign ${counted(suggestions.length, 'task', 'tasks')}`,
    });
    if (yes) reassign.mutate(suggestions);
  };

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-[16px]" role="status" aria-label="Loading the task reports">
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-5">{['Total tasks', 'Overdue', 'Completion', 'SLA compliance', 'Active'].map((label) => <StatTile key={label} label={label} value={null} loading />)}</div>
        <SkeletonRows rows={5} columns={3} />
      </div>
    );
  }
  if (q.isError) return <ErrorState title="Couldn't load the task reports" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  const report = q.data;
  if (!report) return <EmptyState kind="firstUse" title="No report data yet" info="The reports fill in as tasks are created." />;

  const sources = Object.keys(report.completion_by_source || {});
  const aging = bars(report.overdue_aging, report.overdue);
  const trend = report.trend_data || [];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="text-ds-body text-ds-fg-muted">{report.scope === 'mine' ? 'Counts of your tasks: the ones you own, are assigned to, review or created.' : 'Counts of every task in the organization.'}</p>
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button leftIcon={<Sparkles aria-hidden />} loading={predict.isPending} onClick={() => predict.mutate()}>Predict escalations</Button>
          <Button leftIcon={<Scale aria-hidden />} loading={balance.isPending} onClick={() => balance.mutate()}>Balance workload</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-5">
        <StatTile label="Total tasks" value={formatCount(report.total)} />
        <StatTile label="Overdue" value={formatCount(report.overdue)} tone={report.overdue > 0 ? 'danger' : 'default'} info="Tasks that are not Completed or Verified and whose due date has passed." />
        <StatTile label="Completion" value={formatPercent(report.completion_rate)} tone="success" progress={report.completion_rate} info="Completed and Verified tasks as a share of all tasks." />
        <StatTile label="SLA compliance" value={formatPercent(report.sla_compliance)} progress={report.sla_compliance} info="Of the tasks with a due date: the ones finished on time and the ones not yet due." />
        <StatTile label="Active" value={formatCount(activeCount(report))} info="Tasks that are not Completed or Verified." />
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-2">
        <SectionCard id="report-status" title="Tasks by status"><BarRows rows={orderBars(bars(report.by_status, report.total), STATUSES)} total={report.total} noun="tasks" tone={byWords(taskStatus)} empty="No tasks yet" /></SectionCard>
        <SectionCard id="report-priority" title="Tasks by priority"><BarRows rows={orderBars(bars(report.by_priority, report.total), PRIORITIES)} total={report.total} noun="tasks" tone={byWords(taskPriority)} empty="No tasks yet" /></SectionCard>
        <SectionCard id="report-source" title="Completion rate by source">
          {sources.length === 0 ? <p className="py-[8px] text-center text-ds-body text-ds-fg-muted">No data yet</p> : (
            <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
              {sources.map((source) => {
                const d = report.completion_by_source[source];
                return (
                  <li key={source}>
                    <div className="mb-[4px] flex items-baseline justify-between gap-[8px] text-ds-body">
                      <span className="min-w-0 text-ds-fg [overflow-wrap:anywhere]">{source}</span>
                      <span className="shrink-0 tabular-nums text-ds-fg-muted">{formatCount(d.completed)} of {formatCount(d.total)} ({formatPercent(d.rate)})</span>
                    </div>
                    <ProgressBar value={d.rate} label={`${source}: completion rate`} valueText={`${formatCount(d.completed)} of ${formatCount(d.total)}`} showValue={false} />
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
        <SectionCard id="report-aging" title="Overdue aging">
          {report.overdue === 0 ? (
            <p className="flex items-center justify-center gap-[8px] py-[8px] text-ds-body text-ds-success"><CheckCircle2 aria-hidden className="h-[16px] w-[16px]" /> No overdue tasks</p>
          ) : <BarRows rows={aging} total={report.overdue} noun="overdue tasks" tone={() => 'danger'} empty="No overdue tasks" />}
        </SectionCard>
      </div>

      <SectionCard id="report-trend" title="Created and completed" meta="the last 12 months">
        {trend.length === 0 ? <p className="py-[8px] text-center text-ds-body text-ds-fg-muted">No trend data</p> : <Trend data={trend} />}
      </SectionCard>

      <SectionCard id="report-workload" title="Workload per owner" meta="active tasks">
        <BarRows rows={workloadBars(report.owner_workload)} noun="active tasks" empty="No active task assignments" />
      </SectionCard>

      <SectionCard id="report-category" title="Tasks by category">
        {Object.keys(report.by_category || {}).length === 0 ? <p className="py-[8px] text-center text-ds-body text-ds-fg-muted">No data</p> : (
          <ul className="m-0 grid list-none grid-cols-2 gap-[12px] p-0 sm:grid-cols-3 lg:grid-cols-5">
            {Object.keys(report.by_category).map((cat) => (
              <li key={cat} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[12px] text-center">
                <p className="text-[18px] font-[600] leading-[24px] tabular-nums text-ds-fg">{formatCount(report.by_category[cat])}</p>
                <p className="text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{cat}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {escalations && (
        <SectionCard id="report-escalations" title="AI escalation predictions" actions={<IconButton label="Dismiss the escalation predictions" onClick={() => setEscalations(null)}><X aria-hidden /></IconButton>}>
          {(escalations.predictions ?? []).length === 0 ? (
            <p className="flex items-center gap-[8px] text-ds-body text-ds-success"><CheckCircle2 aria-hidden className="h-[16px] w-[16px]" /> No escalation risks detected.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
              {(escalations.predictions ?? []).map((p, i) => (
                <li key={i} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
                  <div className="flex flex-wrap items-center justify-between gap-[8px]">
                    <span className="min-w-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{p.title}</span>
                    <span className="flex items-center gap-[8px]"><StatusPill size="sm" {...riskPill(p.risk_score)} /><span className="text-ds-label text-ds-fg-muted">{formatPercent(p.confidence ?? 0)} confidence</span></span>
                  </div>
                  {p.predicted_breach_date && <p className="mt-[8px] text-ds-body text-ds-danger">Predicted breach: {formatDate(p.predicted_breach_date, { empty: NOT_SET })}</p>}
                  {(p.risk_factors ?? []).length > 0 && <p className="mt-[8px] text-ds-body text-ds-fg-muted">Risk factors: {(p.risk_factors ?? []).join(', ')}</p>}
                  {(p.recommended_actions ?? []).length > 0 && <p className="mt-[4px] text-ds-body text-ds-fg-muted">Actions: {(p.recommended_actions ?? []).join(' · ')}</p>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {workload && (
        <SectionCard id="report-rebalance" title="AI workload rebalancing" actions={<IconButton label="Dismiss the workload suggestions" onClick={() => setWorkload(null)}><X aria-hidden /></IconButton>}>
          <div className="flex flex-col gap-[12px]">
            {workload.summary && <p className="text-ds-body text-ds-fg">{workload.summary}</p>}
            {workload.current_workload && (
              <div>
                <p className="mb-[8px] text-ds-label font-[600] text-ds-fg-muted">Current workload</p>
                <ul className="m-0 flex list-none flex-wrap gap-[8px] p-0">
                  {Object.keys(workload.current_workload).map((name) => {
                    const val = workload.current_workload?.[name];
                    const count = typeof val === 'number' ? val : (val as Record<string, unknown> | null)?.task_count ?? JSON.stringify(val);
                    const level = typeof val === 'object' && val !== null ? (val as Record<string, unknown>)?.load_level : null;
                    return <li key={name} className="rounded-ds-control border border-ds-border bg-ds-surface px-[8px] py-[4px] text-ds-label text-ds-fg-muted">{name}: <b className="font-[600] text-ds-fg">{String(count)}</b>{level ? ` (${String(level)})` : ''}</li>;
                  })}
                </ul>
              </div>
            )}
            {(workload.suggestions ?? []).length === 0 ? (
              <p className="flex items-center gap-[8px] text-ds-body text-ds-success"><CheckCircle2 aria-hidden className="h-[16px] w-[16px]" /> The workload is well balanced.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
                {(workload.suggestions ?? []).map((s, i) => (
                  <li key={i} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px] text-ds-body">
                    <span className="text-ds-label text-ds-fg-muted">#{s.task_id}</span> <span className="font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.task_title}</span>
                    <div className="mt-[4px] text-ds-fg-muted"><span className="text-ds-danger">{s.current_owner}</span> to <span className="text-ds-success">{s.suggested_owner}</span>{s.reason ? `: ${s.reason}` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-end gap-[8px] border-t border-ds-border pt-[12px]">
              <Button onClick={() => setWorkload(null)}>Discard</Button>
              {(workload.suggestions ?? []).length > 0 && <Button variant="primary" loading={reassign.isPending} onClick={() => { void applyReassignments(workload.suggestions ?? []); }}>Apply reassignments</Button>}
            </div>
          </div>
        </SectionCard>
      )}
      {confirmDialog}
    </div>
  );
}
