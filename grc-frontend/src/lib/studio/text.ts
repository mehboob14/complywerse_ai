/** Small text helpers shared by the studio screens. */
import type { Segment } from './api';

/** The placeholders that must be filled in before a document is used (the same patterns the server checks). */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[\[[^\[\]]{1,200}\]\]/g,
  /\[(?:Insert|Enter|Add|Specify|Select|Provide|State|Describe|Name of|Date|Organi[sz]ation|Company|Entity|Title|Owner|Department|Version|TBD|TBC|Click|Your)[^\[\]]{0,150}\]/gi,
  /<<[^<>]{1,150}>>/g,
  /\{\{[^{}]{1,150}\}\}/g,
  /\b(?:TBD|TBC)\b|\bX{3,}\b|\bXX\/XX\/(?:XX)?XX\b|\b(?:DD\/MM\/YYYY|dd\/mm\/yyyy)\b|\blorem ipsum\b/gi,
];

/** Where the placeholders are in a text, in order. A stretch matched by two patterns (`[[Date]]` is also `[Date]`) counts once. */
export function placeholderSpans(text: string): { start: number; end: number }[] {
  const taken: { start: number; end: number }[] = [];
  for (const base of PLACEHOLDER_PATTERNS) {
    const re = new RegExp(base.source, base.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex += 1;
      else if (!taken.some((t) => start < t.end && t.start < end)) taken.push({ start, end });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** How many placeholders a text still has (the server's count is the one that decides; this is for the bar). */
export function countPlaceholders(text: string): number {
  return placeholderSpans(text).length;
}

// built from a string: the project's TypeScript target does not allow the `u` flag on a literal
const TOKEN = new RegExp('\\s+|[\\p{L}\\p{N}_]+|[^\\p{L}\\p{N}_\\s]', 'gu');
const WORD = new RegExp("[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*", 'gu');

/** How many words a text has. */
export function countWords(text: string): number {
  return (text.match(WORD) ?? []).length;
}

/** A word-level difference between two texts: `[['equal'|'delete'|'insert', text], ...]`. */
export function wordDiff(a: string, b: string): Segment[] {
  const x = a.match(TOKEN) ?? [];
  const y = b.match(TOKEN) ?? [];
  if (x.length * y.length > 3_000_000) {
    return a === b ? [['equal', a]] : [['delete', a], ['insert', b]];
  }
  const w = y.length + 1;
  const table = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      table[i * w + j] = x[i] === y[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  const out: Segment[] = [];
  const push = (op: Segment[0], text: string) => {
    if (out.length && out[out.length - 1][0] === op) out[out.length - 1] = [op, out[out.length - 1][1] + text];
    else out.push([op, text]);
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('equal', x[i]);
      i++;
      j++;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      push('delete', x[i++]);
    } else {
      push('insert', y[j++]);
    }
  }
  while (i < x.length) push('delete', x[i++]);
  while (j < y.length) push('insert', y[j++]);
  return out;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  // the server's times are naive UTC
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
