/**
 * A document's tags as the Details popup keeps them: trimmed, inner spaces collapsed, each once whatever its case, a few words long,
 * a limited number. Pure, so `node --test` checks it.
 */
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** One tag as it is kept ('' when nothing is left). */
export function cleanTag(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim();
}

/** `current` with `parts` added: empty ones and ones already there (any case) left out, at most MAX_TAGS in all. */
export function addTags(current: readonly string[], parts: readonly string[]): string[] {
  const out = [...current];
  const seen = new Set(out.map((t) => t.toLowerCase()));
  for (const part of parts) {
    const t = cleanTag(part);
    if (!t || seen.has(t.toLowerCase()) || out.length >= MAX_TAGS) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** The tags other documents use that are not chosen yet and contain `query`: each once, A to Z, at most `limit`. */
export function tagSuggestions(used: readonly unknown[], chosen: readonly string[], query = '', limit = 8): string[] {
  const taken = new Set(chosen.map((t) => t.toLowerCase()));
  const q = cleanTag(query).toLowerCase();
  const byKey = new Map<string, string>();
  for (const raw of used) {
    if (typeof raw !== 'string') continue;
    const t = cleanTag(raw);
    const key = t.toLowerCase();
    if (t && !taken.has(key) && !byKey.has(key) && key.includes(q)) byKey.set(key, t);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b)).slice(0, limit);
}
