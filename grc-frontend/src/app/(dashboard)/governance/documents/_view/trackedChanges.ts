// Tracked changes: which version a document is compared with first, which versions a comparison covers, and how a version is
// named in a few words. Pure, so it is tested with node --test (trackedChanges.test.ts).
import type { ChainVersion } from '@/lib/documentChain';

type V = Pick<ChainVersion, 'id' | 'origin' | 'changes' | 'restored_from' | 'reverts'>;

const SHORT: Record<string, string> = {
  ai: 'Comply Agent', manual: 'By hand', mixed: 'Comply Agent and by hand', revert: 'Taken back', restore: 'Restored', signoff: 'Sign-off stamp',
  initial: 'Original', file: 'File replaced', import: 'Imported', nochange: 'No change',
};

/** What made a version: "Comply Agent", "By hand", "Taken back", "Restored v1.0", "Sign-off stamp", "Original". */
export const versionOrigin = (v: V): string => (v.restored_from ? `Restored v${v.restored_from}` : SHORT[v.origin] ?? 'Changed');

/** A version in the strip above the redline; a take back says what it took back ("Taken back 2 changes since v1.1"). */
export const versionPill = (v: V): string =>
  v.reverts ? `Taken back ${v.reverts.changes} change${v.reverts.changes === 1 ? '' : 's'} since v${v.reverts.since_version}` : versionOrigin(v);

/** The version to compare with first: the one before the newest version that changed the text. Sign-off stamps and versions that
 *  changed nothing are passed over, so the real edits stay in view; without such a version, the one before the newest. */
export function defaultBaseline(versions: V[]): number | null {
  for (let i = versions.length - 1; i > 0; i -= 1) {
    const v = versions[i];
    if (v.changes > 0 && v.origin !== 'signoff' && v.origin !== 'nochange') return versions[i - 1].id;
  }
  return versions[versions.length - 2]?.id ?? versions[0]?.id ?? null;
}

/** The versions a comparison covers, oldest first: after `from`, up to `to` (the newest when `to` is not given). */
export function versionsBetween<T extends { id: number }>(versions: T[], from: number | null, to?: number | null): T[] {
  const a = versions.findIndex((v) => v.id === from);
  if (a < 0) return [];
  const b = to != null ? versions.findIndex((v) => v.id === to) : -1;
  return versions.slice(a + 1, b < 0 ? versions.length : b + 1);
}
