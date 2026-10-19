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
