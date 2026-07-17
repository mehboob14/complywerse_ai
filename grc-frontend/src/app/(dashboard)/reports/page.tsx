'use client';

// /reports — the built-in reporting workspace.
//   Explore : pick a module dataset and slice it with the interactive grid.
//   Build   : compose a pivot/chart report from any dataset, save and share it.
//
// Datasets are permission-gated with the same strings their own nav entry uses,
// so Reports can never become a side door onto a module a user can't open.
// New datasets are added in _reports/datasets.ts; templates in reportTemplates.ts.

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, LayoutGrid, Lock, Plus, Sparkles, Table2, Trash2, Users } from 'lucide-react';
import { DATASETS } from './_reports/datasets';
import ReportGrid from './_reports/ReportGrid';
import ReportBuilder from './_reports/ReportBuilder';
import type { ReportSpec } from './_reports/types';
import { listSpecs, removeSpec, type SpecSource } from './_reports/savedReports';
import { REPORT_TEMPLATES, TEMPLATE_CATEGORIES, specFromTemplate } from './_reports/reportTemplates';
import { usePermissions } from './_reports/usePermissions';

type Mode = 'explore' | 'build';

export default function ReportsPage() {
  const { loaded: permsLoaded, can } = usePermissions();
  const [mode, setMode] = useState<Mode>('explore');
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  const [specs, setSpecs] = useState<ReportSpec[]>([]);
  const [source, setSource] = useState<SpecSource>('server');
  const [loaded, setLoaded] = useState<ReportSpec | null>(null);

  // Only datasets the user is allowed to see.
  const datasets = useMemo(() => DATASETS.filter((d) => can(d.permissions)), [permsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const templates = useMemo(
    () => REPORT_TEMPLATES.filter((t) => datasets.some((d) => d.key === t.dataset)),
    [datasets],
  );
  const active = datasets.find((d) => d.key === activeKey) || datasets[0];

  // Default to the first permitted dataset once permissions resolve.
  useEffect(() => { if (permsLoaded && !activeKey && datasets[0]) setActiveKey(datasets[0].key); }, [permsLoaded, activeKey, datasets]);

  const refreshSpecs = () => { listSpecs().then((r) => { setSpecs(r.specs); setSource(r.source); }); };
  useEffect(() => { refreshSpecs(); }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof datasets>();
    for (const d of datasets) { if (!m.has(d.module)) m.set(d.module, []); m.get(d.module)!.push(d); }
    return Array.from(m.entries());
  }, [datasets]);

  // A monotonically-increasing nonce forces the builder to remount on every
  // "New report" / template open, even when loaded?.id doesn't change (e.g. two
  // blank reports, or re-clicking the same template) — otherwise stale edits persist.
  const [builderNonce, setBuilderNonce] = useState(0);
  const canAccess = (dsKey: string) => datasets.some((d) => d.key === dsKey);

  const pickDataset = (key: string) => { setActiveKey(key); setLoaded(null); setBuilderNonce((n) => n + 1); };
  const openSpec = (s: ReportSpec) => { setActiveKey(s.dataset); setLoaded(s); setMode('build'); setBuilderNonce((n) => n + 1); };
  const newReport = () => { setLoaded(null); setMode('build'); setBuilderNonce((n) => n + 1); };
  const dropSpec = async (id: string) => { await removeSpec(id); if (loaded?.id === id) setLoaded(null); refreshSpecs(); };

  const seg = (on: boolean) => `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${on ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`;

  // Permission-gated to nothing: say so plainly rather than showing an empty shell.
  if (permsLoaded && datasets.length === 0) {
    return (
      <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col items-center justify-center text-center">
        <Lock className="h-8 w-8 text-slate-300" />
        <h1 className="mt-3 text-lg font-semibold text-slate-800">No reportable data</h1>
        <p className="mt-1 max-w-sm text-sm text-slate-500">Reports mirror your module access, and you don’t currently have access to a module that can be reported on. Ask an administrator if you think this is wrong.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <BarChart3 className="h-6 w-6 text-primary-700" strokeWidth={1.9} /> Reports
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {mode === 'explore'
              ? 'Interactive reports across every module — filter, sort, save and export.'
              : 'Build a report: drop fields into rows, columns and values, then read it as a table or chart.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button onClick={() => setMode('explore')} className={seg(mode === 'explore')}><Table2 className="h-3.5 w-3.5" /> Explore</button>
            <button onClick={() => setMode('build')} className={seg(mode === 'build')}><LayoutGrid className="h-3.5 w-3.5" /> Build</button>
          </div>
          <select value={activeKey ?? ''} onChange={(e) => pickDataset(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium lg:hidden">
            {datasets.map((d) => <option key={d.key} value={d.key}>{d.module} · {d.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left rail — saved reports, templates, then module → dataset */}
        <aside className="hidden w-60 flex-shrink-0 overflow-auto rounded-xl border border-slate-200 bg-white p-2 lg:block">
          <div className="mb-3">
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Saved reports</span>
              <button onClick={newReport} title="New report" className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-primary-700"><Plus className="h-3.5 w-3.5" /></button>
            </div>
            {specs.length === 0 ? (
              <p className="px-2 py-1 text-[11px] leading-snug text-slate-400">None yet — start from a template below, or build one.</p>
            ) : specs.map((s) => (
              <div key={s.id} className={`group mb-0.5 flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${loaded?.id === s.id && mode === 'build' ? 'bg-primary-50' : 'hover:bg-slate-50'}`}>
                <button onClick={() => openSpec(s)} className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm ${loaded?.id === s.id && mode === 'build' ? 'font-semibold text-primary-700' : 'text-slate-700'}`}>
                  <span className="min-w-0 flex-1 truncate">{s.name || 'Untitled report'}</span>
                  {s.shared && <Users className="h-3 w-3 shrink-0 text-slate-400" aria-label="Shared" />}
                </button>
                {s.mine !== false && (
                  <button onClick={() => dropSpec(s.id)} aria-label={`Delete ${s.name}`} className="rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {source === 'local' && specs.length > 0 && (
              <p className="px-2 pt-1 text-[10px] leading-snug text-amber-600">Saved on this device only — sharing needs the backend restarted.</p>
            )}
          </div>

          {/* Templates — real builder specs, editable once opened. */}
          {templates.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center gap-1 px-2 pb-1">
                <Sparkles className="h-3 w-3 text-slate-400" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Templates</span>
              </div>
              {TEMPLATE_CATEGORIES.map((cat) => {
                const list = templates.filter((t) => t.category === cat);
                if (!list.length) return null;
                return (
                  <div key={cat} className="mb-1.5">
                    <div className="px-2 pb-0.5 text-[10px] font-medium text-slate-400">{cat}</div>
                    {list.map((t) => (
                      <button key={t.id} onClick={() => openSpec(specFromTemplate(t))} title={t.description}
                        className="mb-0.5 block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 hover:text-primary-700">
                        {t.name}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {grouped.map(([mod, list]) => (
            <div key={mod} className="mb-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{mod}</div>
              {list.map((d) => (
                <button
                  key={d.key}
                  onClick={() => pickDataset(d.key)}
                  className={`mb-0.5 flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm ${
                    d.key === active?.key && !(mode === 'build' && loaded) ? 'bg-primary-50 font-semibold text-primary-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Main */}
        <main className="flex min-h-0 flex-1 flex-col">
          {!active ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
          ) : mode === 'explore' ? (
            <>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-slate-900">{active.label}</h2>
                {active.description && <p className="text-xs text-slate-500">{active.description}</p>}
              </div>
              <ReportGrid key={active.key} dataset={active} />
            </>
          ) : loaded && !canAccess(loaded.dataset) ? (
            // A shared report can reference a dataset this user can't open.
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <Lock className="h-8 w-8 text-slate-300" />
              <h2 className="mt-3 text-lg font-semibold text-slate-800">You don’t have access to this report’s data</h2>
              <p className="mt-1 max-w-sm text-sm text-slate-500">“{loaded.name}” reports on a module you can’t currently open. Ask an administrator for access, or pick another report.</p>
            </div>
          ) : (
            <ReportBuilder
              key={`${loaded?.id ?? 'new'}-${builderNonce}`}
              dataset={active}
              initialSpec={loaded && loaded.dataset === active.key ? loaded : null}
              onSavedChange={refreshSpecs}
            />
          )}
        </main>
      </div>
    </div>
  );
}
