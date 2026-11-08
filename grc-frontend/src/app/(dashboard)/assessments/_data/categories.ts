// The server's six groups of assessments (`board_category` in `backend/grc/modules/assessments/scoring.py`) and the short word each has in the address of the register
// (`?category=nca`). The names are the server's own; the words are ours, lower case, so a link written by hand is easy to read. Pure (`node --test categories.test.ts`).

export const CATEGORIES = [
  { slug: 'cyber', name: 'Cyber Security' },
  { slug: 'nca', name: 'NCA' },
  { slug: 'digital', name: 'Digital Operations' },
  { slug: 'privacy', name: 'Privacy & Data' },
  { slug: 'audit', name: 'Audit' },
  { slug: 'other', name: 'Other' },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

/** The address word of a server category name; a name nobody listed is "other". */
export function slugOf(name: string | null | undefined): CategorySlug {
  const found = CATEGORIES.find((c) => c.name === (name ?? '').trim());
  return found ? found.slug : 'other';
}

/** The server's name for an address word; null when the word is not one of ours. */
export function nameOf(slug: string | null | undefined): string | null {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? null;
}

export const categoryHref = (name: string): string => `/assessments/register?category=${slugOf(name)}`;
