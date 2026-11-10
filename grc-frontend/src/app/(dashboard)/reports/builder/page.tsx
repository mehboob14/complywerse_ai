'use client';

// /reports/builder — the report workspace: a report's module, fields, filters, summary and rows on one screen (ReportWorkspace), with Save and Download.
//
// A report has an address:
//   ?id=<saved report>            opens a saved report (the old ?edit=<id> works too; ?drillCol & ?drillValue narrow it to a dashboard chart's category)
//   ?dataset=<module>             starts a new report on that module
//   ?mode=new                     starts a new report that asks for the module first
// The address of an open report is kept (a refresh or a shared link lands on the same report), and a report that was just saved gets its own. This page only finds the report and the module (and says when it
// cannot); the workspace under it does the work: _workspace/. The old single-file builder (_reports/ReportBuilder.tsx, 2,293 lines, six overlays) is gone.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button, EmptyState, ErrorState, NoAccessState, Notice, SkeletonRows } from '@/components/ui/ds';
import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';
import { DATASETS } from '../_reports/datasets';
import type { ReportSpec } from '../_reports/types';
import { emptySpec } from '../_reports/types';
import { listSpecsFull } from '../_reports/savedReports';
import { usePermissions } from '../_reports/usePermissions';
import { NewReportSheet, loadRecent } from '../_library/NewReportSheet';
import { classifySync, failureWords } from '../_library/syncModel';
import { drillNarrow } from './_workspace/builderModel';
import { ReportWorkspace } from './_workspace/ReportWorkspace';

