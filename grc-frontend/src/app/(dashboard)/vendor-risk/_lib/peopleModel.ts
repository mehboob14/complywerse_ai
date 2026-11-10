// How a person is named on a screen when all the page has is an id (the owner of a finding, a seat of the lifecycle, a stakeholder of a request). The module's own list of people
// (`GET /vendor-risk/intake/people`) holds the active people of the platform; someone who has left is not on it, and an id is never a name: Rule U1 forbids "User 12".
// Pure, so `node --test` runs peopleModel.test.ts against it.

export interface PersonLike { id: number; name: string | null | undefined }

/** What is said for a person who is no longer on the list. */
export const FORMER = 'A former colleague';

/** The name of person `id`: the list's, else the name the record carries itself, else "A former colleague". `null` for no id (nobody is assigned). */
export function personName(people: ReadonlyArray<PersonLike>, id: number | null | undefined, carried?: string | null): string | null;
export function personName(people: ReadonlyArray<PersonLike>, id: number): string;
export function personName(people: ReadonlyArray<PersonLike>, id: number | null | undefined, carried?: string | null): string | null {
  if (id == null) return null;
  const listed = people.find((p) => p.id === id)?.name?.trim();
  return listed || carried?.trim() || FORMER;
}

/** The people to pick from, plus the one already chosen when they are no longer on the list (so an existing choice is shown and kept, never silently dropped). */
export function pickable(people: ReadonlyArray<PersonLike & { name: string }>, chosen: number | null | undefined, carried?: string | null): Array<{ id: number; name: string }> {
  const list = people.map((p) => ({ id: p.id, name: p.name }));
  if (chosen == null || list.some((p) => p.id === chosen)) return list;
  return [{ id: chosen, name: personName(people, chosen, carried) as string }, ...list];
}
