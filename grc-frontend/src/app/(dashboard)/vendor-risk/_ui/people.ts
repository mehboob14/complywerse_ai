// A person's initials and the colour of their avatar. Pure, so `node --test` runs people.test.ts against it.

const first = (word: string): string => Array.from(word)[0] ?? '';

/** "Dana Okafor" -> "DO", "Madonna" -> "MA", "Ali bin Zayed" -> "AZ" (first and last word); '?' for a blank. */
export function initials(name?: string | null): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (first(words[0]) + first(words[words.length - 1])).toUpperCase();
}

/** The same name always gets the same slot, so a person keeps their colour from page to page. */
export function avatarIndex(name: string | null | undefined, slots: number): number {
  const text = String(name ?? '').trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return slots > 0 ? hash % slots : 0;
}
