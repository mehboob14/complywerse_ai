'use client';

// /reports/dashboards — saved dashboards built from saved reports.
//
// A dashboard is a grid of tiles; each tile is a saved report drawn as a KPI,
// a chart, or its first rows. Building one is: save reports in the builder,
// then pin them here. Clicking a chart category opens that report narrowed to
// the category, so every number on the page leads to the rows behind it.

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, Check, LayoutDashboard, Loader2, Pencil, Plus, Share2, Trash2, X,
} from 'lucide-react';
import DashboardTileCard from '../_reports/DashboardTile';
import {
  emptyDashboard, listDashboards, moveTile, newTileId, persistDashboard, removeDashboard,
  type DashboardSpec, type DashboardTile, type TileRender,
} from '../_reports/dashboards';
import { listSpecs } from '../_reports/savedReports';
import { datasetByKey } from '../_reports/datasets';
import { CHART_TYPES } from '../_reports/PivotChart';

// Literal class strings: Tailwind only generates classes it can find verbatim
// in source, so a template like `lg:col-span-${n}` would silently do nothing.
const WIDTH_CLASS: Record<DashboardTile['width'], string> = {
  1: 'sm:col-span-1 lg:col-span-1',
  2: 'sm:col-span-2 lg:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
  4: 'sm:col-span-2 lg:col-span-4',
};

const RENDER_OPTIONS: { value: TileRender; label: string }[] = [
  { value: 'kpi', label: 'Number (KPI)' },
  { value: 'table', label: 'Table (first rows)' },
  ...CHART_TYPES.map((c) => ({ value: c.kind as TileRender, label: c.label })),
];

