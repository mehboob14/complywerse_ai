// The arithmetic and the words of a Pager, apart from React so `node --test` can pin them (pagerModel.test.ts): which items a page shows, whether
// there is a page before and after, "1–25 of 1,243 documents", and the page sizes on offer. The component is components/ui/ds/Pager.tsx.
import { formatCount } from './format.ts';

export interface PageRange {
  /** the page shown, 1-based, after clamping into 1..pages */
  page: number;
  /** pages in all, at least 1 */
  pages: number;
  /** position of the first and the last item on this page, 1-based; both 0 when there is nothing */
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}

/** What `page` of `pageSize` items shows out of `total`. `total` must be the TRUE count of items on the server (the number the API reports), never
 *  the length of the array that came back: a list the API caps at 100 rows out of 1,243 must read "1–100 of 1,243", not "1–100 of 100". A page
 *  outside the range is clamped (page 9 of 3 shows page 3); a page size that is not a positive number puts everything on one page. */
export function pageRange(page: number, pageSize: number, total: number): PageRange {
  const count = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : Math.max(1, count);
  const pages = Math.max(1, Math.ceil(count / size));
  const at = Math.min(pages, Math.max(1, Number.isFinite(page) ? Math.floor(page) : 1));
  return {
    page: at,
    pages,
    from: count === 0 ? 0 : (at - 1) * size + 1,
    to: count === 0 ? 0 : Math.min(count, at * size),
    hasPrev: at > 1,
    hasNext: at < pages,
  };
}

/** "1–25 of 1,243 documents" (an en dash, so a screen reader says "to"); "0 documents" when there are none. `noun` is the plural. */
export function rangeText(range: PageRange, total: number, noun: string): string {
  if (range.to === 0) return `0 ${noun}`;
  return `${formatCount(range.from)}–${formatCount(range.to)} of ${formatCount(Math.floor(total))} ${noun}`;
}

export const DEFAULT_PAGE_SIZES: readonly number[] = [10, 25, 50, 100];

/** The choices of the "Rows per page" select: the sizes offered, ascending and without repeats, plus the size in use if it is not among them. */
export function pageSizeOptions(sizes: readonly number[] = DEFAULT_PAGE_SIZES, current?: number): number[] {
  const all = sizes.concat(current !== undefined ? [current] : []).filter((n) => Number.isFinite(n) && n >= 1).map(Math.floor);
  return all.filter((n, i) => all.indexOf(n) === i).sort((a, b) => a - b);
}
