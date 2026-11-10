'use client';

/**
 * Dashboards: saved reports side by side. VIEW first: the dashboard is its tiles, with Edit for the person who owns it. Editing is explicit: the Edit button turns the tiles into editable ones
 * (rename, share, add, move, remove, a Sheet for each tile's settings), the Save bar says "Unsaved changes" and offers Save and Discard, and leaving with unsaved edits asks first. Nothing is
 * saved until Save; a save the server does not take is said on the bar and the edits stay. A tile that cannot draw says why (dashboardModel.ts, DashboardTile). The deep link ?id=<dashboard> works
 * as it always did. The reports behind the tiles come from ONE list of the person's reports (the library's), not a request per tile.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, LayoutDashboard, Pencil, Plus, RotateCw, Settings2, Trash2, X } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, IconButton, Notice, SaveBar, Select, SkeletonRows, StatusPill, TextInput, useConfirm, useReportedMutation,
} from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { reportSync, reportVisibility } from '@/lib/statuses/reports';
import DashboardTileCard from '../../_reports/DashboardTile';
import {
  dashboardState, dropDashboard, dropLocalDashboard, emptyDashboard, listDashboards, newTileId, retryDashboard, saveDashboard, type DashboardSpec, type DashboardTile,
} from '../../_reports/dashboards';
import { DATASETS } from '../../_reports/datasets';
import { listSpecsFull } from '../../_reports/savedReports';
import type { ReportSpec } from '../../_reports/types';
import { usePermissions } from '../../_reports/usePermissions';
import { DASH_KEY, REPORTS_KEY } from '../keys';
import { drillHref } from '../libraryAddress';
import { deviceLine, failureWords, classifySync } from '../syncModel';
import { AddTileSheet, TileSheet, type TilePatch } from './TileSheets';
import { UNTITLED, dashboardDirty, defaultWidth, moveTile, nameProblem, patchTile, removeTile } from './dashboardModel';

export const TITLE = 'Dashboards';
const INFO = 'A dashboard shows saved reports side by side, each as a number, a chart or a short table. Click a tile to open its report.';

// Literal class strings: Tailwind only generates classes it can find verbatim in source, so a template like `lg:col-span-${n}` would silently do nothing.
const WIDTH_CLASS: Record<DashboardTile['width'], string> = {
  1: 'sm:col-span-1 lg:col-span-1',
  2: 'sm:col-span-2 lg:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
  4: 'sm:col-span-2 lg:col-span-4',
};

export function DashboardsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const activeId = searchParams.get('id');

  const { loaded: permsLoaded, canUse } = usePermissions();
  const openKeys = useMemo(() => new Set(DATASETS.filter((d) => canUse(d)).map((d) => d.key)), [permsLoaded]);        // eslint-disable-line react-hooks/exhaustive-deps
  const dashQ = useQuery({ queryKey: DASH_KEY, queryFn: listDashboards });
  const reportsQ = useQuery({ queryKey: REPORTS_KEY, queryFn: listSpecsFull, staleTime: 30_000 });
  const list = dashQ.data;
  const dashboards = useMemo(() => list?.dashboards ?? [], [list]);
  const saved = useMemo(() => dashboards.find((d) => d.id === activeId) ?? null, [dashboards, activeId]);
  const specs = useMemo(() => {
    const byId = new Map<string, ReportSpec>();
    (reportsQ.data?.specs ?? []).forEach((s) => { const have = byId.get(s.id); if (!have || (have.mine === false && s.mine !== false)) byId.set(s.id, s); });         // the server prefers the person's own copy
    return byId;
  }, [reportsQ.data]);

  const [draft, setDraft] = useState<DashboardSpec | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tileId, setTileId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const openInEdit = useRef<string | null>(null);                                                // a dashboard just made opens ready to fill
  useEffect(() => { setDraft((d) => (!editing || !d || d.id !== saved?.id ? saved : d)); }, [saved, editing]);
  useEffect(() => { setEditing(!!activeId && openInEdit.current === activeId); openInEdit.current = null; setSaveError(null); }, [activeId]);        // another dashboard (a link, Back): the edits of this one are not carried over
  const dirty = editing && dashboardDirty(saved, draft);
  const canEdit = saved?.mine !== false;
  const state = saved && list ? dashboardState(list, saved.id) : 'synced';

  // a dashboard is open: the first one, when the address names none (view first)
  useEffect(() => {
    if (!activeId && dashboards.length > 0) router.replace(`/reports/dashboards?id=${encodeURIComponent(dashboards[0].id)}`);
  }, [activeId, dashboards, router]);

  // closing the tab with unsaved edits asks first
  useEffect(() => {
    if (!dirty) return undefined;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);

  const refresh = () => { void qc.invalidateQueries({ queryKey: DASH_KEY }); };
  const discardAsk = useCallback(async () => {
    if (!dirty) return true;
    return confirm({ title: 'Discard your changes?', message: 'The changes you made to this dashboard have not been saved.', confirmLabel: 'Discard changes', tone: 'danger' });
  }, [dirty, confirm]);
  const goTo = async (id: string) => { if (await discardAsk()) router.push(`/reports/dashboards?id=${encodeURIComponent(id)}`); };

  const save = useReportedMutation({
    mutationFn: (d: DashboardSpec) => saveDashboard({ ...d, name: d.name.trim() || UNTITLED, description: d.description?.trim() || undefined, updatedAt: new Date().toISOString() }),
    success: 'Dashboard saved',
    failure: "Couldn't save the dashboard",
    toast: 'success',
    invalidate: [DASH_KEY.slice()],
    onSuccess: () => { setEditing(false); setSaveError(null); },
    onError: (e) => setSaveError(failureWords(classifySync(e), 'save the dashboard')),
  });
  const create = useReportedMutation({
    mutationFn: async () => { const d = emptyDashboard(UNTITLED); await saveDashboard(d); return d; },
    failure: "Couldn't create the dashboard",
    invalidate: [DASH_KEY.slice()],
    onSuccess: (d) => { openInEdit.current = d.id; router.push(`/reports/dashboards?id=${encodeURIComponent(d.id)}`); },
  });
  const remove = useReportedMutation({
    mutationFn: (d: DashboardSpec) => dropDashboard(d.id),
    success: 'Dashboard deleted',
    failure: "Couldn't delete the dashboard",
    invalidate: [DASH_KEY.slice()],
    onSuccess: () => { setEditing(false); router.push('/reports/dashboards'); },
  });
  const resend = useReportedMutation({
    mutationFn: (d: DashboardSpec) => retryDashboard(d.id),
    success: 'Dashboard saved',
    failure: "Couldn't save the dashboard to the server",
    invalidate: [DASH_KEY.slice()],
  });

  const askDelete = async () => {
    if (!saved) return;
    const yes = await confirm({
      title: `Delete “${saved.name || UNTITLED}”?`,
      message: `${saved.shared ? 'It is shared, so nobody in the organisation will see it any more. ' : ''}The reports it shows are not affected. This cannot be undone.`,
      confirmLabel: 'Delete dashboard',
      tone: 'danger',
    });
    if (yes) remove.mutate(saved);
  };
  const askForget = async () => {
    if (!saved) return;
    const yes = await confirm({ title: `Remove “${saved.name || UNTITLED}” from this device?`, message: 'The server does not have this dashboard, so it will be gone for good.', confirmLabel: 'Remove dashboard', tone: 'danger' });
    if (yes) { dropLocalDashboard(saved.id); refresh(); router.push('/reports/dashboards'); }
  };
  const stopEditing = async () => { if (await discardAsk()) { setEditing(false); setDraft(saved); setSaveError(null); } };

  const patch = (p: Partial<DashboardSpec>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setTiles = (tiles: DashboardTile[]) => patch({ tiles });
  const retrySpecs = () => { void reportsQ.refetch(); };

  const privateTiles = draft?.shared ? draft.tiles.filter((t) => { const s = specs.get(t.reportId); return !!s && s.mine !== false && !s.shared; }).length : 0;
  const nameError = nameProblem(draft?.name ?? '');
  const waiting = dashboards.filter((d) => d.mine !== false && dashboardState(list!, d.id) !== 'synced');
  const sayWaiting = list ? deviceLine({ device: waiting.filter((d) => dashboardState(list, d.id) === 'device').length, refused: waiting.filter((d) => dashboardState(list, d.id) === 'refused').length }, { one: 'dashboard', other: 'dashboards' }) : null;
  const tile = draft?.tiles.find((t) => t.id === tileId) ?? null;

  const header = (
    <PageHeader
      variant="page"
      title={TITLE}
      info={INFO}
      actions={<Button variant="primary" leftIcon={<Plus aria-hidden />} loading={create.isPending} onClick={async () => { if (await discardAsk()) create.mutate(); }}>New dashboard</Button>}
    />
  );

  // ── loading, failed, empty ──
  if (dashQ.isPending) {
    return <div className="flex flex-col gap-[12px]">{header}<div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={5} columns={3} label="Loading the dashboards" /></div></div>;
  }
  if (list?.failure && dashboards.length === 0) {
    const f = list.failure;
    return (
      <div className="flex flex-col gap-[12px]">
        {header}
        {f.kind === 'denied'
          ? <EmptyState kind="firstUse" icon={LayoutDashboard} title="You can't open dashboards" description="Your role does not include saved dashboards." />
          : <ErrorState title="Couldn't load the dashboards" message={f.kind === 'unreachable' ? 'The server could not be reached. Check your connection and try again.' : 'The server did not accept the request.'} onRetry={f.kind === 'unreachable' ? refresh : undefined} />}
      </div>
    );
  }
  if (dashboards.length === 0) {
    return (
      <div className="flex flex-col gap-[12px]">
        {header}
        <EmptyState
          kind="firstUse" icon={LayoutDashboard} title="No dashboards yet"
          description="A dashboard puts saved reports side by side. Save a report first, then add it to a dashboard as a number, a chart or a table."
          action={<span className="flex flex-wrap justify-center gap-[8px]"><Button variant="primary" leftIcon={<Plus aria-hidden />} loading={create.isPending} onClick={() => create.mutate()}>New dashboard</Button><Button href="/reports">Go to Reports</Button></span>}
        />
        {confirmDialog}
      </div>
    );
  }

  const listItem = (d: DashboardSpec) => {
    const on = d.id === activeId;
    const st = dashboardState(list!, d.id);
    return (
      <li key={d.id}>
        <Link
          href={`/reports/dashboards?id=${encodeURIComponent(d.id)}`}
          aria-current={on ? 'page' : undefined}
          onClick={(e) => { if (dirty && !on) { e.preventDefault(); void goTo(d.id); } }}
          className={`flex min-h-[44px] w-full flex-col justify-center rounded-ds-control px-[10px] py-[6px] focus-visible:outline-none focus-visible:shadow-ds-ring lg:min-h-ds-control ${on ? 'bg-ds-primary-soft text-ds-primary-text' : 'text-ds-fg-body hover:bg-ds-surface-hover'}`}
        >
          <span className="line-clamp-2 text-ds-body font-[600] [overflow-wrap:anywhere]" title={d.name}>{d.name || UNTITLED}</span>
          <span className="flex flex-wrap items-center gap-[4px]">
            <StatusPill size="sm" {...statusPill(reportVisibility, d.mine === false ? 'shared_with_me' : d.shared ? 'shared' : 'private')} />
            {st !== 'synced' && <StatusPill size="sm" {...statusPill(reportSync, st)} />}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      {header}
      {list?.failure && (
        <Notice tone="warning" title="Couldn't reach the server" action={<Button leftIcon={<RotateCw aria-hidden />} onClick={refresh}>Retry</Button>}>
          {list.failure.kind === 'unreachable' ? 'Showing the dashboards kept on this device. Dashboards from other people are not listed until the server answers.' : failureWords(list.failure, 'read the dashboards')}
        </Notice>
      )}
      {sayWaiting && !list?.failure && <Notice tone="warning" title="Some dashboards are not saved yet">{sayWaiting}</Notice>}
      {reportsQ.data?.failure && <Notice tone="warning" title="Couldn't read the saved reports" action={<Button leftIcon={<RotateCw aria-hidden />} onClick={retrySpecs}>Retry</Button>}>The tiles need them, so some may not draw until the server answers.</Notice>}

      <div className="grid min-w-0 gap-[16px] lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* the dashboards: a list beside the canvas, a menu above it on a phone */}
        <aside aria-label="Dashboards" className="min-w-0">
          <ul className="m-0 hidden list-none flex-col gap-[2px] rounded-ds-card border border-ds-border bg-ds-surface p-[6px] lg:flex">{dashboards.map(listItem)}</ul>
          <div className="lg:hidden">
            <FormField label="Dashboard">
              <Select value={activeId ?? ''} onChange={(e) => { void goTo(e.target.value); }}>
                {!saved && <option value="" disabled>Choose a dashboard</option>}
                {dashboards.map((d) => <option key={d.id} value={d.id}>{d.name || UNTITLED}</option>)}
              </Select>
            </FormField>
          </div>
        </aside>

        <section aria-label="Dashboard" className="flex min-w-0 flex-col gap-[12px]">
          {!draft || !saved ? (
            activeId ? (
              <EmptyState kind="firstUse" icon={LayoutDashboard} title="This dashboard is not available" description="It may have been deleted, or its owner has stopped sharing it." action={<Button href="/reports/dashboards">Back to the dashboards</Button>} />
            ) : null
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]">
                <div className="flex min-w-0 flex-1 basis-[16rem] flex-wrap items-center gap-[8px]">
                  <h2 className="m-0 min-w-0 break-words !text-ds-section !font-[600] !text-ds-fg">{saved.name || UNTITLED}</h2>
                  <StatusPill {...statusPill(reportVisibility, saved.mine === false ? 'shared_with_me' : saved.shared ? 'shared' : 'private')} />
                  {state !== 'synced' && <StatusPill {...statusPill(reportSync, state)} />}
                  {!canEdit && <span className="text-ds-body text-ds-fg-muted">View only</span>}
                </div>
                <div className="flex flex-wrap items-center gap-[8px]">
                  {state !== 'synced' && canEdit && (
                    <>
                      <Button leftIcon={<RotateCw aria-hidden />} loading={resend.isPending} onClick={() => resend.mutate(saved)}>Save to the server again</Button>
                      <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} onClick={() => { void askForget(); }}>Remove from this device</Button>
                    </>
                  )}
                  {canEdit && state === 'synced' && !editing && <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>}
                  {canEdit && editing && (
                    <>
                      <Button leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add tile</Button>
                      <Button onClick={() => { void stopEditing(); }}>Done</Button>
                    </>
                  )}
                </div>
              </div>

              {editing && (
                <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
                  <FormField label="Name" required error={nameError ?? undefined}>
                    <TextInput value={draft.name} maxLength={120} onChange={(e) => patch({ name: e.target.value })} autoComplete="off" />
                  </FormField>
                  <Checkbox label="Everyone in the organisation can open this dashboard" checked={!!draft.shared} onChange={(e) => patch({ shared: e.target.checked })} />
                  {privateTiles > 0 && <Notice tone="warning">{`${privateTiles} of the tiles ${privateTiles === 1 ? 'shows a report' : 'show reports'} that only you can open. The people you share this dashboard with will see ${privateTiles === 1 ? 'that tile' : 'those tiles'} as not available until you share the report${privateTiles === 1 ? '' : 's'} too.`}</Notice>}
                  <div><Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} onClick={() => { void askDelete(); }}>Delete dashboard</Button></div>
                </div>
              )}

              {draft.tiles.length === 0 ? (
                <EmptyState
                  kind="firstUse" icon={LayoutDashboard} title="This dashboard is empty"
                  description="Each tile shows one saved report as a number, a chart or a short table."
                  action={canEdit && state === 'synced' ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => { setEditing(true); setAdding(true); }}>Add the first tile</Button> : undefined}
                />
              ) : (
                <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
                  {draft.tiles.map((t, i) => {
                    const s = specs.get(t.reportId) ?? null;
                    const name = (t.title || '').trim() || s?.name || 'this tile';
                    return (
                      <div key={t.id} className={`flex min-h-[14rem] min-w-0 flex-col gap-[4px] ${WIDTH_CLASS[t.width]}`}>
                        {editing && (
                          <div role="group" aria-label={`Tile “${name}”`} className="flex flex-wrap items-center gap-[2px] rounded-ds-control border border-ds-border bg-ds-surface px-[4px]">
                            <Button size="sm" variant="ghost" leftIcon={<Settings2 aria-hidden />} onClick={() => setTileId(t.id)}>Edit tile</Button>
                            <span className="ml-auto flex items-center">
                              <IconButton label={`Move “${name}” earlier`} disabled={i === 0} onClick={() => setTiles(moveTile(draft.tiles, t.id, -1))}><ArrowLeft aria-hidden /></IconButton>
                              <IconButton label={`Move “${name}” later`} disabled={i === draft.tiles.length - 1} onClick={() => setTiles(moveTile(draft.tiles, t.id, 1))}><ArrowRight aria-hidden /></IconButton>
                              <IconButton label={`Remove “${name}” from the dashboard`} onClick={() => setTiles(removeTile(draft.tiles, t.id))}><X aria-hidden /></IconButton>
                            </span>
                          </div>
                        )}
                        <div className="min-h-0 flex-1">
                          <DashboardTileCard
                            tile={t}
                            spec={s}
                            loadingSpecs={reportsQ.isPending}
                            specsFailed={!!reportsQ.data?.failure}
                            onRetrySpecs={retrySpecs}
                            moduleOpen={(k) => openKeys.has(k)}
                            onDrill={(id, narrow) => router.push(drillHref(id, narrow))}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <SaveBar
        label="Save the dashboard"
        canEdit={editing && canEdit}
        dirty={dirty}
        invalid={!!nameError}
        saving={save.isPending}
        justSaved={false}
        error={saveError}
        onSave={() => { if (draft && !nameError) save.mutate(draft); }}
        onDiscard={() => { setDraft(saved); setSaveError(null); }}
      />

      <TileSheet open={!!tile} tile={tile} spec={tile ? specs.get(tile.reportId) ?? null : null} onClose={() => setTileId(null)} onApply={(p: TilePatch) => { if (tile && draft) setTiles(patchTile(draft.tiles, tile.id, p)); setTileId(null); }} />
      <AddTileSheet
        open={adding}
        reports={Array.from(specs.values())}
        dashboardShared={!!draft?.shared}
        onClose={() => setAdding(false)}
        onAdd={(reportId, render) => {
          if (draft) setTiles(draft.tiles.concat({ id: newTileId(), reportId, render, width: defaultWidth(render) }));
          setAdding(false);
        }}
      />
      {confirmDialog}
    </div>
  );
}
