'use client';

// Reports — the dedicated area for building, saving, scheduling and downloading the
// product's reports. Four tabs:
//   Report builder  the custom Report Builder + the SBP regulatory return (the
//                   original page; kept mounted so its state survives tab switches)
//   Saved reports   saved definitions (/reporting/reports) + ready-made audit exports
//   Scheduled       emailed reports on a schedule (/report-schedules)
//   Trends          metric history, change and status vs target (/reporting/trends/*)
// The page title lives in the top bar (Header PAGE_TITLES '/reports'), so the
// body renders only the tab bar and the cards — no second heading.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Landmark, Download, ChevronDown, Search, Loader2, AlertCircle, FileSpreadsheet,
  Table2, Bookmark, CalendarClock, Activity,
  type LucideIcon,
} from 'lucide-react';
import { apiClient, assetsApi } from '@/cyber-assurance/lib/api';
import { useTabParam } from '@/cyber-assurance/lib/useTabParam';
import type {
  BuilderLoadRequest, BuilderSnapshot, SavedReport,
} from '@/cyber-assurance/lib/reportingExtrasApi';
import type { ITAsset } from '@/cyber-assurance/types';
import ReportBuilderCard from './ReportBuilderCard';
import BuilderActions from './BuilderActions';
import SaveReportDialog from './SaveReportDialog';
import SavedReportsPanel from './SavedReportsPanel';
import ScheduledReportsPanel from './ScheduledReportsPanel';
import ScheduleModal, { type ScheduleEditor } from './ScheduleModal';
import TrendsPanel from './TrendsPanel';

const ACCENT = 'var(--color-base)';

