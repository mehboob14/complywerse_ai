'use client';

// /reports — Quick export: pick a module register, shape columns/filters, export.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Bookmark,
  LayoutDashboard,
  Lock,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { DATASETS } from './_reports/datasets';
import ReportBuilder from './_reports/ReportBuilder';
import type { ReportSpec } from './_reports/types';
import { emptySpec } from './_reports/types';
import { listSpecs } from './_reports/savedReports';
import { usePermissions } from './_reports/usePermissions';
import { EMPTY_TOKEN, encodeMultiValue } from './_reports/filter-utils';
import { isActiveCondition } from './_reports/grid-utils';

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
  const { loaded: permsLoaded, authenticated, canUse } = usePermissions();
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  /** Start blank — user chooses any module; no default dataset. */
  const [blankEmpty, setBlankEmpty] = useState(true);
  const [loaded, setLoaded] = useState<ReportSpec | null>(null);
  const [builderNonce, setBuilderNonce] = useState(0);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);

  const datasets = useMemo(() => DATASETS.filter((d) => canUse(d)), [permsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = datasets.find((d) => d.key === activeKey) ?? null;

  useEffect(() => {
    setRecentKeys(loadRecent());
  }, []);

  // Do not auto-pick a module — Quick export is always user-driven.

  useEffect(() => {
    const editId = searchParams.get('edit');
    const modeParam = searchParams.get('mode');
    if (!editId && modeParam !== 'build' && modeParam !== 'new') return;

    let cancelled = false;
    (async () => {
      if (editId) {
        const { specs: all } = await listSpecs();
        if (cancelled) return;
        const found = all.find((x) => x.id === editId);
        // Dashboard drill-through: open the report narrowed to the category the
        // viewer clicked. Added as an ordinary filter condition on a copy of
        // the spec, so it is visible, removable, and never saved back unless
        // the user chooses to save.
        const drillCol = searchParams.get('drillCol');
        const drillValue = searchParams.get('drillValue');
        // The filter model is one flat AND/OR list, so it cannot say
        // "(A OR B) AND category". Narrowing an OR report would silently turn
        // it into A AND B AND category — a different, smaller set. Only narrow
        // when AND semantics already hold; otherwise open the report as saved.
        const canNarrow = !!found && (
          found.rules.logic === 'AND'
          || found.rules.conditions.filter(isActiveCondition).length <= 1
        );
        const s = found && canNarrow && drillCol && drillValue != null
          ? {
              ...found,
              rules: {
                ...found.rules,
                logic: 'AND' as const,
                conditions: [
                  ...found.rules.conditions,
                  {
                    id: `drill_${Date.now().toString(36)}`,
                    col: drillCol,
                    op: 'in',
                    // The pivot labels a blank group "—"; the filter spells
                    // blank as EMPTY_TOKEN, so translate rather than matching
                    // a literal dash that no row contains.
                    value: encodeMultiValue([drillValue === '—' ? EMPTY_TOKEN : drillValue]),
                  },
                ],
              },
            }
          : found;
        if (s) {
          setBlankEmpty(false);
          setActiveKey(s.dataset);
          setLoaded(s);
          setBuilderNonce((n) => n + 1);
          pushRecent(s.dataset);
          setRecentKeys(loadRecent());
        }
      } else {
        setBlankEmpty(true);
        setActiveKey(undefined);
        setLoaded({ ...emptySpec(''), name: '' });
        setBuilderNonce((n) => n + 1);
      }
    })();
    router.replace('/reports', { scroll: false });
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

  const loadSavedSpec = (s: ReportSpec) => {
    setBlankEmpty(false);
    setActiveKey(s.dataset);
    setLoaded(s);
    setBuilderNonce((n) => n + 1);
    pushRecent(s.dataset);
    setRecentKeys(loadRecent());
  };

  const newEmptyReport = () => {
    setBlankEmpty(true);
    setActiveKey(undefined);
    setLoaded({ ...emptySpec(''), name: '' });
    setBuilderNonce((n) => n + 1);
  };

  if (permsLoaded && datasets.length === 0) {
    const sessionLost = !authenticated;
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Lock className="h-6 w-6 text-slate-400" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900">
          {sessionLost ? 'Session not active' : 'No exportable modules'}
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          {sessionLost
            ? 'Sign in again to load Quick export for your tenant.'
            : 'Quick export mirrors your module access. Ask an administrator if you need a register opened.'}
        </p>
        {sessionLost && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-600"
          >
            Reload
          </button>
        )}
      </div>
    );
  }

  const showBlank = blankEmpty;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col bg-white">
      {/* Actions sit under the app Header — no duplicate title / blurb */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-100 px-4 py-2 lg:px-6">
        <Link
          href="/reports/analytics"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <LayoutDashboard className="h-3.5 w-3.5 text-slate-400" />
          Analytics
        </Link>
        <Link
          href="/reports/dashboards"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <LayoutDashboard className="h-3.5 w-3.5 text-slate-400" />
          Dashboards
        </Link>
        <Link
          href="/reports/trends"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
          Trends
        </Link>
        <Link
          href="/reports/saved"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <Bookmark className="h-3.5 w-3.5 text-slate-400" />
          Saved exports
        </Link>
        <button
          type="button"
          onClick={newEmptyReport}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600"
        >
          <Plus className="h-3.5 w-3.5" />
          New export
        </button>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!permsLoaded ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-slate-400">
            <Sparkles className="h-5 w-5 animate-pulse text-primary-500/60" />
            Loading modules…
          </div>
        ) : loaded && loaded.id && loaded.dataset && !canAccess(loaded.dataset) ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <Lock className="h-8 w-8 text-slate-300" />
            <h2 className="mt-3 text-lg font-semibold text-slate-800">
              You don’t have access to this export’s data
            </h2>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              “{loaded.name}” uses a module you can’t open. Ask an administrator, or start a new export.
            </p>
            <button
              type="button"
              onClick={newEmptyReport}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600"
            >
              <Plus className="h-3.5 w-3.5" /> New export
            </button>
          </div>
        ) : (
          <ReportBuilder
            key={`${loaded?.id ?? 'new'}-${active?.key ?? 'blank'}-${builderNonce}`}
            dataset={showBlank || !active ? null : active}
            datasets={datasets}
            groupedDatasets={grouped}
            recentDatasets={recentDatasets}
            onDatasetChange={pickDataset}
            onLoadSpec={loadSavedSpec}
            initialSpec={
              showBlank || !active
                ? { ...emptySpec(''), name: loaded?.name || '' }
                : loaded && loaded.dataset === active.key
                  ? loaded
                  : { ...emptySpec(active.key), name: '', visibleColumns: loaded?.visibleColumns }
            }
          />
        )}
      </main>
    </div>
  );
}