const RECENT_KEY = 'grc.reports.recentDatasets';
function pushRecent(key: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...loadRecent().filter((k) => k !== key)].slice(0, 8)));
  } catch { /* remembering the module is a convenience */ }
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
  const [loaded, setLoaded] = useState<ReportSpec | null>(null);
  /** the report as the server holds it (null for a new one): what "unsaved" is measured against */
  const [stored, setStored] = useState<ReportSpec | null>(null);
  const [nonce, setNonce] = useState(0);
  const [reload, setReload] = useState(0);
  const [chooser, setChooser] = useState(false);
  /** the address asked for a saved report that the server does not show this person */
  const [missing, setMissing] = useState(false);
  /** the saved reports could not be read at all (the person may well have the report) */
  const [unreadable, setUnreadable] = useState<string | null>(null);
  /** a dashboard's click asked for one category, but the report's OR filters cannot be narrowed without changing its meaning: it opened as saved, and says so */
  const [notNarrowed, setNotNarrowed] = useState(false);
  const handled = useRef('');

  const datasets = useMemo(() => DATASETS.filter((d) => canUse(d)), [permsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = datasets.find((d) => d.key === activeKey) ?? null;
  const canAccess = (dsKey: string) => datasets.some((d) => d.key === dsKey);
  const grouped = useMemo(() => {
    const byModule = new Map<string, typeof datasets>();
    datasets.forEach((d) => { byModule.set(d.module, (byModule.get(d.module) ?? []).concat(d)); });
    return Array.from(byModule.entries());
  }, [datasets]);

  // the address -> the report
  useEffect(() => {
    if (!permsLoaded) return;
    const key = searchParams.toString();
    if (handled.current === key && reload === 0) return;                  // the address this page just wrote for itself
    const editId = searchParams.get('id') ?? searchParams.get('edit');
    const dataset = searchParams.get('dataset');
    const modeParam = searchParams.get('mode');
    if (!editId && !dataset && modeParam !== 'build' && modeParam !== 'new') { if (!loaded) setChooser(true); return; }

    let cancelled = false;
    (async () => {
      if (editId) {
        const list = await listSpecsFull();
        if (cancelled) return;
        const found = list.specs.find((x) => x.id === editId);
        if (!found && list.failure) {                                      // not "that report is not there": the list could not be read
          setUnreadable(failureWords(list.failure, 'read the saved reports'));
          setMissing(false);
          return;
        }
        setUnreadable(null);
        const drill = found ? drillNarrow(found, searchParams.get('drillCol'), searchParams.get('drillValue')) : null;
        setMissing(!found);
        setNotNarrowed(!!drill?.refused);
        if (found && drill) {
          setActiveKey(found.dataset);
          setLoaded(drill.spec);
          setStored(found);
          setNonce((n) => n + 1);
          pushRecent(found.dataset);
        }
        handled.current = new URLSearchParams({ id: editId }).toString();  // the report keeps its address; the drill was applied once and is not part of it
        router.replace(`/reports/builder?${handled.current}`, { scroll: false });
      } else if (dataset && datasets.some((d) => d.key === dataset)) {
        setMissing(false); setNotNarrowed(false); setUnreadable(null);
        setActiveKey(dataset);
        setLoaded({ ...emptySpec(dataset), name: '' });
        setStored(null);
        setNonce((n) => n + 1);
        pushRecent(dataset);
        handled.current = key;
      } else {
        setMissing(false); setNotNarrowed(false); setUnreadable(null);
        setActiveKey(undefined);
        setLoaded(null);
        setStored(null);
        setChooser(true);
        handled.current = '';
        router.replace('/reports/builder', { scroll: false });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, permsLoaded, reload]);

  const pick = (key: string) => {
    setChooser(false);
    setMissing(false); setNotNarrowed(false); setUnreadable(null);
    setActiveKey(key);
    setLoaded({ ...emptySpec(key), name: '' });
    setStored(null);
    setNonce((n) => n + 1);
    pushRecent(key);
    handled.current = `dataset=${encodeURIComponent(key)}`;
    router.replace(`/reports/builder?dataset=${encodeURIComponent(key)}`, { scroll: false });
  };
  const startNew = () => { setActiveKey(undefined); setLoaded(null); setStored(null); setMissing(false); setNotNarrowed(false); setChooser(true); handled.current = ''; router.replace('/reports/builder', { scroll: false }); };
  const saved = (spec: ReportSpec) => {
    setStored(spec);
    handled.current = new URLSearchParams({ id: spec.id }).toString();
    router.replace(`/reports/builder?${handled.current}`, { scroll: false });
  };

  const noModules = permsLoaded && datasets.length === 0;
  const refusedReport = !!loaded && !!loaded.id && !!loaded.dataset && !canAccess(loaded.dataset);

  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      {notNarrowed && (
        <Notice tone="info" title="The report opened as it was saved">
          It combines its conditions with OR, so it cannot be narrowed to the category you clicked without changing what it shows. Add the filter yourself if you want that category only.
        </Notice>
      )}
      {missing && (
        <Notice tone="warning" title="That report is not available" action={<Button onClick={startNew}>Start a new report</Button>}>
          It may have been deleted, or its owner has not shared it with you.
        </Notice>
      )}

      {!permsLoaded ? (
        <SkeletonRows rows={6} columns={4} label="Loading the report builder" />
      ) : noModules ? (
        authenticated
          ? <NoAccessState title="No modules to report on" reason="Reports read the modules your role can open. Ask an administrator if you need a register opened." action={<Button href="/reports">Back to the reports</Button>} />
          : <NoAccessState title="Your session is not active" reason="Sign in again to load the report builder for your organisation." action={<Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>} />
      ) : unreadable ? (
        <ErrorState title="The report could not be loaded" message={unreadable} onRetry={() => setReload((n) => n + 1)} />
      ) : refusedReport ? (
        <NoAccessState
          title="You can't open this report's data"
          reason={`“${loaded?.name ?? 'This report'}” reads a module your role cannot open. Ask an administrator, or start a new report.`}
          action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={startNew}>New report</Button>}
        />
      ) : active && loaded ? (
        <ReportWorkspace
          key={`${loaded.id || 'new'}-${active.key}-${nonce}`}
          dataset={active}
          datasets={datasets}
          groupedDatasets={grouped}
          initialSpec={loaded}
          savedSpec={stored}
          onSwitchDataset={pick}
          onNewReport={startNew}
          onSaved={saved}
        />
      ) : (
        <EmptyState
          kind="firstUse"
          title="Choose the module to report on"
          description="A report reads one module's register. You can add fields from other modules afterwards."
          action={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setChooser(true)}>Choose a module</Button>}
        />
      )}

      <NewReportSheet open={chooser} onClose={() => setChooser(false)} datasets={datasets} onPick={pick} />
    </div>
  );
}
