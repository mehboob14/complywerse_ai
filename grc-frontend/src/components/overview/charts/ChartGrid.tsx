'use client';

// ChartGrid and Cell: how the cards of an Overview's graphical part lie on the page. A 12-column grid from 1280px, 6 columns from 768px, one column below: a Cell
// says how many columns it takes on a wide screen and the grid halves or fills it on the smaller steps (3 and 4 take half the row at 768px, 6 and 8 and 12 the
// whole row). A phone gets one card per row, in reading order: the first card is the most important one. Cards are never folded away on a phone (the page is
// graphical there too); they are level in height inside a row (ChartCard fills its cell).
//
//   <ChartGrid><Cell span={8}><ChartCard …/></Cell><Cell span={4}><ChartCard …/></Cell></ChartGrid>
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export type Span = 3 | 4 | 5 | 6 | 7 | 8 | 12;

// written out in full so Tailwind sees every class
const SPAN: Record<Span, string> = {
  3: 'md:col-span-3 xl:col-span-3',
  4: 'md:col-span-3 xl:col-span-4',
  5: 'md:col-span-3 xl:col-span-5',
  6: 'md:col-span-6 xl:col-span-6',
  7: 'md:col-span-6 xl:col-span-7',
  8: 'md:col-span-6 xl:col-span-8',
  12: 'md:col-span-6 xl:col-span-12',
};

export function ChartGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-1 items-stretch gap-[16px] md:grid-cols-6 xl:grid-cols-12', className)}>{children}</div>;
}

export function Cell({ span, children, className }: { span: Span; children: ReactNode; className?: string }) {
  return <div className={clsx('min-w-0', SPAN[span], className)}>{children}</div>;
}
