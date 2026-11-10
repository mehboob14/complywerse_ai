// Saved dashboards — tiles that each point at a saved report.
//
// A tile stores a report id, not a copy of its spec. Editing the report moves
// every dashboard that shows it, which is the behaviour people expect and the
// only version that cannot drift. The cost is that a deleted or unshared
// report leaves a tile with nothing behind it, so the tile has to render that
// state rather than assume the report resolves.
//
// Persistence rides on /reporting/reports with kind=dashboard: same table, so
// ownership, tenant isolation and sharing are the ones already in place.
// A save or a delete THROWS when the server does not take it (the page shows the failure and
// Retry; the unsaved edits stay on the page). The only copies kept in this browser are the ones
// an older version of this page left when the server could not be reached; the list shows them
// as "this device only" and the page can send them again or forget them (what a failure means is
// _library/syncModel.ts).

import apiClient from '@/lib/api';
import type { ChartKind } from './types';
import { canSendAgain, classifySync, syncStateOf, toResend, type SyncFailure, type SyncState } from '../_library/syncModel';
import { clearRefused, markRefused, refusedMap } from '../_library/syncStore';

/** How a tile draws its report. `kpi` is a single number, `table` the first
 *  rows, anything else is a chart built from the report's Summarize setup. */
export type TileRender = 'kpi' | 'table' | ChartKind;

export interface DashboardTile {
  id: string;
  reportId: string;
  /** Overrides the report's own name on the tile. */
  title?: string;
  render: TileRender;
  /** Grid columns out of 4. */
  width: 1 | 2 | 3 | 4;
  /** kpi only: which measure to show. Omitted = row count. */
  measureIdx?: number;
  /** kpi only: plain-language note under the number. */
  caption?: string;
}

export interface DashboardSpec {
  id: string;
  name: string;
  description?: string;
  tiles: DashboardTile[];
  shared?: boolean;
  mine?: boolean;
  updatedAt?: string | null;
}

const KEY = 'grc-report-dashboards';
export type DashSource = 'server' | 'local';

/* ── local copies an older version of this page left ────────────────────── */
function loadLocal(): DashboardSpec[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? (raw as DashboardSpec[]) : [];
  } catch { return []; }
}
function persistLocal(all: DashboardSpec[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota */ }
}
function deleteLocal(id: string): void {
  persistLocal(loadLocal().filter((d) => d.id !== id));
}

/* ── server ─────────────────────────────────────────────────────────────── */
interface ServerRow {
  slug: string; name: string; kind?: string;
  spec: Partial<DashboardSpec>; is_shared: boolean; is_mine: boolean;
  updated_at?: string | null;
}

const toDash = (r: ServerRow): DashboardSpec => ({
  ...(r.spec as DashboardSpec),
  id: r.slug,
  name: r.name,
  tiles: Array.isArray(r.spec?.tiles) ? r.spec.tiles! : [],
  shared: !!r.is_shared,
  mine: r.is_mine !== false,
  updatedAt: r.updated_at ?? null,
});

const toBody = (d: DashboardSpec) => ({
  slug: d.id, name: d.name, kind: 'dashboard', dataset: '',
  spec: d, is_shared: !!d.shared,
});

export function newDashboardId(): string {
  return `dsh_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function newTileId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export const emptyDashboard = (name = ''): DashboardSpec => ({
  id: newDashboardId(), name, tiles: [], shared: false, mine: true,
});

export interface DashList {
  dashboards: DashboardSpec[];
  /** 'server' when the list was read from the server; 'local' when it could not be (then `failure` says why) */
  source: DashSource;
  failure?: SyncFailure;
  /** the ids the server holds; any other dashboard of the list is only on this device */
  onServer: string[];
  refused: Record<string, number>;
}

export const dashboardState = (list: DashList, id: string): SyncState => syncStateOf(id, new Set(list.onServer), list.refused);

export async function listDashboards(): Promise<DashList> {
  let server: DashboardSpec[];
  try {
    const { data } = await apiClient.get('/reporting/reports', { params: { kind: 'dashboard' } });
    server = ((data?.reports || []) as ServerRow[]).map(toDash);
  } catch (e) {
    return { dashboards: loadLocal(), source: 'local', failure: classifySync(e), onServer: [], refused: refusedMap() };
  }
  // A copy an older version of this page kept because the server was unreachable is sent now (the server upserts by slug); one the server refuses is recorded and left alone.
  const ids = new Set(server.map((d) => d.id));
  const local = loadLocal();
  const send = new Set(toResend(local, ids, refusedMap()));
  for (const d of local) {
    if (!send.has(d.id)) continue;
    try {
      await apiClient.post('/reporting/reports', toBody(d));
      deleteLocal(d.id);
      clearRefused(d.id);
      ids.add(d.id);
    } catch (e) {
      const failure = classifySync(e);
      if (!canSendAgain(failure)) markRefused(d.id, failure.status);
    }
  }
  const stillLocal = loadLocal().filter((d) => d.id && !ids.has(d.id));
  return { dashboards: [...server, ...stillLocal], source: 'server', onServer: Array.from(ids), refused: refusedMap() };
}

/** Save a dashboard; throws when the server does not take it. */
export async function saveDashboard(d: DashboardSpec): Promise<void> {
  await apiClient.post('/reporting/reports', toBody(d));
  deleteLocal(d.id);
  clearRefused(d.id);
}

/** Delete a dashboard; throws when the server does not delete it. One that is already gone (404) counts as deleted. */
export async function dropDashboard(id: string): Promise<void> {
  try {
    await apiClient.delete(`/reporting/reports/${encodeURIComponent(id)}`);
  } catch (e) {
    if (classifySync(e).status !== 404) throw e;
  }
  deleteLocal(id);
  clearRefused(id);
}

/** Send the copy kept on this device once, whatever was decided before; throws when the server does not take it. */
export async function retryDashboard(id: string): Promise<void> {
  const copy = loadLocal().find((d) => d.id === id);
  if (!copy) return;
  clearRefused(id);
  try {
    await saveDashboard(copy);
  } catch (e) {
    const failure = classifySync(e);
    if (!canSendAgain(failure)) markRefused(id, failure.status);
    throw e;
  }
}

/** Forget the copy kept on this device. */
export function dropLocalDashboard(id: string): void {
  deleteLocal(id);
  clearRefused(id);
}
