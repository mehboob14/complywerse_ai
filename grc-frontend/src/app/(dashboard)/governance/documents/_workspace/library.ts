// Small rules of the documents library page. Pure (no React), so `node --test` runs library.test.ts against it.
import { departmentPickItems, departmentTree } from '../../../../../lib/departments.ts';

/** New Document, AI Draft and Templates all open the Comply AI Studio: where it is off, one line says so instead. */
export function creation(canCreate: boolean, studioEnabled: boolean | undefined): 'buttons' | 'studio-off' | null {
  if (!canCreate) return null;
  return studioEnabled === false ? 'studio-off' : 'buttons';
}

export type VersionState = 'current' | 'in-force' | 'superseded';

/**
 * Each version's state, as the library table says it: the document's own number carries the document's state (Draft, In Review,
 * Published …); the version everyone reads while a newer one is on its way is in force (the earliest row with its number, as the
 * server picks it); any other is superseded. `newestFirst`: the document's versions, newest first (no current number: the newest).
 */
export function versionStates<V extends { number: string }>(
  newestFirst: readonly V[],
  doc: { current_version?: string | null; version_in_force?: string | null },
): (V & { state: VersionState })[] {
  const current = doc.current_version || newestFirst[0]?.number;
  const inForce = doc.version_in_force && doc.version_in_force !== current ? doc.version_in_force : null;
  const inForceAt = inForce ? newestFirst.map((v) => v.number).lastIndexOf(inForce) : -1;
  return newestFirst.map((v, i) => ({ ...v, state: i === inForceAt ? 'in-force' : v.number === current ? 'current' : 'superseded' }));
}

/**
 * A document's versions as a hierarchy (the user, 2026-10-21: "all version should be there in proper hierarchical manner"): one
 * group per major number, newest major first; `head` is the group's first version (its x.0, or where the document started, e.g. an
 * uploaded 4.3) and `minors` the versions after it, newest first. `newestFirst`: the versions, newest first; nothing is dropped.
 */
export function versionGroups<V extends { number: string }>(newestFirst: readonly V[]): { major: string; head: V; minors: V[] }[] {
  const groups = new Map<string, V[]>();
  for (const v of newestFirst) {
    const major = v.number.split('.')[0];
    groups.set(major, [...(groups.get(major) ?? []), v]);
  }
  return Array.from(groups, ([major, rows]) => ({ major, head: rows[rows.length - 1], minors: rows.slice(0, -1) }));
}

/** The frameworks the register's Frameworks column shows: those the Details dialog edits (applicable_framework_ids), else the
 *  document's own framework_ids when none are set (the server defaults one to the other on creation). */
export function shownFrameworkIds(d: { applicable_framework_ids?: number[] | null; framework_ids?: number[] | null }): number[] {
  return d.applicable_framework_ids?.length ? d.applicable_framework_ids : d.framework_ids ?? [];
}

/** The Department filter's choice for the documents that sit in no department (a department's id is a number, so this cannot clash). */
export const NO_DEPARTMENT = 'none';

/** Department id (as text) -> the ids of that department and of every department under it, however deep. Choosing a department in the
 *  Department filter means all of them: a document in a unit is in its sub-department and in its department too. */
export type DepartmentScope = Record<string, readonly number[]>;

type TreeDepartment = { id: number; name: string; parent_department_id?: number | null };

/** Whether a document passes the Department filter ('' = all; NO_DEPARTMENT = documents with none, exactly; else the department's id).
 *  With `scope` a department also takes in the documents of the departments under it; without it (or for an id it does not know)
 *  the department matches only itself, as it always did. The id comes from the address (`?dept=`): it is looked up by own key only. */
export function matchesDepartment(d: { department_id?: number | null }, filter: string, scope?: DepartmentScope | null): boolean {
  if (!filter) return true;
  if (filter === NO_DEPARTMENT) return d.department_id == null;
  if (d.department_id == null) return false;
  const below = scope && Object.prototype.hasOwnProperty.call(scope, filter) ? scope[filter] : null;
  return below ? below.includes(d.department_id) : String(d.department_id) === filter;
}

/** For each department, the ids of it and of everything under it (lib/departments.ts reads the tree the way the server does: a loop, a
 *  self-parent or a missing parent counts as a top department). Built once per list of departments, then asked by `matchesDepartment`. */
export function departmentScopes(departments: readonly TreeDepartment[] | null | undefined): DepartmentScope {
  const all = departments ?? [];
  const tree = departmentTree(all);
  const out: DepartmentScope = {};
  all.forEach((d) => { out[String(d.id)] = Array.from(tree.subtree(d.id)); });
  return out;
}

/** Department id (as text) -> the names from its top department down to it ("Operations › Support"): the full path for the Department
 *  column's title, where only the department's own name is drawn. */
export function departmentPaths(departments: readonly TreeDepartment[] | null | undefined): Record<string, string> {
  const all = departments ?? [];
  const tree = departmentTree(all);
  const out: Record<string, string> = {};
  all.forEach((d) => { out[String(d.id)] = tree.path(d.id).map((p) => p.name).join(' › '); });
  return out;
}

/** What the Department filter offers: "No department", then every department in tree order (the top ones A to Z, each followed by what
 *  is under it), named by its whole path with its level under the name ("Sub-department", or the organisation's own word: `labels`).
 *  Choosing one includes the departments under it. One switched off that a document still sits in is kept (marked), so those documents
 *  can still be found. */
export function departmentFilterOptions(
  departments: readonly (TreeDepartment & { is_active?: boolean })[] | null | undefined,
  docs: readonly { department_id?: number | null }[],
  labels?: readonly string[],
): { value: string; label: string; subLabel?: string }[] {
  return [
    { value: NO_DEPARTMENT, label: 'No department' },
    ...departmentPickItems(departments ?? [], { labels, keep: docs.map((d) => d.department_id) }),
  ];
}

/** Department id -> name, for the register's Department column. */
export function departmentNames(departments: readonly { id: number; name: string }[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (departments ?? []).forEach((d) => { out[String(d.id)] = d.name; });
  return out;
}
