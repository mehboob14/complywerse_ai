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

/** What Save to the library does to a library document in this status (doc_lifecycle.changed_after_review); none for a draft.
 *  `undefined`: a server that does not send the status yet. `inForce`: the version everyone else reads meanwhile (the published one). */
export function saveWarning(status: string | null | undefined, inForce?: string | null): string | null {
  const warning = status === undefined ? 'If the document is approved or published, saving changed text sends it back to review.'
    : status === 'pending_review' || status === 'pending_approval' ? 'Saving makes a new version and everyone signs again from the start; signatures so far no longer count.'
    : status === 'approved' || status === 'published' || status === 'exception_applied' ? 'It goes back to review with the same reviewers and approvers; with nobody set it becomes a draft again.'
    : null;
  const keeps = inForce ? `Everyone else keeps reading the published version v${inForce} until this one is approved and published.` : null;
  return [warning, keeps].filter(Boolean).join(' ') || null;
}

/** Whether the studio's text may be saved to the library: not by someone who may only read the document (`may_save` false;
 *  missing: allowed), and by nobody while it is archived (D29: it is restored first). */
export function maySaveToLibrary(s: { may_save?: boolean; document_status?: string | null }): boolean {
  return s.may_save !== false && s.document_status !== 'archived';
}

export const ARCHIVED_NOTE = 'This document is archived, so nothing here is saved to the library. Restore it in the library to change it.';

/** The line after changes are accepted: written into the document when the library has them too (or the work is not in the
 *  library yet), else kept here in the studio (`saved`: the accept's `library_version.saved`). */
export function acceptedLine(n: number, inLibrary: boolean, saved: boolean): string {
  return `${plural(n, 'change')} accepted ${!inLibrary || saved ? 'and written into the document' : 'here in the studio; the library is not changed'}.`;
}

/** The toast after Save to the library: the version, major or minor, and where the document is now (`before`: its status before). */
export function savedNote(r: { version: string; change?: 'major' | 'minor' | null; status?: string; in_place?: boolean }, before?: string | null): { title: string; message?: string } {
  // a document not published yet collects every change in one version: it stays that number until it is published
  const title = r.in_place ? `Saved in version ${r.version}${r.change ? ` (${r.change} change)` : ''}`
    : `Saved as version ${r.version}${r.change ? ` (${r.change} change)` : ''}`;
  if (r.in_place && (r.status === 'draft' || !r.status)) {
    return { title, message: `It stays version ${r.version} until it is published: changes made before then go into this version.` };
  }
  const message = r.status === 'pending_review' ? 'It is in review again: everyone signs from the start.'
    : r.status === 'pending_approval' ? 'It is waiting for approval: the approvers sign from the start.'
    : r.status === 'draft' && before && before !== 'draft' ? 'It is a draft again: choose its reviewers and send it for review.'
    : undefined;
  return { title, message };
}

/** A count as the screens write it: 16,278 (not 16278). */
export function num(n: number): string {
  return n.toLocaleString('en');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
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
