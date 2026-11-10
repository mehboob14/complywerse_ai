'use client';

// /reports/builder — the report builder: pick a module register, shape columns/filters, export.
//
// This is the page /reports used to be (the library took /reports over: saved reports as a facet explorer). A report has an address now:
//   ?id=<saved report>            opens a saved report (the old ?edit=<id> works too; ?drillCol & ?drillValue narrow it to a dashboard chart's category)
//   ?dataset=<module>             starts a new report on that module
//   ?mode=new                     starts a new report that asks for the module first
// The address of an open report is kept (a refresh or a shared link lands on the same report). NOTE for the builder group: only the page around ReportBuilder was
// touched here (where it is, how it is opened, its top strip); ReportBuilder itself is as it was.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Plus, Sparkles } from 'lucide-react';
import { Button, Notice } from '@/components/ui/ds';
import { DATASETS } from '../_reports/datasets';
import ReportBuilder from '../_reports/ReportBuilder';
import type { ReportSpec } from '../_reports/types';
import { emptySpec } from '../_reports/types';
import { listSpecs } from '../_reports/savedReports';
import { usePermissions } from '../_reports/usePermissions';
import { EMPTY_TOKEN, encodeMultiValue } from '../_reports/filter-utils';
import { isActiveCondition } from '../_reports/grid-utils';
import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';

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

// the builder has no sidebar entry of its own: it needs what the Reports library needs
export default function GuardedBuilderPage() {
  return <PermissionGuard required={navPermissions('/reports')}><BuilderPage /></PermissionGuard>;
}

function BuilderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loaded: permsLoaded, authenticated, canUse } = usePermissions();
  const [activeKey, setActiveKey] = useState<string | undefined>(undefined);
  /** Start blank — user chooses any module; no default dataset. */
  const [blankEmpty, setBlankEmpty] = useState(true);
  const [loaded, setLoaded] = useState<ReportSpec | null>(null);
  const [builderNonce, setBuilderNonce] = useState(0);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  /** the address asked for a saved report that the server does not show this person */
  const [missing, setMissing] = useState(false);
  /** a dashboard's click asked for one category, but the report's OR filters cannot be narrowed without changing its meaning: it opened as saved, and says so */
  const [notNarrowed, setNotNarrowed] = useState(false);
  const handled = useRef('');

  const datasets = useMemo(() => DATASETS.filter((d) => canUse(d)), [permsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = datasets.find((d) => d.key === activeKey) ?? null;

  useEffect(() => {
    setRecentKeys(loadRecent());
  }, []);

  useEffect(() => {
    if (!permsLoaded) return;
    const key = searchParams.toString();
    if (handled.current === key) return;                                   // the address this page just wrote for itself
    const editId = searchParams.get('id') ?? searchParams.get('edit');
    const dataset = searchParams.get('dataset');
    const modeParam = searchParams.get('mode');
    if (!editId && !dataset && modeParam !== 'build' && modeParam !== 'new') return;

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
        setMissing(!s);
        setNotNarrowed(!!found && !canNarrow && !!drillCol && drillValue != null);
        if (s) {
          setBlankEmpty(false);
          setActiveKey(s.dataset);
          setLoaded(s);
          setBuilderNonce((n) => n + 1);
          pushRecent(s.dataset);
          setRecentKeys(loadRecent());
        }
        // the report keeps its address; the drill was applied once and is not part of it
        const next = new URLSearchParams({ id: editId }).toString();
        handled.current = next;
        router.replace(`/reports/builder?${next}`, { scroll: false });
      } else if (dataset && datasets.some((d) => d.key === dataset)) {
        setMissing(false);setNotNarrowed(false);
        setBlankEmpty(false);
        setActiveKey(dataset);
        pushRecent(dataset);
        setRecentKeys(loadRecent());
        setLoaded({ ...emptySpec(dataset), name: '' });
        setBuilderNonce((n) => n + 1);
        handled.current = '';
        router.replace('/reports/builder', { scroll: false });
      } else {
        setMissing(false);setNotNarrowed(false);
        setBlankEmpty(true);
        setActiveKey(undefined);
        setLoaded({ ...emptySpec(''), name: '' });
        setBuilderNonce((n) => n + 1);
        handled.current = '';
        router.replace('/reports/builder', { scroll: false });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, permsLoaded]);

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
    setMissing(false);setNotNarrowed(false);
    setBlankEmpty(true);
    setActiveKey(undefined);
    setLoaded({ ...emptySpec(''), name: '' });
    setBuilderNonce((n) => n + 1);
  };

  if (permsLoaded && datasets.length === 0) {
    const sessionLost = !authenticated;
    return (
      <div className="flex min-h-[calc(100dvh-4rem)] flex-col items-center justify-center px-[24px] text-center">
        <span aria-hidden className="grid h-[56px] w-[56px] place-items-center rounded-ds-card bg-ds-surface-hover text-ds-fg-muted"><Lock className="h-[24px] w-[24px]" /></span>
        <p className="mt-[16px] text-ds-title font-[600] text-ds-fg">{sessionLost ? 'Session not active' : 'No modules to report on'}</p>
        <p className="mt-[8px] max-w-md text-ds-body text-ds-fg-muted">
          {sessionLost
            ? 'Sign in again to load the report builder for your organisation.'
            : 'Reports mirror your module access. Ask an administrator if you need a register opened.'}
        </p>
        {sessionLost && <Button className="mt-[20px]" variant="primary" onClick={() => window.location.reload()}>Reload</Button>}
      </div>
    );
  }

  const showBlank = blankEmpty;

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col bg-ds-surface">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-[8px] border-b border-ds-border px-[16px] py-[8px] lg:px-[24px]">
        <Button href="/reports" variant="ghost">Back to the reports</Button>
        <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={newEmptyReport}>New report</Button>
      </div>
      {notNarrowed && (
        <div className="px-[16px] pt-[12px] lg:px-[24px]">
          <Notice tone="info" title="The report opened as it was saved">
            It combines its conditions with OR, so it cannot be narrowed to the category you clicked without changing what it shows. Add the filter yourself if you want that category only.
          </Notice>
        </div>
      )}
      {missing && (
        <div className="px-[16px] pt-[12px] lg:px-[24px]">
          <Notice tone="warning" title="That report is not available" action={<Button onClick={newEmptyReport}>Start a new report</Button>}>
            It may have been deleted, or its owner has not shared it with you.
          </Notice>
        </div>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!permsLoaded ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-[8px] text-ds-body text-ds-fg-muted">
            <Sparkles aria-hidden className="h-[20px] w-[20px] animate-pulse" />
            Loading modules…
          </div>
        ) : loaded && loaded.id && loaded.dataset && !canAccess(loaded.dataset) ? (
          <div className="flex flex-1 flex-col items-center justify-center px-[24px] text-center">
            <Lock aria-hidden className="h-[32px] w-[32px] text-ds-fg-muted" />
            <p className="mt-[12px] text-ds-section font-[600] text-ds-fg">You don’t have access to this report’s data</p>
            <p className="mt-[4px] max-w-sm text-ds-body text-ds-fg-muted">
              “{loaded.name}” reads a module you can’t open. Ask an administrator, or start a new report.
            </p>
            <Button className="mt-[16px]" variant="primary" leftIcon={<Plus aria-hidden />} onClick={newEmptyReport}>New report</Button>
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