// Trigger a browser download of the SBP workbook. assetId omitted → whole tenant;
// present → just that asset's row (backend ?asset_id=).
async function downloadSbp(assetId?: number, label?: string) {
  const res = await apiClient.get('/sbp-inventory/export.xlsx', {
    responseType: 'blob',
    params: assetId != null ? { asset_id: assetId } : undefined,
  });
  const today = new Date().toISOString().slice(0, 10);
  const slug = label ? label.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) : '';
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SBP-Inventory-${slug ? slug + '-' : ''}${today}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── Generic card shell: icon + title + description, right-aligned actions, and
//    an optional summary/footer row. Every report renders through this. ──
function ReportCardShell({
  icon: Icon, title, description, actions, children,
}: {
  icon: LucideIcon;
  title: string; description: string;
  actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg"
            style={{ background: 'var(--color-base-soft)', color: ACCENT }}>
            <Icon size={22} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--color-text)]">{title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-muted)]">{description}</p>
          </div>
        </div>
        {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// ── SBP report card — the one wired report. ──
function SbpReportCard() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['sbp-report-assets'],
    // ponytail: limit 2000 covers any realistic ComplyVerse tenant; bump if one ever exceeds it.
    queryFn: async () => (await assetsApi.getAll({ limit: 2000 })).data,
  });

  const [busy, setBusy] = useState<'all' | number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close the single-asset picker on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [pickerOpen]);

  const run = async (assetId: number | undefined, label: string | undefined, key: 'all' | number) => {
    setBusy(key); setErr(null);
    try {
      await downloadSbp(assetId, label);
      if (key !== 'all') setPickerOpen(false);
    } catch {
      setErr('Download failed — please try again.');
    } finally { setBusy(null); }
  };

  const total = assets?.length ?? 0;
  const filtered = useMemo(() => {
    const list = assets || [];
    const t = q.trim().toLowerCase();
    const matched = t
      ? list.filter((a: ITAsset) =>
          (a.name || '').toLowerCase().includes(t) ||
          (a.ip_address || '').toLowerCase().includes(t) ||
          (a.host_name || '').toLowerCase().includes(t))
      : list;
    return matched.slice(0, 50); // cap the rendered rows; search narrows the rest
  }, [assets, q]);

  const actions = (
    <>
      <button
        onClick={() => run(undefined, undefined, 'all')}
        disabled={busy === 'all'}
        className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-[var(--color-on-base)] disabled:opacity-60"
        style={{ background: ACCENT }}>
        {busy === 'all' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        Download all assets
      </button>
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setPickerOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-subtle)]">
          <Download size={15} /> Download a single asset
          <ChevronDown size={14} className={`transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
        </button>
        {pickerOpen && (
          <div className="absolute right-0 z-50 mt-1.5 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="relative border-b border-[var(--color-border)] p-2">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search assets…"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] py-1.5 pl-7 pr-2 text-sm text-[var(--color-text)] focus:border-[var(--color-base)] focus:outline-none" />
            </div>
            <div className="max-h-64 overflow-y-auto p-1 scrollbar-thin">
              {isLoading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-[var(--color-muted)]">
                  <Loader2 size={14} className="animate-spin" /> Loading assets…
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-[var(--color-muted)]">No matching assets.</div>
              ) : filtered.map((a: ITAsset) => (
                <button key={a.id} onClick={() => run(a.id, a.name, a.id)} disabled={busy === a.id}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-subtle)] disabled:opacity-60">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--color-text)]">{a.name || `Asset ${a.id}`}</span>
                    {(a.ip_address || a.host_name) && (
                      <span className="block truncate text-xs text-[var(--color-muted)]">{a.ip_address || a.host_name}</span>
                    )}
                  </span>
                  {busy === a.id
                    ? <Loader2 size={14} className="flex-none animate-spin text-[var(--color-muted)]" />
                    : <Download size={14} className="flex-none text-[var(--color-muted)]" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <ReportCardShell
      icon={Landmark}
      title="State Bank of Pakistan — Offsite IT Asset Inventory"
      description="The 52-field offsite regulatory return — one row per asset, in the bank's exact .xlsx format. Auto-filled from each asset's scans and vendor patch feeds."
      actions={actions}>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-3 text-[13px]">
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--color-text)]">
          <FileSpreadsheet size={15} style={{ color: ACCENT }} />
          {isLoading ? '…' : total} asset{total === 1 ? '' : 's'} included
        </span>
        <span className="text-[var(--color-muted)]">One row per asset · 52 bank columns</span>
        {err && (
          <span className="inline-flex items-center gap-1 text-[var(--color-danger)]">
            <AlertCircle size={14} /> {err}
          </span>
        )}
      </div>
    </ReportCardShell>
  );
}

// Extra report cards shown under the Report Builder — add another component here to add a
// further regulatory / inventory report.
const BUILDER_TAB_REPORTS: React.ComponentType[] = [SbpReportCard];

const TAB_IDS = ['builder', 'saved', 'scheduled', 'trends'] as const;
type TabId = (typeof TAB_IDS)[number];
const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'builder', label: 'Report builder', icon: Table2 },
  { id: 'saved', label: 'Saved reports', icon: Bookmark },
  { id: 'scheduled', label: 'Scheduled', icon: CalendarClock },
  { id: 'trends', label: 'Trends', icon: Activity },
];

export default function ReportsPage() {
  const [tab, setTab] = useTabParam<TabId>('builder', TAB_IDS);

  // What the Report Builder holds right now (reported by the card) — powers Save / Schedule.
  const [snapshot, setSnapshot] = useState<BuilderSnapshot | null>(null);
  // A definition to push into the builder ("Open" on a saved report).
  const [loadReq, setLoadReq] = useState<BuilderLoadRequest | null>(null);
  // The saved report the builder was last opened from / saved as (so Save can update it).
  const [loadedFrom, setLoadedFrom] = useState<SavedReport | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState<ScheduleEditor | null>(null);
  const nonce = useRef(0);

  const openInBuilder = useCallback(
    (r: SavedReport) => {
      const spec = r.spec ?? {};
      nonce.current += 1;
      setLoadReq({
        nonce: nonce.current,
        snapshot: {
          dataset: r.dataset,
          columns: spec.columns ?? [],
          filters: spec.filters ?? [],
          logic: spec.logic === 'OR' ? 'OR' : 'AND',
          format: spec.format ?? 'csv',
        },
      });
      setLoadedFrom(r);
      setTab('builder');
    },
    [setTab],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className="-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors"
              style={
                active
                  ? { borderColor: 'var(--color-base)', color: 'var(--color-base)' }
                  : { borderColor: 'transparent', color: 'var(--color-muted)' }
              }
            >
              <t.icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Kept mounted (just hidden) so the builder's columns / filters survive a trip to another tab. */}
      <div className={tab === 'builder' ? 'space-y-4' : 'hidden'}>
        <ReportBuilderCard
          load={loadReq}
          onSnapshot={setSnapshot}
          footerExtras={
            <BuilderActions
              snapshot={snapshot}
              onSave={() => setSaveOpen(true)}
              onSchedule={() => snapshot && setScheduleEditor({ mode: 'new', source: { kind: 'inline', snapshot } })}
            />
          }
        />
        {BUILDER_TAB_REPORTS.map((Card, i) => <Card key={i} />)}
      </div>

      {tab === 'saved' && (
        <SavedReportsPanel
          onLoad={openInBuilder}
          onSchedule={(r) => setScheduleEditor({ mode: 'new', source: { kind: 'saved', slug: r.slug, name: r.name } })}
          onGoBuilder={() => setTab('builder')}
          onDeleted={(r) =>
            setLoadedFrom((cur) => (cur && cur.slug === r.slug && cur.is_mine === r.is_mine ? null : cur))
          }
        />
      )}
      {tab === 'scheduled' && (
        <ScheduledReportsPanel
          onNew={() => setScheduleEditor({ mode: 'new' })}
          onEdit={(s) => setScheduleEditor({ mode: 'edit', schedule: s })}
        />
      )}
      {tab === 'trends' && <TrendsPanel />}

      <SaveReportDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        snapshot={snapshot}
        loadedFrom={loadedFrom}
        onSaved={setLoadedFrom}
      />
      <ScheduleModal editor={scheduleEditor} onClose={() => setScheduleEditor(null)} />
    </div>
  );
}
