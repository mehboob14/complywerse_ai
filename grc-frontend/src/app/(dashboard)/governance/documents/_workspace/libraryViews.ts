// The compliance views of the Workspace, as data the library merges into its built-in views (libraryModel.BUILT_IN_VIEWS): each remembers the filters and the order (the state the
// library already saves in a view), the layout it is looked at in and the grouping, in the library's own Filters vocabulary: nothing here is a filter the library cannot express.
// Pure (no React), so `node --test` checks it (libraryViews.test.ts).
//
//   Framework coverage         list, grouped by framework      the documents in force; each framework's line says how many, how many reviews are late, how many have acknowledged
//   Overdue by owner           list, grouped by owner          reviews past their date, the oldest first
//   Acknowledgements outstanding  list, grouped by department  documents with an acknowledgement request that not everyone has answered, the least answered first
//   Review calendar            calendar                        the next twelve months of reviews
//   Approval pipeline          board, by status                documents on their way (draft, in review, in approval, approved)
//   Restricted                 list, grouped by department     the Restricted classification
//
// Left out of the designs this was taken from: "Risk & Compliance" and "By owner (all)": the first is a department name of the sample, the second is the Overdue view without its filter
// (Group by Owner on any view does it).
import {
  DEFAULT_SORT, NO_FILTERS, sameState,
  type Filters, type GroupKey, type LibraryState, type LibraryViewId, type SavedView, type Sort,
} from './libraryModel.ts';

/** A built-in view that remembers how it is looked at. */
export type WorkspaceView = SavedView & { builtIn: true; layout: LibraryViewId; group: GroupKey };

const view = (id: string, name: string, layout: LibraryViewId, group: GroupKey, filters: Partial<Filters>, sort: Sort = DEFAULT_SORT): WorkspaceView =>
  ({ id, name, builtIn: true, layout, group, state: { filters: { ...NO_FILTERS, ...filters }, sort } });

/** The new built-in views, in the order the Views menu lists them (after the library's own). The ids never change: a link or a remembered choice may carry them. */
export const WORKSPACE_VIEWS: WorkspaceView[] = [
  // a draft does not cover a framework: what is in force does; the documents inside a framework read A to Z
  view('framework-coverage', 'Framework coverage', 'table', 'framework', { statuses: ['published'] }, { key: 'title', dir: 'asc' }),
  view('overdue-by-owner', 'Overdue by owner', 'table', 'owner', { review: ['overdue'] }, { key: 'review', dir: 'asc' }),
  view('acks-outstanding', 'Acknowledgements outstanding', 'table', 'department', { attestation: ['in_progress', 'not_started'] }, { key: 'attestation', dir: 'asc' }),
  view('review-calendar', 'Review calendar', 'calendar', 'none', {}, { key: 'review', dir: 'asc' }),
  view('approval-pipeline', 'Approval pipeline', 'board', 'status', { statuses: ['draft', 'pending_review', 'pending_approval', 'approved'] }),
  view('restricted', 'Restricted', 'table', 'department', { classifications: ['restricted'] }),
];

export const WORKSPACE_VIEW_IDS: readonly string[] = WORKSPACE_VIEWS.map((v) => v.id);

/**
 * The view the page is on: the one whose filters and order are exactly the page's AND whose layout and grouping, where it remembers any, are the page's too. A view that remembers none
 * (the library's older ones, and a saved view of the person's from before the Workspace) is the same view in any layout. Where several fit, the one that remembers both layout and
 * grouping wins, then one that remembers either, then the first. null: custom filters.
 */
export function activeView<V extends Pick<SavedView, 'state' | 'layout' | 'group'>>(views: readonly V[], state: LibraryState, layout: LibraryViewId, group: GroupKey): V | null {
  const fits = views.filter((v) => sameState(v.state, state) && (v.layout == null || v.layout === layout) && (v.group == null || v.group === group));
  const named = (v: V) => (v.layout != null ? 1 : 0) + (v.group != null ? 1 : 0);
  return fits.reduce<V | null>((best, v) => (best == null || named(v) > named(best) ? v : best), null);
}

/** What applying a view sets besides its state: its layout and grouping, where it remembers them (a view that does not leaves the page's own). */
export const viewLook = (v: Pick<SavedView, 'layout' | 'group'>): { layout?: LibraryViewId; group?: GroupKey } => ({
  ...(v.layout ? { layout: v.layout } : {}), ...(v.group ? { group: v.group } : {}),
});
