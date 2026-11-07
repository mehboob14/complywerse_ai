'use client';

// Saved report definitions (/reporting/reports) plus the ready-made audit exports
// (/reports/*) that existed server-side without a screen. A saved report is the Report
// Builder's dataset + columns + filters under a name: reopen it in the builder, download it
// straight away, schedule it by email, or share it with the workspace.
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Bookmark, CalendarClock, ClipboardList, Download, FolderOpen, Loader2, Trash2, Users,
} from 'lucide-react';
import { useToast } from '@/cyber-assurance/components/ui';
import { reportingApi, reportsApi } from '@/cyber-assurance/lib/api';
import { usePermissions } from '@/cyber-assurance/hooks/usePermissions';
import {
  apiErrorMessage, blobErrorMessage, reportSchedulesApi, saveBlob, savedReportsApi, type SavedReport,
} from '@/cyber-assurance/lib/reportingExtrasApi';
import { ACCENT, Chip, ConfirmButton, EmptyBlock, PanelShell, btnPrimary, btnRow, fmtDate, inputCls, labelize } from './shared';

const today = () => new Date().toISOString().slice(0, 10);
const fileStem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'report';

// The four ready-made exports from the Phase 9 compliance reports. `perm` gates the row in
// the UI (the dataset the export draws on); see the hand-off note — the endpoints themselves
// only require a signed-in user.
interface StandardReport {
  key: string;
  title: string;
  blurb: string;
  perm: string;
  dateRange?: boolean;
  run: (fmt: 'csv' | 'xlsx', range: { start: string; end: string }) => Promise<{ data: unknown }>;
}

const STANDARD: StandardReport[] = [
  {
    key: 'exceptions-active',
    title: 'Active exceptions',
    blurb: 'Every vulnerability exception requested or approved in a period, with justification, dates and expiry — built for audit.',
    perm: 'vulnerabilities:vulnerability_register:*',
    dateRange: true,
    run: (format, r) =>
      reportsApi.exceptionsActive({
        format,
        start_date: r.start || undefined,
        end_date: r.end ? `${r.end}T23:59:59` : undefined,
      }),
  },
  {
    key: 'remediation-timeline',
    title: 'Remediation timeline',
    blurb: 'Time to close for every resolved vulnerability: discovered, resolved, days taken, known-exploited and EPSS context.',
    perm: 'vulnerabilities:vulnerability_register:*',
    run: (format) => reportsApi.remediationTimeline({ format }),
  },
  {
    key: 'asset-register',
    title: 'Asset register',
    blurb: 'ISO 27001 A.8-style register of every IT asset: ownership chain, criticality, data classification and lifecycle.',
    perm: 'assets:asset_inventory:*',
    run: (format) => reportsApi.assetRegister({ format }),
  },
  {
    key: 'patch-evidence',
    title: 'Patch evidence',
    blurb: 'Vulnerability-to-closure evidence with the KB articles and vendor advisories that resolved each CVE.',
    perm: 'vulnerabilities:vulnerability_register:*',
    run: (format) => reportsApi.patchEvidence({ format }),
  },
];

