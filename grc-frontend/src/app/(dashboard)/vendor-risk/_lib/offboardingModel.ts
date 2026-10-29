// What the exit card works out from the server's story of an offboarding: which exits are under way, how far each is, the line under
// its title, the hint under each step. Pure, so `node --test` runs offboardingModel.test.ts against it.

import { fmt } from '../_ui/fmt.ts';
import type { ExitItem, Offboarding } from './offboardingApi.ts';

/** One exit under way, the supplier's own or one engagement's, in the shape the card draws. */
export interface ExitView {
  scope: 'relationship' | 'engagement';
  /** the engagement it is for (null: the whole relationship) */
  engagementId: number | null;
  /** "The whole relationship" or the engagement's name */
  name: string;
  reason: string | null;
  startedAt: string | null;
  startedBy: string | null;
  notes: string | null;
  items: ExitItem[];
  /** portal links closed when it started: only the whole relationship closes any */
  linksRevoked: number | null;
}

export const WHOLE = 'The whole relationship';

// What each standard step asks (Verity's hints, with ours). A step someone added has none.
const HINTS: Record<string, string> = {
  'Revoke all vendor access and credentials': 'Accounts, keys and network paths they held are closed.',
  'Return or certifiably destroy our data': 'They have confirmed it in writing.',
  'Decommission integrations / shared keys': 'Connections and shared secrets are removed.',
  'Confirm final compliance & contractual obligations': 'Termination, retention and survival clauses are checked.',
  'Export audit trail and formally close the case': 'The record is exported and the case is closed.',
  'Contracts closed out': 'Every contract is ended, with its end date on record.',
  'Final payments settled': 'Nothing is owed either way.',
};
export const hintFor = (item: string): string | undefined => HINTS[item];

/** The exits under way: the whole relationship's when it has started and the supplier is not yet archived, then each engagement's
 *  that has not ended. `only` keeps one scope (an engagement's id, or null for the whole relationship). */
export function openExits(data: Offboarding | undefined, only?: { engagementId: number | null }): ExitView[] {
  if (!data) return [];
  const out: ExitView[] = [];
  if (data.started && !data.archived_at) {
    out.push({ scope: 'relationship', engagementId: null, name: WHOLE, reason: data.reason, startedAt: data.started_at,
      startedBy: data.started_by, notes: data.notes, items: data.items, linksRevoked: data.links_revoked });
  }
  for (const e of data.engagements ?? []) {
    if (e.ended || e.completed_at) continue;
    out.push({ scope: 'engagement', engagementId: e.id, name: e.name, reason: e.reason, startedAt: e.started_at,
      startedBy: e.started_by, notes: e.notes, items: e.items, linksRevoked: null });
  }
  return only === undefined ? out : out.filter((x) => x.engagementId === only.engagementId);
}

export function progress(items: ExitItem[]): { done: number; total: number; all: boolean } {
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, all: items.length > 0 && done === items.length };
}

/** "Started 5 Mar 2026 · 3 of 7 steps done · 2 portal links revoked" (the whole relationship); an engagement's has no links. */
export function exitLine(x: Pick<ExitView, 'scope' | 'startedAt' | 'items' | 'linksRevoked'>): string {
  const { done, total } = progress(x.items);
  const links = x.scope !== 'relationship' ? null
    : typeof x.linksRevoked === 'number' ? `${x.linksRevoked} portal ${x.linksRevoked === 1 ? 'link' : 'links'} revoked` : 'portal links revoked';
  return [x.startedAt ? `Started ${fmt.date(x.startedAt)}` : null, `${done} of ${total} ${total === 1 ? 'step' : 'steps'} done`, links]
    .filter(Boolean).join(' · ');
}
