// The views of the Governance Overview and what the address says about them (?view=summary|departments|board, ?group= for the board, ?measure= for the departments'
// columns, ?dept= for the scope), without React so `node --test` pins them (_views.test.ts). The default is the Summary. The old "At a glance" address
// (/governance/documents/overview?view=summary|table|graph|board) is a server redirect to this page: legacyQuery maps its parameters.
import { DEFAULT_MEASURE, type MeasureId } from './_matrix.ts';
import { OVERVIEW } from './_model.ts';

export type ViewId = 'summary' | 'departments' | 'board';
export const VIEWS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'summary', label: 'Summary' }, { id: 'departments', label: 'Departments' }, { id: 'board', label: 'Board' },
];
export const VIEW_IDS = VIEWS.map((v) => v.id) as ViewId[];
export const DEFAULT_VIEW: ViewId = 'summary';

export type GroupId = 'status' | 'type' | 'department';
export const GROUPS: ReadonlyArray<{ id: GroupId; label: string }> = [{ id: 'status', label: 'Status' }, { id: 'type', label: 'Type' }, { id: 'department', label: 'Department' }];
export const GROUP_IDS = GROUPS.map((g) => g.id) as GroupId[];
export const DEFAULT_GROUP: GroupId = 'status';

/** The address of the Overview for a department (its `?dept=` value: "" the whole organisation, "none", or an id) in a view. The defaults are left out, and so is
 *  what the view does not use: the grouping belongs to the board, the columns of the department table to the departments view. */
export function viewHref(dept: string, view: ViewId = DEFAULT_VIEW, group: GroupId = DEFAULT_GROUP, measure: MeasureId = DEFAULT_MEASURE): string {
  const q = new URLSearchParams();
  if (dept) q.set('dept', dept);
  if (view !== DEFAULT_VIEW) q.set('view', view);
  if (view === 'board' && group !== DEFAULT_GROUP) q.set('group', group);
  if (view === 'departments' && measure !== DEFAULT_MEASURE) q.set('measure', measure);
  const text = q.toString();
  return text ? `${OVERVIEW}?${text}` : OVERVIEW;
}

/** What the old At a glance views are now: the table is the Departments view, the graphs are on the Summary (and above the departments), the board is the Board. */
const OLD_VIEW: Readonly<Record<string, ViewId>> = { summary: 'summary', table: 'departments', graph: 'summary', board: 'board', departments: 'departments' };

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

/** The query string ("?dept=12&view=board", or "") the Overview opens with for the old At a glance address's parameters: `dept`, `group` and `measure` as they were,
 *  `view` mapped (summary and graph to the Summary, table to Departments, board to the Board). A value the Overview does not know is left out. */
export function legacyQuery(search: Search | undefined): string {
  const q = new URLSearchParams();
  const dept = first(search?.dept).trim();
  const view = OLD_VIEW[first(search?.view).trim().toLowerCase()] ?? DEFAULT_VIEW;
  const group = first(search?.group).trim().toLowerCase();
  const measure = first(search?.measure).trim().toLowerCase();
  if (dept) q.set('dept', dept);
  if (view !== DEFAULT_VIEW) q.set('view', view);
  if (view === 'board' && GROUP_IDS.includes(group as GroupId) && group !== DEFAULT_GROUP) q.set('group', group);
  if (view === 'departments' && measure !== DEFAULT_MEASURE && MEASURE_ALLOWED.includes(measure)) q.set('measure', measure);
  const text = q.toString();
  return text ? `?${text}` : '';
}

const MEASURE_ALLOWED: readonly string[] = ['status', 'type', 'waiting', 'reviews', 'issues'];
