// Saved dashboards — tiles that each point at a saved report.
//
// A tile stores a report id, not a copy of its spec. Editing the report moves
// every dashboard that shows it, which is the behaviour people expect and the
// only version that cannot drift. The cost is that a deleted or unshared
// report leaves a tile with nothing behind it, so the tile has to render that
// state rather than assume the report resolves.
//
// Persistence rides on /reporting/reports with kind=dashboard: same table, so
// ownership, tenant isolation and sharing are the ones already in place, and
// the same localStorage fallback applies when the server is unreachable.

import apiClient from '@/lib/api';
import type { ChartKind } from './types';

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

/* ── local fallback ─────────────────────────────────────────────────────── */
function loadLocal(): DashboardSpec[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? (raw as DashboardSpec[]) : [];
  } catch { return []; }
}
function persistLocal(all: DashboardSpec[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* quota */ }
}
function saveLocal(d: DashboardSpec): void {
  const all = loadLocal();
  const i = all.findIndex((x) => x.id === d.id);
  if (i >= 0) all[i] = d; else all.push(d);
  persistLocal(all);
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

export async function listDashboards(): Promise<{ dashboards: DashboardSpec[]; source: DashSource }> {
  try {
    const { data } = await apiClient.get('/reporting/reports', { params: { kind: 'dashboard' } });
    const server = ((data?.reports || []) as ServerRow[]).map(toDash);
    // Re-push anything that only ever made it to localStorage (idempotent
    // upsert by slug), exactly as savedReports does, so a dashboard saved
    // during a server blip is picked up rather than silently orphaned.
    const ids = new Set(server.map((d) => d.id));
    const stillLocal: DashboardSpec[] = [];
    for (const d of loadLocal()) {
      if (!d.id || ids.has(d.id)) continue;
      try {
        await apiClient.post('/reporting/reports', toBody(d));
        persistLocal(loadLocal().filter((x) => x.id !== d.id));
      } catch {
        stillLocal.push(d);
      }
    }
    return { dashboards: [...server, ...stillLocal], source: 'server' };
  } catch {
    return { dashboards: loadLocal(), source: 'local' };
  }
}

export async function getDashboard(id: string): Promise<DashboardSpec | null> {
  try {
    const { data } = await apiClient.get(`/reporting/reports/${encodeURIComponent(id)}`);
    if (data?.slug) return toDash(data as ServerRow);
  } catch {
    /* fall through */
  }
  return loadLocal().find((d) => d.id === id) ?? null;
}

export async function persistDashboard(d: DashboardSpec): Promise<DashSource> {
  try {
    await apiClient.post('/reporting/reports', toBody(d));
    deleteLocal(d.id);
    return 'server';
  } catch {
    saveLocal(d);
    return 'local';
  }
}

export async function removeDashboard(id: string): Promise<DashSource> {
  let source: DashSource = 'local';
  try {
    await apiClient.delete(`/reporting/reports/${encodeURIComponent(id)}`);
    source = 'server';
  } catch {
    /* not ours, or server down — still clear any local copy */
  }
  deleteLocal(id);
  return source;
}

/** Move a tile within the dashboard. Arrows, not drag-and-drop: ordering a
 *  handful of tiles does not justify a drag library or a pointer-event dance
 *  that has to work on touch too. */
export function moveTile(tiles: DashboardTile[], id: string, dir: -1 | 1): DashboardTile[] {
  const i = tiles.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tiles.length) return tiles;
  const out = tiles.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
