'use client';

// The small pieces the Reviews list, the calendar's day panel and its phone agenda share: how a document is opened, and how a review's state reads.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { StatusPill } from '@/components/ui/ds';
import { EMPTY } from '@/lib/format';
import { reviewStatus, statusPill } from '@/lib/status';
import { dayOf, dueWords, type DayKey, type DueState } from './calendarModel';

/** A review opens the document it is about, on its own page (in the AI Studio where that is on). */
export const documentHref = (id: number): string => `/governance/documents/${id}`;

// the padding and the matching negative margin make the link 24px high (44px on a phone) without moving anything: a line of text is 20px
const LINK = 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] font-medium text-ds-fg underline-offset-[2px] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

/** The document's title as the link that opens it. A long title wraps and is cut at two lines; the whole of it is the tooltip. */
export function DocumentLink({ id, title, className }: { id: number; title: string; className?: string }) {
  return (
    <Link href={documentHref(id)} title={title} className={clsx('line-clamp-2 [overflow-wrap:anywhere]', LINK, className)}>
      {title}
    </Link>
  );
}

/** Where a review date stands: the state as a pill (a word, never a colour alone) with how far off it is under it; no date, the dash. */
export function DueStatus({ state, due, today }: { state: DueState | null; due: string | null | undefined; today: DayKey }): ReactNode {
  if (!state) return <span className="text-ds-fg-muted">{EMPTY}</span>;
  const words = dueWords(dayOf(due), today, state);
  return (
    <div className="flex flex-col items-start gap-[2px]">
      <StatusPill size="sm" {...statusPill(reviewStatus, state)} />
      {words && <span className="text-ds-label font-normal text-ds-fg-muted">{words}</span>}
    </div>
  );
}
