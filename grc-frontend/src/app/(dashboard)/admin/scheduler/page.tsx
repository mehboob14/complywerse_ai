'use client';

// Administration > Scheduled jobs: the platform's recurring jobs (feed refreshes, expiry sweeps, reminders, connector syncs) and when each last went on the queue. The web
// app queues them itself; a worker runs them. One row a job: how often, when it was last queued, where it stands, and Run now for who may change settings (the server needs
// admin:settings:edit; reading needs admin:settings:view). The jobs are the PLATFORM's, not only this organisation's, and the page says so. Rules: schedulerModel.ts.
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, EmptyState, Notice, ReadOnlyNote, RegisterTable, StatusPill, useReportedMutation, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { statusPill } from '@/lib/status';
import { scheduledJob } from '@/lib/statuses/adminAuditAi';
import { ago, clockWords, every, failingCount, failureWords, jobName, stateOf, type Job, type Schedule } from './schedulerModel';

const KEY = ['admin-scheduler'];

export default function SchedulerPage() {
  const { hasPermission, isAdmin, isLoading: rightsLoading } = usePermissions();
  const canRun = !rightsLoading && (isAdmin || hasPermission('admin:settings:edit'));
  const schedule = useQuery<Schedule>({ queryKey: KEY, queryFn: async () => (await apiClient.get('/admin/scheduler')).data, refetchInterval: 30_000, retry: false });

  const run = useReportedMutation({
    mutationFn: async (key: string) => (await apiClient.post(`/admin/scheduler/${key}/run`)).data,
    success: (_data, key) => ({ title: `${jobName(key)} was queued`, message: 'The worker picks it up within moments.' }),
    failure: "The job couldn't be queued",
    invalidate: [KEY],
  });

  const data = schedule.data;
  const forbidden = statusOf(schedule.error) === 403;
  const failing = data ? failingCount(data.jobs) : 0;
  const busy = run.isPending ? run.variables : null;

  const columns: RegisterColumn<Job>[] = [
    {
      key: 'job', header: 'Job', isRowHeader: true,
      cell: (j) => (
        <span className="block min-w-0">
          <span className="block font-[600] text-ds-fg">{jobName(j.key)}</span>
          {j.last_failure && <span className="block text-ds-label text-ds-danger">{failureWords(j)}</span>}
        </span>
      ),
    },
    { key: 'runs', header: 'Runs', priority: 2, card: 'meta', cell: (j) => <span className="whitespace-nowrap">{every(j.every_seconds)}</span> },
    { key: 'last', header: 'Last queued', card: 'meta', cell: (j) => <span className="whitespace-nowrap tabular-nums">{ago(j.last_queued_at)}</span> },
    { key: 'state', header: 'State', card: 'meta', cell: (j) => <StatusPill size="sm" {...statusPill(scheduledJob, stateOf(j))} /> },
    ...(canRun ? [{
      key: 'run', header: 'Run now', align: 'right' as const, width: 'w-[120px]',
      cell: (j: Job) => (
        <Button size="sm" leftIcon={<Play aria-hidden />} loading={busy === j.key} disabled={run.isPending && busy !== j.key} onClick={() => run.mutate(j.key)} aria-label={`Run ${jobName(j.key)} now`}>Run now</Button>
      ),
    }] : []),
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Scheduled jobs"
        info="Recurring jobs across the platform. Each goes on the queue when its interval has passed; a worker runs it. They run for every organisation on this platform, not only yours."
        meta={data ? (
          <span className="inline-flex flex-wrap items-center gap-x-[12px] gap-y-[2px]">
            <span>{clockWords(data.clock)}</span>
            {!canRun && !rightsLoading && <ReadOnlyNote>View only<InfoTip text="Only an administrator, or someone given the settings right, can run a job now." label="Why running a job is not offered" /></ReadOnlyNote>}
          </span>
        ) : undefined}
      />

      {forbidden ? (
        <EmptyState kind="firstUse" title="You can't see the schedule" description="Ask an administrator for the settings view right." />
      ) : (
        <>
          {data && !data.clock.enabled && <Notice tone="warning" title="The schedule is switched off on this server">Jobs are not queued until it is switched on.</Notice>}
          {failing > 0 && (
            <Notice tone="danger" title={`${failing} ${failing === 1 ? 'job' : 'jobs'} could not be queued`}>
              This usually means the background worker or its queue cannot be reached. The jobs try again at their next interval.
            </Notice>
          )}
          <RegisterTable
            caption="Scheduled jobs"
            columns={columns}
            rows={data?.jobs ?? []}
            getRowId={(j) => j.key}
            cardTitle={(j) => <span className="font-[600] text-ds-fg">{jobName(j.key)}</span>}
            loading={schedule.isLoading}
            error={schedule.isError ? { message: errorMessage(schedule.error, 'The schedule could not be loaded.'), onRetry: canRetry(schedule.error) ? () => { void schedule.refetch(); } : undefined } : null}
            empty={<EmptyState bare kind="firstUse" title="No jobs are scheduled" />}
          />
        </>
      )}
    </div>
  );
}
