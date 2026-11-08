'use client';

// The small pieces the three registers draw the same way: a title that opens the details panel (a modified click or the middle button still opens the page in a new tab), a day with
// what it means in words, the owner, and the previous / next buttons of a details panel. Colour never carries meaning alone: a late day says "Overdue by 3 days".
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { IconButton, PersonChip } from '@/components/ui/ds';
import { EMPTY, formatDate } from '@/lib/format';
import { dueWords, windowOf } from '../bcmModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
export const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** The name of a record in a register: two lines, the whole of it as the title; a plain click peeks (the details panel), a modified click opens the record's page. `sub` is the muted line under it. */
export function PeekTitle({ href, title, onPeek, sub }: { href: string; title: string; onPeek: () => void; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div dir="auto" className="line-clamp-2 min-w-0 text-ds-body [overflow-wrap:anywhere]">
        <Link
          href={href}
          prefetch={false}
          title={title}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); onPeek(); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {title}
        </Link>
      </div>
      {sub && <p className="m-0 truncate text-ds-label text-ds-fg-muted">{sub}</p>}
    </div>
  );
}

/** A day with what it means: "12 Nov 2026" and under it "Overdue by 3 days" / "Due in 9 days". `noun` is what is due ("Due", "Review", "Starts"); `late` says whether a day gone by is a failing (a closed finding is not). */
export function DayCell({ value, now, noun = 'Due', late = true, empty = EMPTY }: { value: string | null | undefined; now: number; noun?: string; late?: boolean; empty?: string }) {
  if (!value) return <span className="text-ds-body text-ds-fg-muted"><span aria-hidden>{empty}</span><span className="sr-only">No date</span></span>;
  const gone = late && windowOf(value, now) === 'overdue';
  return (
    <span className="flex min-w-0 flex-col">
      <span className="whitespace-nowrap text-ds-body text-ds-fg">{formatDate(value, { calendar: true })}</span>
      {late && <span className={`truncate text-ds-label ${gone ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{dueWords(value, now, noun)}</span>}
    </span>
  );
}

/** The owner: a person, or a dash that a screen reader reads as "Unassigned". `withName`: the wider look beside the avatar. */
export function OwnerCell({ name, withName = false, who = 'Owner' }: { name: string | null | undefined; withName?: boolean; who?: string }) {
  if (!name) return <span className="text-ds-body text-ds-fg-muted" title={`${who}: nobody`}><span aria-hidden>{EMPTY}</span><span className="sr-only">Unassigned</span></span>;
  return withName ? <PersonChip name={name} /> : (
    <span className="inline-flex" title={`${who}: ${name}`}><PersonChip name={name} className="[&>span:last-child]:sr-only" /></span>
  );
}

/** Previous / next record in the list as it is shown, for the buttons in the head of a details panel. */
export function StepButtons({ noun, hasPrev, hasNext, onStep }: { noun: string; hasPrev: boolean; hasNext: boolean; onStep: (dir: -1 | 1) => void }) {
  return (
    <>
      <IconButton label={`Previous ${noun}`} aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
      <IconButton label={`Next ${noun}`} aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
    </>
  );
}

/** The row a panel was opened from, found again when focus has to go back to it. */
export const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = rows.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};
