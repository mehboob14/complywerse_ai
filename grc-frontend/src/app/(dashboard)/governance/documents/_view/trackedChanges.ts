// Tracked changes: which version a document is compared with first (and whether its changes are marked when it opens), which
// versions a comparison covers, and how a version is named in a few words. Pure, so it is tested with node --test (trackedChanges.test.ts).
import type { ChainVersion } from '@/lib/documentChain';

type V = Pick<ChainVersion, 'id' | 'origin' | 'changes' | 'restored_from' | 'reverts'>;

const SHORT: Record<string, string> = {
  ai: 'Comply Agent', manual: 'By hand', mixed: 'Comply Agent and by hand', revert: 'Taken back', restore: 'Restored', signoff: 'Sign-off stamp',
  initial: 'Original', file: 'File replaced', import: 'Imported', nochange: 'No change', statement: 'From statements',
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

type Timed = V & { at?: string | null; comparable?: boolean };
type Event = { at: string | null; to: string | null };

const changedText = (v: V) => v.changes > 0 && v.origin !== 'signoff' && v.origin !== 'nochange';

/** The version that was in force at the last approval or publication (the newest one made at or before it; the first version when
 *  every version is stamped later), or null without an approval. */
export function approvedVersionId(versions: Timed[], events: Event[]): number | null {
  const at = [...events].reverse().find((e) => e.to === 'approved' || e.to === 'published')?.at;
  if (!at) return null;
  let id: number | null = null;
  for (const v of versions) if ((v.at ?? '') <= at) id = v.id;
  return id ?? versions[0]?.id ?? null;
}

/** What the document view marks when it opens: the changes since the last approved version when the text changed after it, else
 *  since the version before the newest change. Null (nothing marked) for a single version, when no version changed the text, or
 *  when a version in the comparison could not be read. */
export function openingBaseline(versions: Timed[], events: Event[]): { id: number; approved: boolean } | null {
  if (versions.length < 2) return null;
  const readable = (from: number) => versionsBetween(versions, from).every((v) => v.comparable !== false);
  const approved = approvedVersionId(versions, events);
  if (approved != null && versionsBetween(versions, approved).some(changedText)) return readable(approved) ? { id: approved, approved: true } : null;
  if (!versions.some(changedText)) return null;
  const id = defaultBaseline(versions);
  return id != null && readable(id) ? { id, approved: false } : null;
}

/** The version a person last acknowledged, to compare the document with when it opens: the newest version with that number, when a
 *  later version changed the text and every version since can be read; else null (the usual baseline applies). */
export function ackBaseline(versions: Array<Timed & { number: string }>, number: string | null | undefined): number | null {
  const i = number ? versions.map((v) => v.number).lastIndexOf(number) : -1;
  if (i < 0) return null;
  const after = versions.slice(i + 1);
  return after.some(changedText) && after.every((v) => v.comparable !== false) ? versions[i].id : null;
}

const APPROVAL_EVENTS = new Set(['sent_for_review', 'sent_for_approval', 'submitted', 'signed', 'reviewed', 'approved', 'rejected', 'published',
  'review_completed', 'review_skipped', 'acknowledged', 'request_cancelled', 'participant_removed', 'return_to_draft', 'escalated', 'delegated']);

/** A chain event that belongs under "Approvals": sent for review or approval, reviewed, signed, approved, rejected, published,
 *  acknowledged, a request withdrawn, escalated or delegated, a reviewer or approver removed, back to draft, or a status set to
 *  approved or published by hand. Not "Created", not a restore, not an owner change. */
export const isApprovalEvent = (e: { kind: string; to: string | null }): boolean =>
  APPROVAL_EVENTS.has(e.kind) || (e.kind === 'status_changed' && (e.to === 'approved' || e.to === 'published'));

/** "Changes in v1.3 since v1.2 (approved)": what a comparison shows, in one line; null when there is nothing to compare. */
export function compareLine(versions: Array<{ id: number; number: string }>, from: number | null, to: number | null | undefined, approvedId: number | null): string | null {
  const base = versions.find((v) => v.id === from);
  const end = to != null ? versions.find((v) => v.id === to) : versions[versions.length - 1];
  if (!base || !end || end.id === base.id) return null;
  const tag = base.id === approvedId ? ' (approved)' : base.id === versions[0].id ? ' (the original)' : '';
  return `Changes in v${end.number} since v${base.number}${tag}`;
}