export default function DashboardsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const activeId = searchParams.get('id');

  const { data: dashResult, isLoading } = useQuery({
    queryKey: ['report-dashboards'],
    queryFn: listDashboards,
  });
  const dashboards = useMemo(() => dashResult?.dashboards ?? [], [dashResult]);

  const { data: reportsResult } = useQuery({
    queryKey: ['report-specs-for-dashboards'],
    queryFn: listSpecs,
    staleTime: 30_000,
  });
  const reports = useMemo(() => reportsResult?.specs ?? [], [reportsResult]);

  // The dashboard being viewed, with unsaved edits layered on top.
  const [draft, setDraft] = useState<DashboardSpec | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<'server' | 'local' | null>(null);

  useEffect(() => {
    if (!activeId) { setDraft(null); return; }
    const found = dashboards.find((d) => d.id === activeId);
    if (found) setDraft(found);
  }, [activeId, dashboards]);

  const open = (id: string) => {
    setEditing(false);
    setAdding(false);
    router.push(`/reports/dashboards?id=${encodeURIComponent(id)}`);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ['report-dashboards'] });

  const save = async (next: DashboardSpec) => {
    setSaving(true);
    try {
      const source = await persistDashboard({ ...next, updatedAt: new Date().toISOString() });
      setSavedTo(source);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const d = emptyDashboard('Untitled dashboard');
    await persistDashboard(d);
    await refresh();
    setEditing(true);
    router.push(`/reports/dashboards?id=${encodeURIComponent(d.id)}`);
  };

  const destroy = async () => {
    if (!draft) return;
    if (!window.confirm(`Delete the dashboard "${draft.name}"? The reports it shows are not affected.`)) return;
    await removeDashboard(draft.id);
    await refresh();
    router.push('/reports/dashboards');
  };

  const patch = (p: Partial<DashboardSpec>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchTile = (id: string, p: Partial<DashboardTile>) =>
    setDraft((d) => (d ? { ...d, tiles: d.tiles.map((t) => (t.id === id ? { ...t, ...p } : t)) } : d));

  /** Drill-through: open the report, narrowed to the clicked category. */
  const drill = (reportId: string, narrow?: { col: string; value: string }) => {
    const q = new URLSearchParams({ edit: reportId });
    if (narrow) {
      q.set('drillCol', narrow.col);
      q.set('drillValue', narrow.value);
    }
    router.push(`/reports?${q.toString()}`);
  };

  const canEdit = draft?.mine !== false;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0 flex-col bg-slate-50/60 lg:flex-row">
      {/* ── Dashboard list ───────────────────────────────────────────────── */}
      <aside className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dashboards</p>
          <button
            type="button"
            onClick={create}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-500 px-2 py-1 text-[11px] font-semibold text-[#0a0a0a] hover:bg-primary-600"
          >
            <Plus className="h-3 w-3" /> New
          </button>
        </div>
        {isLoading ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : dashboards.length === 0 ? (
          <p className="mt-3 text-[11px] leading-snug text-slate-500">
            No dashboards yet. A dashboard pins saved reports side by side — save a
            report in <Link href="/reports" className="font-medium text-primary-700 hover:underline">Quick export</Link> first.
          </p>
        ) : (
          <ul className="mt-2 space-y-0.5">
            {dashboards.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => open(d.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                    d.id === activeId ? 'bg-primary-50 font-semibold text-primary-800' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{d.name || 'Untitled dashboard'}</span>
                  {d.shared && <Share2 className="h-3 w-3 shrink-0 text-slate-300" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* ── Canvas ───────────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 px-4 py-4 lg:px-6">
        {!draft ? (
          <div className="flex h-full min-h-[50vh] flex-col items-center justify-center text-center">
            <LayoutDashboard className="h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">
              {activeId && !isLoading ? 'This dashboard is not available' : 'Choose a dashboard'}
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate-500">
              {activeId && !isLoading
                ? 'It may have been deleted, or its owner stopped sharing it.'
                : 'Pick one on the left, or create a new one and pin saved reports to it.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {editing ? (
                <input
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-base font-semibold"
                />
              ) : (
                <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-900">{draft.name}</h1>
              )}

              {savedTo === 'local' && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                  Saved on this device only — the server was unreachable
                </span>
              )}

              {canEdit && editing && (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={!!draft.shared}
                      onChange={(e) => patch({ shared: e.target.checked })}
                    />
                    Share with everyone in the tenant
                  </label>
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add tile
                  </button>
                  <button
                    type="button"
                    onClick={destroy}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => { await save(draft); setEditing(false); }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    Done
                  </button>
                </>
              )}
              {canEdit && !editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              )}
              {!canEdit && (
                <span className="text-[11px] text-slate-400">Shared with you · read-only</span>
              )}
            </div>

            {draft.tiles.length === 0 ? (
              <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-center">
                <p className="text-sm font-semibold text-slate-700">This dashboard is empty</p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Each tile shows one saved report as a number, a chart or a short table.
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => { setEditing(true); setAdding(true); }}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add the first tile
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {draft.tiles.map((t, i) => (
                  <div key={t.id} className={`flex min-h-[14rem] flex-col ${WIDTH_CLASS[t.width]}`}>
                    {editing && (
                      <div className="mb-1 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-1">
                        <select
                          value={t.render}
                          onChange={(e) => patchTile(t.id, { render: e.target.value as TileRender })}
                          className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
                        >
                          {RENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <select
                          value={t.width}
                          onChange={(e) => patchTile(t.id, { width: Number(e.target.value) as DashboardTile['width'] })}
                          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
                          title="Width"
                        >
                          <option value={1}>¼</option>
                          <option value={2}>½</option>
                          <option value={3}>¾</option>
                          <option value={4}>Full</option>
                        </select>
                        <button type="button" disabled={i === 0} onClick={() => patch({ tiles: moveTile(draft.tiles, t.id, -1) })}
                          className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move earlier">
                          <ArrowLeft className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" disabled={i === draft.tiles.length - 1} onClick={() => patch({ tiles: moveTile(draft.tiles, t.id, 1) })}
                          className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="Move later">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => patch({ tiles: draft.tiles.filter((x) => x.id !== t.id) })}
                          className="rounded p-0.5 text-slate-400 hover:text-rose-600" title="Remove tile">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="min-h-0 flex-1">
                      <DashboardTileCard tile={t} onDrill={drill} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {adding && draft && (
        <AddTileDialog
          reports={reports}
          onClose={() => setAdding(false)}
          onAdd={(reportId, render) => {
            patch({
              tiles: [...draft.tiles, {
                id: newTileId(),
                reportId,
                render,
                width: render === 'kpi' ? 1 : 2,
              }],
            });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function AddTileDialog({
  reports, onClose, onAdd,
}: {
  reports: { id: string; name: string; dataset: string; rows?: string[]; measures?: unknown[] }[];
  onClose: () => void;
  onAdd: (reportId: string, render: TileRender) => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [render, setRender] = useState<TileRender>('kpi');

  const shown = reports.filter((r) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const ds = datasetByKey(r.dataset);
    return `${r.name} ${ds?.label ?? ''} ${ds?.module ?? ''}`.toLowerCase().includes(needle);
  });
  const pickedReport = reports.find((r) => r.id === picked);
  // A chart plots a breakdown; say up front when the chosen report has none,
  // rather than adding a tile that can only show "needs a breakdown field".
  const chartWithoutBreakdown = render !== 'kpi' && render !== 'table' && pickedReport && !(pickedReport.rows?.length);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Add a tile</p>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-slate-100 p-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search saved reports…"
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {reports.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-slate-500">
              No saved reports yet. Build and save one in{' '}
              <Link href="/reports" className="font-medium text-primary-700 hover:underline">Quick export</Link>.
            </li>
          ) : shown.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-slate-500">No reports match.</li>
          ) : (
            shown.map((r) => {
              const ds = datasetByKey(r.dataset);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(r.id)}
                    className={`flex w-full flex-col rounded-lg px-3 py-2 text-left ${
                      picked === r.id ? 'bg-primary-50 ring-1 ring-primary-300' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate text-xs font-semibold text-slate-800">{r.name || 'Untitled report'}</span>
                    <span className="truncate text-[11px] text-slate-500">{ds ? `${ds.module} · ${ds.label}` : r.dataset}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <select
            value={render}
            onChange={(e) => setRender(e.target.value as TileRender)}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
          >
            {RENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!picked}
            onClick={() => picked && onAdd(picked, render)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
          {chartWithoutBreakdown && (
            <p className="w-full text-[11px] text-amber-700">
              This report has no breakdown field, so a chart has nothing to plot. Use Number
              or Table, or add a breakdown to the report first.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
