'use client';

// The foot of a paged list: "26–50 of 140 vendors", the page, and the two arrows. Nothing at all while everything fits on one page.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BTN_ICON } from '../_ui';

export default function Pager({ page, pageSize, total, noun, onPage }: {
  page: number;
  pageSize: number;
  total: number;
  /** what is counted: "vendors", "findings" */
  noun: string;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e1e6eb] px-4 py-2.5">
      <p className="text-[13px] leading-5 text-[#586472]">{from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')} {noun}</p>
      <div className="flex items-center gap-2">
        <span className="text-[13px] tabular-nums text-[#586472]">Page {page} of {pages}</span>
        <button type="button" className={BTN_ICON} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" title="Previous page">
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
        <button type="button" className={BTN_ICON} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" title="Next page">
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
