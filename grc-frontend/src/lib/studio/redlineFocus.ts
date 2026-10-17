/** Which rows of a redline are the change a card's "Show it in the document" asked for. Pure, so `node --test` checks it. */
import type { RedlineRow, Segment } from './api';

/** The change a card asks to see: the text of the blocks it wrote and of those it replaced or removed. */
export interface Focus { after: string[]; before: string[] }

const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

/** A row's text on one side of the change, as the server's blocks hold it (a table: every cell, joined with " | "). */
function sideText(row: RedlineRow, side: 'after' | 'before'): string {
  const keep = (op: string) => op === 'equal' || op === (side === 'after' ? 'insert' : 'delete');
  const join = (segs: Segment[]) => segs.filter(([op]) => keep(op)).map(([, t]) => t).join('');
  if (row.kind === 'table' && row.table) {
    return row.table.filter((r) => r.status !== (side === 'after' ? 'deleted' : 'inserted')).flatMap((r) => r.cells.map(join)).join(' | ');
  }
  return join(row.segments ?? []);
}

/** The indexes of the changed rows holding the card's text (a card keeps a block's first 600 characters: a long one by its start). */
export function focusRows(rows: RedlineRow[], focus: Focus | undefined): Set<number> {
  const out = new Set<number>();
  if (!focus) return out;
  const wanted = (raws: string[]) => raws.map((r) => ({ text: norm(r), cut: r.length >= 600 })).filter((w) => w.text);
  const after = wanted(focus.after);
  const before = wanted(focus.before);
  const hit = (text: string, list: { text: string; cut: boolean }[]) => {
    const n = norm(text);
    return list.some((w) => n === w.text || (w.cut && n.startsWith(w.text)));
  };
  rows.forEach((r, i) => {
    if (r.status === 'equal') return;
    if ((r.status !== 'deleted' && hit(sideText(r, 'after'), after)) || (r.status !== 'inserted' && hit(sideText(r, 'before'), before))) out.add(i);
  });
  return out;
}
