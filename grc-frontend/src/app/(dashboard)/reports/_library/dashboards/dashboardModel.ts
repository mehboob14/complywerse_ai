// What a dashboard is and what editing it does, as pure functions (dashboardModel.test.ts): when there is something to save, the tile operations, the state a tile is in when it cannot draw its
// report, and the name a dashboard needs. The page owns the requests; the tile draws; the decisions are here.

export type TileWidth = 1 | 2 | 3 | 4;

export interface TileLike {
  id: string;
  reportId: string;
  title?: string;
  caption?: string;
  render: string;
  width: TileWidth;
  measureIdx?: number;
}

export interface DashLike {
  name: string;
  description?: string;
  shared?: boolean;
  tiles: readonly TileLike[];
}

/** What a person can change on a dashboard; everything else on the saved copy (id, owner, the date) is not theirs to edit. */
const editable = (d: DashLike) => ({
  name: d.name.trim(),
  description: (d.description ?? '').trim(),
  shared: !!d.shared,
  tiles: d.tiles.map((t) => [t.id, t.reportId, (t.title ?? '').trim(), (t.caption ?? '').trim(), t.render, t.width, t.measureIdx ?? null]),
});

/** Whether the draft differs from what is saved in a way the person made: the Save bar shows, and leaving asks first. */
export function dashboardDirty(saved: DashLike | null, draft: DashLike | null): boolean {
  if (!saved || !draft) return false;
  return JSON.stringify(editable(saved)) !== JSON.stringify(editable(draft));
}

/** A dashboard can be saved when it has a name. */
export const nameProblem = (name: string): string | null => (name.trim() ? null : 'Give the dashboard a name.');
export const UNTITLED = 'Untitled dashboard';

export function moveTile<T extends { id: string }>(tiles: readonly T[], id: string, dir: -1 | 1): T[] {
  const i = tiles.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= tiles.length) return tiles.slice();
  const out = tiles.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const patchTile = <T extends { id: string }>(tiles: readonly T[], id: string, patch: Partial<T>): T[] => tiles.map((t) => (t.id === id ? { ...t, ...patch } : t));
export const removeTile = <T extends { id: string }>(tiles: readonly T[], id: string): T[] => tiles.filter((t) => t.id !== id);

/** A new tile: a number is a quarter of the row, anything bigger is a half. */
export const defaultWidth = (render: string): TileWidth => (render === 'kpi' ? 1 : 2);

/** The measure a KPI tile shows: the report's measure at `measureIdx` (the first one when the tile names none, as tiles always did) when the report has it, else the count of rows (-1). The Sheet
 *  offers the report's measures and "Number of rows". */
export function measureChoice(measureIdx: number | undefined, measureCount: number): number {
  const idx = measureIdx ?? 0;
  return idx >= 0 && idx < measureCount ? idx : -1;
}

export type TileProblem = 'ok' | 'loading' | 'missing' | 'no_module' | 'error';

/** Why a tile cannot draw yet, in the order a person would check: still loading, the report is not there for them, the module is not theirs, the data failed. */
export function tileProblem(i: { loading: boolean; hasReport: boolean; moduleKnown: boolean; moduleOpen: boolean; failed: boolean }): TileProblem {
  if (i.loading) return 'loading';
  if (!i.hasReport) return 'missing';
  if (!i.moduleKnown || !i.moduleOpen) return 'no_module';
  return i.failed ? 'error' : 'ok';
}

/** The words under a tile that cannot draw. */
export const TILE_WORDS: Record<Exclude<TileProblem, 'ok' | 'loading'>, string> = {
  missing: 'This report is not available to you. It may have been deleted, or its owner has not shared it.',
  no_module: 'You do not have access to the module this report reads.',
  error: 'The data for this tile could not be read.',
};

/** The key two tiles share when they need the same rows: a client dataset is one list whatever the report's filters say (the browser filters), so the key is the module and the links; a server
 *  dataset is filtered in SQL, so the report's rules and search are part of it. */
export function rowsKey(i: { dataset: string; serverMode: boolean; includes: readonly string[]; fields: readonly string[]; rules: unknown; search: string; sorts: unknown }): readonly unknown[] {
  const base: unknown[] = ['dash-rows', i.dataset, i.includes.join(','), i.fields.join(',')];
  return i.serverMode ? base.concat([JSON.stringify(i.rules ?? null), i.search ?? '', JSON.stringify(i.sorts ?? null)]) : base;
}
