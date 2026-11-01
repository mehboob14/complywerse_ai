'use client';

// Scheduled & emailed reports: list, run now, pause/resume, edit, delete.
// Backend: /report-schedules (grc/modules/report_scheduler). Each send is built with the
// permissions of the person who created the schedule and emailed as a file attachment.
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CalendarClock, Loader2, Pause, Pencil, Play, Plus, Send, Trash2 } from 'lucide-react';
import { useToast } from '@/cyber-assurance/components/ui';
import { apiErrorMessage, reportSchedulesApi, type ReportSchedule } from '@/cyber-assurance/lib/reportingExtrasApi';
import { ACCENT, Chip, ConfirmButton, EmptyBlock, PanelShell, btnPrimary, btnRow, fmtWhen } from './shared';

const FREQ_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' } as const;

function sourceLabel(s: ReportSchedule): React.ReactNode {
  if (s.saved_report_slug) {
    if (s.saved_report_missing) return <Chip tone="bad">Saved report was deleted</Chip>;
    return <>Saved report · {s.saved_report_name ?? s.saved_report_slug}</>;
  }
  const cols = s.columns.length ? `${s.columns.length} column${s.columns.length === 1 ? '' : 's'}` : 'all columns';
  const f = `${s.filters.length} filter${s.filters.length === 1 ? '' : 's'}`;
  return <>{s.dataset_label ?? s.dataset} · {cols} · {f}</>;
}

export default function ScheduledReportsPanel({
  onNew,
  onEdit,
}: {
  onNew: () => void;
  onEdit: (schedule: ReportSchedule) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: async () => (await reportSchedulesApi.list()).data,
  });
  const [busy, setBusy] = useState<number | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['report-schedules'] });

  const runNow = async (s: ReportSchedule) => {
    setBusy(s.id);
    try {
      const { data: r } = await reportSchedulesApi.runNow(s.id);
      if (r.ok) {
        toast({
          title: 'Report sent',
          message: `${r.filename ?? 'The report'} went to ${r.recipients.length} recipient${r.recipients.length === 1 ? '' : 's'}${
            r.rows != null ? ` (${r.rows.toLocaleString()} row${r.rows === 1 ? '' : 's'})` : ''
          }. ${r.message}`,
          type: 'success',
        });
      } else {
        toast({ title: 'Report not sent', message: r.message, type: 'error', duration: 10000 });
      }
    } catch (e) {
      toast({ title: 'Could not run the report', message: apiErrorMessage(e), type: 'error' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const setActive = async (s: ReportSchedule, active: boolean) => {
    setBusy(s.id);
    try {
      await reportSchedulesApi.update(s.id, { active });
      toast({ title: active ? 'Schedule resumed' : 'Schedule paused', message: s.name, type: 'success' });
    } catch (e) {
      toast({ title: 'Could not update the schedule', message: apiErrorMessage(e), type: 'error' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const remove = async (s: ReportSchedule) => {
    setBusy(s.id);
    try {
      await reportSchedulesApi.remove(s.id);
      toast({ title: 'Schedule deleted', message: s.name, type: 'success' });
    } catch (e) {
      toast({ title: 'Could not delete the schedule', message: apiErrorMessage(e), type: 'error' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const schedules = data?.schedules ?? [];

  return (
    <PanelShell
      icon={CalendarClock}
      title="Scheduled reports"
      description="Email a report as a file attachment every day, week or month. Each send uses the same data and permissions as downloading it yourself."
      actions={
        <button onClick={onNew} className={btnPrimary} style={{ background: ACCENT }}>
          <Plus size={15} /> New schedule
        </button>
      }
    >
      {data && !data.email.configured && (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]"
          style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-soft-light)', color: 'var(--color-text)' }}
        >
          <AlertTriangle size={16} className="mt-0.5 flex-none" style={{ color: 'var(--color-warning)' }} />
          <span>
            Email isn&apos;t set up for this workspace, so scheduled reports can be saved but won&apos;t be delivered. Add an
            outgoing mailbox under Help Desk &rsaquo; Settings &rsaquo; Email (or ask your administrator to set the SMTP
            environment).
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <Loader2 size={15} className="animate-spin" /> Loading schedules…
        </div>
      ) : isError ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-[var(--color-danger)]">
          <AlertCircle size={15} /> {apiErrorMessage(error, 'Could not load the schedules.')}
        </div>
      ) : schedules.length === 0 ? (
        <EmptyBlock icon={CalendarClock} title="Nothing scheduled yet">
          Pick a saved report, or press Schedule in the Report builder, to have it emailed on a schedule.
          <div className="mt-3">
            <button onClick={onNew} className={btnPrimary} style={{ background: ACCENT }}>
              <Plus size={15} /> New schedule
            </button>
          </div>
        </EmptyBlock>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {schedules.map((s) => {
            const rowBusy = busy === s.id;
            const first = s.recipients[0];
            const more = s.recipients.length - 1;
            return (
              <li
                key={s.id}
                className="grid gap-3 py-3.5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:items-center"
              >
                {/* what */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--color-text)]">{s.name}</span>
                    <Chip tone="muted">{s.format.toUpperCase()}</Chip>
                    {!s.active && <Chip tone="warn">Paused</Chip>}
                  </div>
                  <div className="mt-0.5 truncate text-[13px] text-[var(--color-muted)]">{sourceLabel(s)}</div>
                  <div className="mt-0.5 truncate text-[12px] text-[var(--color-muted)]" title={s.recipients.join(', ')}>
                    To {first}
                    {more > 0 ? ` +${more} more` : ''}
                    {!s.is_mine && s.created_by_name ? ` · by ${s.created_by_name}` : ''}
                  </div>
                </div>

                {/* when */}
                <div className="text-[13px]">
                  <div className="font-medium text-[var(--color-text)]">{FREQ_LABEL[s.frequency]}</div>
                  <div className="text-[var(--color-muted)]">{s.active ? `Next ${fmtWhen(s.next_run)}` : 'Not scheduled'}</div>
                </div>

                {/* last outcome */}
                <div className="min-w-0 text-[13px]">
                  {s.last_status ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <Chip tone={s.last_status === 'sent' ? 'ok' : 'bad'}>
                          {s.last_status === 'sent' ? 'Sent' : 'Failed'}
                        </Chip>
                        <span className="text-[var(--color-muted)]">{fmtWhen(s.last_run_at)}</span>
                      </div>
                      {s.last_status === 'error' && s.last_error && (
                        <div
                          className="mt-0.5 line-clamp-2 text-[12px] text-[var(--color-danger)]"
                          title={s.last_error}
                        >
                          {s.last_error}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-[var(--color-muted)]">Not sent yet</span>
                  )}
                </div>

                {/* actions */}
                <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                  <button onClick={() => runNow(s)} disabled={rowBusy} className={btnRow} title="Build the report and email it now">
                    {rowBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Run now
                  </button>
                  <button
                    onClick={() => setActive(s, !s.active)}
                    disabled={rowBusy}
                    className={btnRow}
                    title={s.active ? 'Pause sending' : 'Resume sending'}
                  >
                    {s.active ? <Pause size={13} /> : <Play size={13} />} {s.active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => onEdit(s)} disabled={rowBusy} className={btnRow} title="Edit this schedule">
                    <Pencil size={13} /> Edit
                  </button>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete schedule"
                    busy={rowBusy}
                    icon={<Trash2 size={13} />}
                    onConfirm={() => remove(s)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}