export default function SavedReportsPanel({
  onLoad,
  onSchedule,
  onGoBuilder,
  onDeleted,
}: {
  onLoad: (report: SavedReport) => void;
  onSchedule: (report: SavedReport) => void;
  onGoBuilder: () => void;
  /** Called after a report was deleted, so the page can forget it was "loaded from" it. */
  onDeleted?: (report: SavedReport) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission, isLoading: permsLoading } = usePermissions();

  const { data: reports, isLoading, isError, error } = useQuery({
    queryKey: ['saved-reports'],
    queryFn: async () => (await savedReportsApi.list()).data.reports,
  });
  // Which datasets this product can run (the builder shares this cache entry).
  const { data: datasets } = useQuery({
    queryKey: ['reporting-datasets'],
    queryFn: async () => (await reportingApi.datasets()).data.datasets,
  });
  // How many schedules follow each saved report (best effort — ignore if the endpoint is unavailable).
  const { data: schedules } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: async () => (await reportSchedulesApi.list()).data,
    retry: false,
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [range, setRange] = useState({ start: '', end: '' });

  const available = useMemo(() => new Set((datasets ?? []).map((d) => d.key)), [datasets]);
  const followers = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of schedules?.schedules ?? []) {
      if (s.saved_report_slug) m.set(s.saved_report_slug, (m.get(s.saved_report_slug) ?? 0) + 1);
    }
    return m;
  }, [schedules]);

  const rowKey = (r: SavedReport) => `${r.slug}:${r.is_mine ? 'm' : 's'}`;

  const download = async (r: SavedReport) => {
    const fmt = r.spec.format ?? 'xlsx';
    setBusy(rowKey(r));
    try {
      const res = await reportingApi.exportReport({
        dataset: r.dataset,
        columns: r.spec.columns ?? [],
        filters: r.spec.filters ?? [],
        logic: r.spec.logic ?? 'AND',
        format: fmt,
      });
      saveBlob(res.data as Blob, `${fileStem(r.name)}-${today()}.${fmt}`);
    } catch (e) {
      toast({ title: 'Download failed', message: await blobErrorMessage(e), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: SavedReport) => {
    setBusy(rowKey(r));
    const n = followers.get(r.slug) ?? 0;
    try {
      await savedReportsApi.remove(r.slug);
      onDeleted?.(r);
      toast({
        title: 'Report deleted',
        message:
          n > 0
            ? `"${r.name}" is gone. ${n} schedule${n === 1 ? '' : 's'} that followed it will fail until re-pointed at another report.`
            : `"${r.name}" was deleted.`,
        type: n > 0 ? 'warning' : 'success',
        duration: n > 0 ? 10000 : undefined,
      });
    } catch (e) {
      toast({ title: 'Could not delete the report', message: apiErrorMessage(e), type: 'error' });
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['saved-reports'] });
      qc.invalidateQueries({ queryKey: ['report-schedules'] });
    }
  };

  const downloadStandard = async (s: StandardReport, fmt: 'csv' | 'xlsx') => {
    const k = `${s.key}:${fmt}`;
    setBusy(k);
    try {
      const res = await s.run(fmt, range);
      saveBlob(res.data as Blob, `${s.key}-${today()}.${fmt}`);
    } catch (e) {
      toast({ title: 'Download failed', message: await blobErrorMessage(e), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const list = reports ?? [];
  const visibleStandard = STANDARD.filter((s) => permsLoading || hasPermission(s.perm));

  return (
    <div className="space-y-4">
      <PanelShell
        icon={Bookmark}
        title="Saved reports"
        description="Report definitions you saved from the builder, plus any a teammate shared. Reopen one to tweak it, download it, or put it on a schedule."
        actions={
          <button onClick={onGoBuilder} className={btnPrimary} style={{ background: ACCENT }}>
            <FolderOpen size={15} /> Open the builder
          </button>
        }
      >
        {isLoading ? (
          <div className="mt-5 flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 size={15} className="animate-spin" /> Loading saved reports…
          </div>
        ) : isError ? (
          <div className="mt-5 flex items-center gap-2 text-sm text-[var(--color-danger)]">
            <AlertCircle size={15} /> {apiErrorMessage(error, 'Could not load saved reports.')}
          </div>
        ) : list.length === 0 ? (
          <EmptyBlock icon={Bookmark} title="No saved reports yet">
            Set up a dataset, columns and filters in the Report builder, then press <strong>Save</strong> to keep it here.
          </EmptyBlock>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
            {list.map((r) => {
              const runnable = !datasets || available.has(r.dataset);
              const rb = busy === rowKey(r);
              const nCols = r.spec.columns?.length ?? 0;
              const nFilters = r.spec.filters?.length ?? 0;
              const nSched = r.is_mine ? followers.get(r.slug) ?? 0 : 0;
              return (
                <li
                  key={rowKey(r)}
                  className="grid gap-3 py-3.5 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--color-text)]">{r.name}</span>
                      {r.is_shared && (
                        <Chip tone="info" title={r.is_mine ? 'Shared with the workspace' : 'Shared with you'}>
                          <Users size={11} /> {r.is_mine ? 'Shared' : 'Shared with you'}
                        </Chip>
                      )}
                      {nSched > 0 && (
                        <Chip tone="muted" title="Scheduled reports that follow this one">
                          <CalendarClock size={11} /> Scheduled ×{nSched}
                        </Chip>
                      )}
                      {!runnable && <Chip tone="warn">Dataset not available</Chip>}
                    </div>
                    <div className="mt-0.5 text-[13px] text-[var(--color-muted)]">
                      {labelize(r.dataset)} · {nCols ? `${nCols} column${nCols === 1 ? '' : 's'}` : 'all columns'} ·{' '}
                      {nFilters} filter{nFilters === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="text-[13px] text-[var(--color-muted)]">Updated {fmtDate(r.updated_at)}</div>
                  <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                    <button onClick={() => onLoad(r)} disabled={!runnable} className={btnRow} title="Load into the Report builder">
                      <FolderOpen size={13} /> Open
                    </button>
                    <button
                      onClick={() => download(r)}
                      disabled={!runnable || rb}
                      className={btnRow}
                      title={`Download as ${(r.spec.format ?? 'xlsx').toUpperCase()}`}
                    >
                      {rb ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}{' '}
                      {(r.spec.format ?? 'xlsx').toUpperCase()}
                    </button>
                    <button onClick={() => onSchedule(r)} disabled={!runnable} className={btnRow} title="Email this report on a schedule">
                      <CalendarClock size={13} /> Schedule
                    </button>
                    {r.is_mine && (
                      <ConfirmButton
                        label="Delete"
                        confirmLabel="Delete report"
                        busy={rb}
                        icon={<Trash2 size={13} />}
                        onConfirm={() => remove(r)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PanelShell>

      {visibleStandard.length > 0 && (
        <PanelShell
          icon={ClipboardList}
          title="Standard exports"
          description="Ready-made audit and compliance extracts. No setup — pick a format and download."
        >
          <ul className="mt-4 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
            {visibleStandard.map((s) => (
              <li
                key={s.key}
                className="grid gap-3 py-3.5 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--color-text)]">{s.title}</div>
                  <div className="mt-0.5 text-[13px] leading-relaxed text-[var(--color-muted)]">{s.blurb}</div>
                </div>
                <div>
                  {s.dateRange && (
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-muted)]">
                      <label className="flex items-center gap-1.5">
                        From
                        <input
                          type="date"
                          value={range.start}
                          max={range.end || undefined}
                          onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
                          className={`${inputCls} w-auto`}
                        />
                      </label>
                      <label className="flex items-center gap-1.5">
                        To
                        <input
                          type="date"
                          value={range.end}
                          min={range.start || undefined}
                          onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
                          className={`${inputCls} w-auto`}
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 lg:justify-end">
                  {(['csv', 'xlsx'] as const).map((fmt) => {
                    const k = `${s.key}:${fmt}`;
                    return (
                      <button key={fmt} onClick={() => downloadStandard(s, fmt)} disabled={busy === k} className={btnRow}>
                        {busy === k ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}{' '}
                        {fmt === 'csv' ? 'CSV' : 'Excel'}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </PanelShell>
      )}
    </div>
  );
}
