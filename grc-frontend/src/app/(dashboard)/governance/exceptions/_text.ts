// How the page reads the long texts of an exception (justification, potential risks, compensating controls), as plain functions so `node --test`
// runs _text.test.ts against them. AI-written text is sometimes stored as a stringified list ("['Enforce MFA', 'Log access']", a str(list) on the
// server) or wrapped in stray quotes: it is parsed back into a numbered list for reading and into tidy numbered lines for the edit box; plain
// prose is left as it is. (Moved here unchanged from page.tsx.)

const LIST_MARKER = /^(\d+[.)]\s+|[-*•]\s+)/;

/** The items of a text that is a list in disguise: an array, a JSON or Python-repr array, or several numbered / bulleted lines; null for prose. */
export function parseListish(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  // JSON / Python-list-repr arrays, e.g. ["a","b"] or ['a','b']
  if (s.startsWith('[') && s.endsWith(']')) {
    for (const candidate of [s, s.replace(/'/g, '"')]) {
      try {
        const arr = JSON.parse(candidate);
        if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        // ponytail: the single→double quote swap breaks on apostrophes inside items; those just fall through to raw text, which is safe.
      }
    }
  }
  // Numbered / bulleted multi-line text: "1. a\n2. b" · "- a\n- b" · "1) a\n2) b"
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => LIST_MARKER.test(l))) {
    return lines.map((l) => l.replace(LIST_MARKER, '').trim()).filter(Boolean);
  }
  return null;
}

/** The text without the quotes it was wrapped in; '' for nothing, "[]", "{}", "null" or "None". */
export function cleanText(raw?: unknown): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s || ['""', "''", '[]', '{}', 'null', 'None'].includes(s)) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/** What an edit box starts with: numbered lines for a list, the clean text otherwise. */
export function toEditableText(raw?: unknown): string {
  const items = parseListish(raw);
  if (items && items.length > 1) return items.map((it, i) => `${i + 1}. ${it}`).join('\n');
  if (items && items.length === 1) return items[0];
  return cleanText(raw);
}
