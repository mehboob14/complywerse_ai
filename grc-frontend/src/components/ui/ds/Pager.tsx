'use client';

// The foot of a paged list: "1–25 of 1,243 documents", the page, Previous and Next, and (when the caller wants it) the page size.
// The arithmetic and the words are lib/pagerModel.ts (tested). The range is a polite live region, so a screen reader hears the new range after
// a page change. Nothing here fetches or slices: the caller pages its data and passes the position.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import { formatCount } from '@/lib/format';
import { pageRange, pageSizeOptions, rangeText, type PagerNoun } from '@/lib/pagerModel';

export interface PagerProps {
  /** 1-based; a page outside the range is clamped into it */
  page: number;
  pageSize: number;
  /** The TRUE number of items on the server: the `total` the API reports, never the length of the array that came back. A list the API caps at
   *  100 rows out of 1,243 must read "1–100 of 1,243", not "1–100 of 100". */
  total: number;
  onPage: (page: number) => void;
  /** Gives the person a "Rows per page" choice. The caller decides what else changes with it (usually: back to page 1). */
  onPageSize?: (pageSize: number) => void;
  /** the choices; default 10, 25, 50, 100 (the size in use is always among them) */
  pageSizes?: readonly number[];
  /** what is counted: the plural ("documents"), or `{ one: 'committee', other: 'committees' }` so a list of one reads "1–1 of 1 committee" */
  noun?: PagerNoun;
  /** layout only (margin, width) */
  className?: string;
}

const BUTTON = 'inline-flex aspect-square h-ds-control shrink-0 items-center justify-center rounded-ds-control border border-ds-border-strong bg-ds-surface text-ds-fg-body focus-visible:outline-none focus-visible:shadow-ds-ring enabled:hover:bg-ds-surface-hover disabled:cursor-not-allowed disabled:opacity-50';
const SELECT = 'h-ds-control rounded-ds-control border border-ds-border-control bg-ds-surface px-[8px] text-ds-body text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring';

export function Pager({ page, pageSize, total, onPage, onPageSize, pageSizes, noun = 'items', className }: PagerProps) {
  const range = pageRange(page, pageSize, total);
  return (
    <nav aria-label="Pagination" className={clsx('flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]', className)}>
      <span aria-live="polite" className="text-ds-body text-ds-fg-muted">{rangeText(range, total, noun)}</span>
      <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
        {onPageSize && (
          <label className="flex items-center gap-2 text-ds-label text-ds-fg-muted">
            Rows per page
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className={SELECT}>
              {pageSizeOptions(pageSizes, pageSize).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {/* everything fits on one page: the count and the page size stay (the true total is the point), the page controls have nothing to do */}
        {range.pages > 1 && (
          <>
            <span className="text-ds-label tabular-nums text-ds-fg-muted">Page {formatCount(range.page)} of {formatCount(range.pages)}</span>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous page" title="Previous page" disabled={!range.hasPrev} onClick={() => onPage(range.page - 1)} className={BUTTON}>
                <ChevronLeft aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
              </button>
              <button type="button" aria-label="Next page" title="Next page" disabled={!range.hasNext} onClick={() => onPage(range.page + 1)} className={BUTTON}>
                <ChevronRight aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
              </button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
