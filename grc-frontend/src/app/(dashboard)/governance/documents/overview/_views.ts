// The views of At a glance and what the address says about them (?view=summary|table|graph|board, ?group= for the board, ?measure= for the table), without React so
// `node --test` pins them (_views.test.ts). The default is the Summary: a mix of the figures, the graphs, the table of departments and a strip of the board.
import { DEFAULT_MEASURE, type MeasureId } from './_matrix.ts';
import { OVERVIEW } from './_model.ts';

export type ViewId = 'summary' | 'table' | 'graph' | 'board';
export const VIEWS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'summary', label: 'Summary' }, { id: 'table', label: 'Table' }, { id: 'graph', label: 'Graph' }, { id: 'board', label: 'Board' },
];
export const VIEW_IDS = VIEWS.map((v) => v.id) as ViewId[];
export const DEFAULT_VIEW: ViewId = 'summary';

export type GroupId = 'status' | 'type' | 'department';
export const GROUPS: ReadonlyArray<{ id: GroupId; label: string }> = [{ id: 'status', label: 'Status' }, { id: 'type', label: 'Type' }, { id: 'department', label: 'Department' }];
export const GROUP_IDS = GROUPS.map((g) => g.id) as GroupId[];
export const DEFAULT_GROUP: GroupId = 'status';

/** The address of At a glance for a department (its `?dept=` value: "" the whole organisation, "none", or an id) in a view. The defaults are left out, and so is
 *  what the view does not use: the grouping belongs to the board, the columns of the department table to the summary and the table. */
export function viewHref(dept: string, view: ViewId = DEFAULT_VIEW, group: GroupId = DEFAULT_GROUP, measure: MeasureId = DEFAULT_MEASURE): string {
  const q = new URLSearchParams();
  if (dept) q.set('dept', dept);
  if (view !== DEFAULT_VIEW) q.set('view', view);
  if (view === 'board' && group !== DEFAULT_GROUP) q.set('group', group);
  if ((view === 'summary' || view === 'table') && measure !== DEFAULT_MEASURE) q.set('measure', measure);
  const text = q.toString();
  return text ? `${OVERVIEW}?${text}` : OVERVIEW;
}
