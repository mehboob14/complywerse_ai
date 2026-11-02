// What the Roster page works out: who a role can still be given to, and what its picker says. Pure, so `node --test` runs
// rosterModel.test.ts against it.

export interface Person { id: number; name: string }
export interface Member { user_id: number; name: string; email?: string | null }
export interface RosterRole { key: string; label: string; hint?: string; members: Member[] }
export interface RosterPayload { roles: RosterRole[]; can_edit: boolean }

/** The people a role can still be given to: everyone who signs in here except those already on it, by name. */
export function candidates(people: Person[] | undefined, members: Member[]): Person[] {
  const on = new Set(members.map((m) => m.user_id));
  return (people ?? []).filter((p) => !on.has(p.id)).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export const pickerLabel = (members: Member[]): string => (members.length ? 'Add another…' : 'Assign…');
