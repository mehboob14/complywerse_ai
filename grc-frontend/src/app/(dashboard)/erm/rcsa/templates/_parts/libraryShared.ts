import type { ReactNode } from 'react';
import type { ExplorerFit } from '@/components/records/explorerFit';

/** What a library kind hands the page head: the count line under the title and the buttons on the right (the page draws the head, the kind knows what goes in it). */
export interface LibraryHeadArgs { fit: ExplorerFit; meta?: string; actions?: ReactNode }
export type RenderHead = (args: LibraryHeadArgs) => ReactNode;

/** The row (or card) a details panel was opened from, found again when focus has to go back to it. */
export const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

/** The options of a facet from the values the rows have: each once, in the order of `label`. */
export function uniqueOptions<R>(rows: readonly R[], values: (r: R) => readonly string[], label: (v: string) => string = (v) => v): Array<{ value: string; label: string }> {
  const seen: Record<string, boolean> = {};
  rows.forEach((r) => values(r).forEach((v) => { seen[v] = true; }));
  return Object.keys(seen).map((value) => ({ value, label: label(value) })).sort((a, b) => a.label.localeCompare(b.label));
}
