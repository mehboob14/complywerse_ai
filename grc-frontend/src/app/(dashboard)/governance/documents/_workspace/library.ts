// Small rules of the documents library page. Pure (no React), so `node --test` runs library.test.ts against it.

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
