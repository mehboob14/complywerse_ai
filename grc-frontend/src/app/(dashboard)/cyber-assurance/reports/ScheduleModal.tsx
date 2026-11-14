'use client';

// Create / edit a scheduled, emailed report (POST/PUT /report-schedules).
// A schedule follows EITHER a saved report (resolved fresh on every run) OR an inline
// definition captured from the Report Builder. Reports run with the creator's permissions.
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CalendarClock, Loader2 } from 'lucide-react';
import { AnimatedModal, useToast } from '@/cyber-assurance/components/ui';
import { reportingApi } from '@/cyber-assurance/lib/api';
import {
  apiErrorMessage,
  reportSchedulesApi,
  savedReportsApi,
  type BuilderSnapshot,
  type MailFormat,
  type ReportSchedule,
  type ReportScheduleIn,
  type ScheduleFrequency,
} from '@/cyber-assurance/lib/reportingExtrasApi';
import { ACCENT, btnGhost, btnPrimary, fieldLabel, inputCls, labelize } from './shared';

export type ScheduleEditor =
  | {
      mode: 'new';
      /** Where the report definition comes from; omit to pick a saved report in the dialog. */
      source?: { kind: 'saved'; slug: string; name?: string } | { kind: 'inline'; snapshot: BuilderSnapshot };
    }
  | { mode: 'edit'; schedule: ReportSchedule };

const FREQUENCIES: { value: ScheduleFrequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
];

const FORMATS: { value: MailFormat; label: string }[] = [
  { value: 'xlsx', label: 'Excel' },
  { value: 'csv', label: 'CSV' },
  { value: 'pdf', label: 'PDF' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const defaultFirstSend = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return toLocalInput(d);
};
const parseRecipients = (text: string) => text.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean);

