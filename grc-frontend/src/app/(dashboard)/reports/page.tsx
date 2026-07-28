'use client';

// /reports — full-width report workspace. Dataset + fields open on click as popups.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Bookmark, Lock, Plus } from 'lucide-react';
import { DATASETS } from './_reports/datasets';
import ReportBuilder from './_reports/ReportBuilder';
import type { ReportSpec } from './_reports/types';
import { emptySpec } from './_reports/types';
import { listSpecs } from './_reports/savedReports';
import { usePermissions } from './_reports/usePermissions';

const RECENT_KEY = 'grc.reports.recentDatasets';

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(key: string) {
  try {
    const next = [key, ...loadRecent().filter((k) => k !== key)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export default function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loaded: permsLoaded, authenticated, can } = usePermissions();
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  /** True after "New report" — no module pre-selected until user adds data. */
  const [blankEmpty, setBlankEmpty] = useState(false);
  const [loaded, setLoaded] = useState<ReportSpec | null>(null);
  const [builderNonce, setBuilderNonce] = useState(0);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);

  const datasets = useMemo(() => DATASETS.filter((d) => can(d.permissions)), [permsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = datasets.find((d) => d.key === activeKey) ?? null;

  useEffect(() => {
    setRecentKeys(loadRecent());
  }, []);

  // Default to first dataset only when not intentionally starting blank.
  useEffect(() => {
    if (permsLoaded && !activeKey && !blankEmpty && datasets[0]) {
      setActiveKey(datasets[0].key);
    }
  }, [permsLoaded, activeKey, blankEmpty, datasets]);

  useEffect(() => {
    const editId = searchParams.get('edit');
    const modeParam = searchParams.get('mode');
    if (!editId && modeParam !== 'build' && modeParam !== 'new') return;

    let cancelled = false;
    (async () => {
      if (editId) {
        const { specs: all } = await listSpecs();
        if (cancelled) return;
        const s = all.find((x) => x.id === editId);
        if (s) {
          setBlankEmpty(false);
          setActiveKey(s.dataset);
          setLoaded(s);
          setBuilderNonce((n) => n + 1);
          pushRecent(s.dataset);
          setRecentKeys(loadRecent());
        }
      } else {
        // ?mode=new / build → blank empty report
        setBlankEmpty(true);
        setActiveKey(undefined);
        setLoaded({ ...emptySpec(''), name: '' });
        setBuilderNonce((n) => n + 1);
      }
      router.replace('/reports', { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof datasets>();
    for (const d of datasets) {
      if (!m.has(d.module)) m.set(d.module, []);
      m.get(d.module)!.push(d);
    }
    return Array.from(m.entries());
  }, [datasets]);

  const recentDatasets = useMemo(
    () => recentKeys.map((k) => datasets.find((d) => d.key === k)).filter(Boolean) as typeof datasets,
    [recentKeys, datasets],
  );

  const canAccess = (dsKey: string) => datasets.some((d) => d.key === dsKey);

  const pickDataset = (key: string, seedColumns?: string[]) => {
    setBlankEmpty(false);
    setActiveKey(key);
    pushRecent(key);
    setRecentKeys(loadRecent());
    setLoaded({
      ...emptySpec(key),
      name: '',
      visibleColumns: seedColumns ?? [],
    });
    setBuilderNonce((n) => n + 1);
  };

  const newEmptyReport = () => {
    setBlankEmpty(true);
    setActiveKey(undefined);
    setLoaded({ ...emptySpec(''), name: '' });
    setBuilderNonce((n) => n + 1);
  };

  if (permsLoaded && datasets.length === 0) {
    // Distinguish a dropped/expired session (fix: sign in again) from a genuine
    // access gap (fix: ask an admin) — otherwise a logged-out state misreads as
    // "no permissions", which is what makes this look broken after a restart.
    const sessionLost = !authenticated;
    return (
      <div className="-m-4 flex h-[calc(100dvh-3rem)] min-h-0 min-w-0 flex-col items-center justify-center overflow-hidden p-4 text-center lg:-m-5 lg:p-5">
        <Lock className="h-8 w-8 text-slate-300" />
        <h1 className="mt-3 text-lg font-semibold text-slate-800">
          {sessionLost ? 'Session not active' : 'No reportable data'}
        </h1>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          {sessionLost
            ? 'Your session isn’t active right now — please sign in again to load your reports.'
            : 'Reports mirror your module access. Ask an administrator if you need access to a module.'}
        </p>
        {sessionLost && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-600"
          >
            Reload
          </button>
        )}
      </div>
    );
  }

  const showBlank = blankEmpty;

  return (
    <div className="-m-4 flex h-[calc(100dvh-3rem)] min-h-0 min-w-0 flex-col overflow-hidden bg-[#f4f7f6] p-2.5 lg:-m-5 lg:p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-2 text-[1.15rem] font-bold tracking-tight text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/15 text-primary-800">
              <BarChart3 className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="truncate">Reports</span>
          </h1>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Link
            href="/reports/saved"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
            title="Manage saved reports"
          >
            <Bookmark className="h-3.5 w-3.5" /> Saved
          </Link>
          <button
            type="button"
            onClick={newEmptyReport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-600"
          >
            <Plus className="h-3.5 w-3.5" /> New report
          </button>
        </div>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {!permsLoaded || (!showBlank && !active) ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>
        ) : loaded && loaded.id && loaded.dataset && !canAccess(loaded.dataset) ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <Lock className="h-8 w-8 text-slate-300" />
            <h2 className="mt-3 text-lg font-semibold text-slate-800">You don’t have access to this report’s data</h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              “{loaded.name}” reports on a module you can’t currently open. Ask an administrator for access, or pick another report.
            </p>
          </div>
        ) : (
          <ReportBuilder
            key={`${loaded?.id ?? 'new'}-${active?.key ?? 'blank'}-${builderNonce}`}
            dataset={showBlank ? null : active}
            datasets={datasets}
            groupedDatasets={grouped}
            recentDatasets={recentDatasets}
            onDatasetChange={pickDataset}
            initialSpec={
              showBlank
                ? { ...emptySpec(''), name: loaded?.name || '' }
                : loaded && loaded.dataset === active!.key
                  ? loaded
                  : { ...emptySpec(active!.key), name: '', visibleColumns: loaded?.visibleColumns }
            }
          />
        )}
      </main>
    </div>
  );
}
