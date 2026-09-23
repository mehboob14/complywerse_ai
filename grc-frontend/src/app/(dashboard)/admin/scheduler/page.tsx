'use client';

/** Administration → Scheduler.
 *
 *  The platform's recurring jobs — feed refreshes, expiry sweeps, reminders,
 *  connector syncs — and when each last went on the queue. The web app queues
 *  them itself (backend/grc/services/platform_clock.py); the worker runs them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Loader2, Play, PowerOff } from 'lucide-react';
import { useState } from 'react';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';

type Job = {
  key: string;
  task: string;
  every_seconds: number;
  last_queued_at: string | null;
  next_due_at: string;
  overdue: boolean;
  last_failure: { at: string | null; attempts: number; detail: string } | null;
};
type Resp = { clock: { enabled: boolean; tick_seconds: number }; jobs: Job[] };

const title = (key: string) => key.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function every(seconds: number): string {
  if (seconds % 86400 === 0) return seconds === 86400 ? 'Daily' : `Every ${seconds / 86400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? 'Hourly' : `Every ${seconds / 3600} hours`;
  return `Every ${Math.round(seconds / 60)} min`;
}

function ago(iso: string | null): string {
  if (!iso) return 'Never';
  const minutes = Math.round((Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

function stateOf(job: Job) {
  if (job.last_failure) return { label: 'Failing', cls: 'bg-rose-50 text-rose-700 border-rose-200', Icon: AlertTriangle };
  if (!job.last_queued_at) return { label: 'Not run yet', cls: 'bg-slate-50 text-slate-600 border-slate-200', Icon: Clock };
  if (job.overdue) return { label: 'Overdue', cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: Clock };
  return { label: 'On schedule', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 };
}

export default function SchedulerPage() {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canRun = hasPermission('admin:settings:edit');
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<Resp>({
    queryKey: ['admin-scheduler'],
    queryFn: async () => (await apiClient.get('/admin/scheduler')).data,
    refetchInterval: 30_000,
  });

  const run = useMutation({
    mutationFn: async (key: string) => (await apiClient.post(`/admin/scheduler/${key}/run`)).data,
    onSuccess: (_r, key) => {
      setMessage(`${title(key)} queued. The worker picks it up within moments.`);
      qc.invalidateQueries({ queryKey: ['admin-scheduler'] });
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setMessage(detail || 'Could not queue that job.');
    },
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the schedule…</div>;
  }
  if (error || !data) {
    return <div className="p-6 text-sm text-rose-600">Could not load the schedule. You need the admin settings permission to see it.</div>;
  }

  const failing = data.jobs.filter((j) => j.last_failure).length;

  return (
    <div className="max-w-5xl space-y-4 p-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <CalendarClock className="h-5 w-5 text-slate-500" /> Scheduler
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Recurring jobs across the platform. Each goes on the queue when its interval has passed; the worker runs it.
          </p>
        </div>
        {data.clock.enabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Running · checks every {Math.round(data.clock.tick_seconds / 60)} min
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
            title="DISABLE_PLATFORM_CLOCK is set on this server">
            <PowerOff className="h-3.5 w-3.5" /> Switched off on this server
          </span>
        )}
      </div>

      {failing > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {failing} job{failing === 1 ? '' : 's'} could not be queued. This usually means the job queue (Redis) is unreachable.
        </p>
      )}
      {message && <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{message}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2.5">Job</th>
              <th className="px-4 py-2.5">Runs</th>
              <th className="px-4 py-2.5">Last queued</th>
              <th className="px-4 py-2.5">State</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {data.jobs.map((job) => {
              const state = stateOf(job);
              return (
                <tr key={job.key} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{title(job.key)}</div>
                    <div className="font-mono text-[11px] text-slate-400">{job.task}</div>
                    {job.last_failure && (
                      <div className="mt-1 text-[11px] text-rose-600">
                        {job.last_failure.detail}
                        {job.last_failure.attempts > 1 && ` · tried ${job.last_failure.attempts} times`}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{every(job.every_seconds)}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{ago(job.last_queued_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${state.cls}`}>
                      <state.Icon className="h-3 w-3" /> {state.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canRun && (
                      <button
                        onClick={() => run.mutate(job.key)}
                        disabled={run.isPending}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {run.isPending && run.variables === job.key
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Play className="h-3 w-3" />}
                        Run now
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