export default function ScheduleModal({ editor, onClose }: { editor: ScheduleEditor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Keep rendering the last editor while the modal plays its exit animation.
  const lastEditor = useRef<ScheduleEditor | null>(null);
  if (editor) lastEditor.current = editor;
  const shown = editor ?? lastEditor.current;

  const [name, setName] = useState('');
  const [useSaved, setUseSaved] = useState(true);
  const [slug, setSlug] = useState('');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('weekly');
  const [startLocal, setStartLocal] = useState('');
  const [startTouched, setStartTouched] = useState(false);
  const [format, setFormat] = useState<MailFormat>('xlsx');
  const [recipientsText, setRecipientsText] = useState('');
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const open = !!editor;

  const { data: saved } = useQuery({
    queryKey: ['saved-reports'],
    queryFn: async () => (await savedReportsApi.list()).data.reports,
    enabled: open,
  });
  const { data: datasets } = useQuery({
    queryKey: ['reporting-datasets'],
    queryFn: async () => (await reportingApi.datasets()).data.datasets,
    enabled: open,
  });
  const { data: scheduleMeta } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: async () => (await reportSchedulesApi.list()).data,
    enabled: open,
  });

  // Only saved reports on a dataset this product can report on.
  const available = new Set((datasets ?? []).map((d) => d.key));
  const savedOptions = (saved ?? []).filter((r) => !datasets || available.has(r.dataset));

  // Fresh form each time the dialog opens.
  useEffect(() => {
    if (!editor) return;
    setError(null);
    if (editor.mode === 'edit') {
      const s = editor.schedule;
      setName(s.name);
      setUseSaved(!!s.saved_report_slug);
      setSlug(s.saved_report_slug ?? '');
      setFrequency(s.frequency);
      setStartLocal(toLocalInput(new Date(s.next_run ?? s.start_at)));
      setStartTouched(false);
      setFormat(s.format);
      setRecipientsText(s.recipients.join(', '));
      setMessage(s.message ?? '');
      setActive(s.active);
    } else {
      const src = editor.source;
      setName(src?.kind === 'inline' ? `${labelize(src.snapshot.dataset)} report` : src?.kind === 'saved' ? src.name ?? '' : '');
      setUseSaved(src?.kind !== 'inline');
      setSlug(src?.kind === 'saved' ? src.slug : '');
      setFrequency('weekly');
      setStartLocal(defaultFirstSend());
      setStartTouched(true);
      setFormat(src?.kind === 'inline' && src.snapshot.format !== 'html' ? src.snapshot.format : 'xlsx');
      setRecipientsText('');
      setMessage('');
      setActive(true);
    }
  }, [editor]);

  // An inline definition exists when the dialog was opened from the builder, or edits an inline schedule.
  const hasInline =
    shown?.mode === 'new'
      ? shown.source?.kind === 'inline'
      : !!shown && !shown.schedule.saved_report_slug;
  const inlineSummary = (() => {
    if (!shown) return '';
    if (shown.mode === 'new' && shown.source?.kind === 'inline') {
      const s = shown.source.snapshot;
      return `${labelize(s.dataset)} · ${s.columns.length} column${s.columns.length === 1 ? '' : 's'} · ${s.filters.length} filter${s.filters.length === 1 ? '' : 's'}`;
    }
    if (shown.mode === 'edit' && !shown.schedule.saved_report_slug) {
      const s = shown.schedule;
      return `${s.dataset_label ?? labelize(s.dataset ?? '')} · ${s.columns.length || 'all'} column${s.columns.length === 1 ? '' : 's'} · ${s.filters.length} filter${s.filters.length === 1 ? '' : 's'}`;
    }
    return '';
  })();

  const recipients = parseRecipients(recipientsText);
  const maxRecipients = scheduleMeta?.max_recipients ?? 25;
  const formOk = name.trim().length > 0 && recipients.length > 0 && (!useSaved || slug !== '');

  const submit = useMutation({
    mutationFn: async () => {
      if (!shown) throw new Error('No schedule to save.');
      const body: ReportScheduleIn = {
        name: name.trim(),
        frequency,
        format,
        recipients,
        message: message.trim() || null,
      };
      if (useSaved) {
        body.saved_report_slug = slug;
      } else if (shown.mode === 'new' && shown.source?.kind === 'inline') {
        const s = shown.source.snapshot;
        body.dataset = s.dataset;
        body.columns = s.columns;
        body.filters = s.filters;
        body.logic = s.logic;
      } // editing an inline schedule without switching source: leave its definition untouched
      if (startTouched && startLocal) body.start_at = new Date(startLocal).toISOString();
      if (shown.mode === 'edit') {
        body.active = active;
        return (await reportSchedulesApi.update(shown.schedule.id, body)).data;
      }
      return (await reportSchedulesApi.create(body)).data;
    },
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['report-schedules'] });
      toast({
        title: shown?.mode === 'edit' ? 'Schedule updated' : 'Schedule created',
        message: s.next_run
          ? `"${s.name}" next sends ${new Date(s.next_run).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
          : `"${s.name}" is paused.`,
        type: 'success',
      });
      onClose();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the schedule.')),
  });

  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'your local time';
    }
  })();

  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      size="lg"
      title={shown?.mode === 'edit' ? 'Edit scheduled report' : 'Schedule a report'}
      subtitle="Emailed as an attachment to everyone on the list"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              submit.mutate();
            }}
            disabled={!formOk || submit.isPending}
            className={btnPrimary}
            style={{ background: ACCENT }}
          >
            {submit.isPending ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />}
            {shown?.mode === 'edit' ? 'Save changes' : 'Create schedule'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {scheduleMeta && !scheduleMeta.email.configured && (
          <div
            className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]"
            style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-soft-light)', color: 'var(--color-text)' }}
          >
            <AlertTriangle size={16} className="mt-0.5 flex-none" style={{ color: 'var(--color-warning)' }} />
            <span>
              Email isn&apos;t set up for this workspace yet. You can save the schedule now, but nothing will be sent
              until SMTP is configured (Help Desk &rsaquo; Settings &rsaquo; Email).
            </span>
          </div>
        )}

        <label className="block">
          <span className={fieldLabel}>Name</span>
          <input
            autoFocus
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly critical vulnerabilities"
            className={inputCls}
          />
        </label>

        {/* Report source */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Report</span>
            {hasInline && (
              <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border)] text-xs">
                {[
                  { v: false, label: 'Builder definition' },
                  { v: true, label: 'A saved report' },
                ].map((o) => (
                  <button
                    key={String(o.v)}
                    onClick={() => setUseSaved(o.v)}
                    className="px-2.5 py-1 font-medium"
                    style={useSaved === o.v ? { background: ACCENT, color: 'var(--color-on-base)' } : { color: 'var(--color-muted)' }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {useSaved ? (
            <>
              <select
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  if (!name.trim()) {
                    const r = savedOptions.find((o) => o.slug === e.target.value);
                    if (r) setName(r.name);
                  }
                }}
                className={inputCls}
              >
                <option value="">Choose a saved report…</option>
                {slug && !savedOptions.some((r) => r.slug === slug) && (
                  <option value={slug}>{slug} (not available)</option>
                )}
                {savedOptions.map((r) => (
                  <option key={`${r.slug}:${r.is_mine}`} value={r.slug}>
                    {r.name}
                    {r.is_mine ? '' : ' (shared)'} — {labelize(r.dataset)}
                  </option>
                ))}
              </select>
              {saved && savedOptions.length === 0 && (
                <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
                  No saved reports yet. Build one in the Report builder and press Save, or schedule it straight from there.
                </p>
              )}
              <p className="mt-1.5 text-[12px] text-[var(--color-muted)]">
                The schedule follows the saved report — edit the report and the next email reflects it.
              </p>
            </>
          ) : (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-2 text-sm text-[var(--color-text)]">
              {inlineSummary}
              <span className="block text-[12px] text-[var(--color-muted)]">
                {shown?.mode === 'edit'
                  ? 'Columns and filters stay as they were. To change them, save the report in the builder and switch this schedule to it.'
                  : 'Exactly what is configured in the builder right now.'}
              </span>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={fieldLabel}>Repeat</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)} className={inputCls}>
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>{shown?.mode === 'edit' ? 'Next send' : 'First send'}</span>
            <input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => {
                setStartLocal(e.target.value);
                setStartTouched(true);
              }}
              className={inputCls}
            />
            <span className="mt-1 block text-[12px] text-[var(--color-muted)]">
              {tz}. Later sends keep this time of day{frequency === 'weekly' ? ' and weekday' : frequency === 'monthly' ? ' and day of the month' : ''}.
            </span>
          </label>
        </div>

        <div>
          <span className={fieldLabel}>File format</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-[var(--color-border)]">
            {FORMATS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFormat(f.value)}
                className="px-3.5 py-1.5 text-sm font-medium"
                style={format === f.value ? { background: ACCENT, color: 'var(--color-on-base)' } : { color: 'var(--color-muted)' }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={fieldLabel}>
            Recipients ({recipients.length}/{maxRecipients})
          </span>
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            rows={2}
            placeholder="name@company.com, other@company.com"
            className={`${inputCls} resize-y`}
          />
        </label>

        <label className="block">
          <span className={fieldLabel}>Message (optional)</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="A note included at the top of each email"
            className={`${inputCls} resize-y`}
          />
        </label>

        {shown?.mode === 'edit' && (
          <label className="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-border)]"
            />
            Active — uncheck to pause sending
          </label>
        )}

        <p className="text-[12px] text-[var(--color-muted)]">
          Each email is built with your access to the data at the time it is sent. If you lose access to the dataset, the
          schedule stops sending and shows the reason.
        </p>

        {error && (
          <div className="flex items-start gap-1.5 text-[13px] text-[var(--color-danger)]">
            <AlertCircle size={14} className="mt-0.5 flex-none" /> {error}
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}
