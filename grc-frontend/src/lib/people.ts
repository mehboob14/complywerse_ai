import { moreCount } from './format.ts';
import { TONE } from './status.ts';

/** One person from a users list, whatever its shape. /tenants/{id}/users nests the person under `user`, and its own `id` is the
 *  membership's (the person is `user_id`); /assets/tenant-users is flat. Without this, pickers listed "User 1".."User 10" and
 *  could pick a membership id as if it were a person. */
export function personOf(row: any): { id: number; name: string; email?: string } {
  const u = row?.user ?? row ?? {};
  const id = Number(row?.user_id ?? u.id ?? row?.id);
  return { id, name: u.display_name || u.full_name || u.username || u.email || `User ${id}`, email: u.email || undefined };
}

/** The initials on a picker's avatar: "Olivia Owner" -> "OO", "bilal" -> "BI". A role or a department, labelled with its kind first
 *  ("Role · Approvers", "Department: Security Ops"), gets its own name's initials ("AP", "SO"), never "R·". */
export function initialsOf(label: string): string {
  const name = (label || '').split(/\s*[·:]\s+/).pop() || '';
  const words = name.split(/\s+/).map((w) => w.replace(/[·:()[\]{}.,;'"!?&\/\\_\-–—]/g, '')).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return (words[0] || '').slice(0, 2).toUpperCase() || 'U';
}

// ── how a person is drawn: initials, a colour of their own, a stack ───────────────────────────────────────────────────────
// Pure, so `node --test` runs people.test.ts against it. The design-system Avatar, PersonChip and PersonStack read these; the vendor kit's
// people.ts re-exports initials and avatarIndex, so a person has the same letters and colour on every page.

// ponytail: Intl.Segmenter is in every current browser (Firefox 125+); older ones fall back to code points, which only splits an emoji sequence.
const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** The letters of a word as a reader sees them: an accented letter, an emoji with its skin tone or a flag stays whole. */
const lettersOf = (word: string): string[] => (segmenter ? Array.from(segmenter.segment(word), (part) => part.segment) : Array.from(word));

/** "Dana Okafor" -> "DO", "Madonna" -> "MA", "Ali bin Zayed" -> "AZ" (first and last word), "محمد أحمد" -> "مأ" (in reading order);
 *  '?' for a blank. `count` 1 gives the first letter only (a 20px avatar). Never half an emoji. */
export function initials(name?: string | null, count: 1 | 2 = 2): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = lettersOf(words[0]);
  if (count === 1) return first[0].toUpperCase();
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase();
  return (first[0] + lettersOf(words[words.length - 1])[0]).toUpperCase();
}

/** The same name always gets the same slot, so a person keeps their colour from page to page. */
export function avatarIndex(name: string | null | undefined, slots: number): number {
  const text = String(name ?? '').trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return slots > 0 ? hash % slots : 0;
}

/** An avatar's slots: a tint and the ink that reads on it (4.5:1, status.test.ts), from five status families and the brand teal
 *  (the last is --ds-primary-soft and --ds-primary-text). The order is the vendor kit's, so nobody changes colour. */
export const AVATAR_TINTS: ReadonlyArray<{ tint: string; text: string }> = [
  TONE.progress, TONE.pending, TONE.warning, TONE.danger, TONE.success, { tint: '#E6F6F3', text: '#0F766E' },
].map((c) => ({ tint: c.tint, text: c.text }));

/** The tint and ink of a person's avatar; a blank name is the quiet grey. */
export function tintFor(name?: string | null): { tint: string; text: string } {
  const who = String(name ?? '').trim();
  return who ? AVATAR_TINTS[avatarIndex(who, AVATAR_TINTS.length)] : { tint: TONE.neutral.tint, text: TONE.neutral.text };
}

/** A stack of people: the first `max` by name, the rest, and the +M button's accessible name ("+2 more: Sara Reviewer, Khalid Approver":
 *  it starts with the words on the button, so a person who says what they see can press it). People with no name are left out: an empty
 *  avatar says nothing. */
export function personStack(names: ReadonlyArray<string | null | undefined> | null | undefined, max: number = 3) {
  const named = (names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean);
  const { shown, rest, more } = moreCount(named, max);
  return { shown, rest, more, moreLabel: more ? `+${more} more: ${rest.join(', ')}` : '' };
}
