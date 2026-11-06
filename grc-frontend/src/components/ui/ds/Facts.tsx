'use client';

// Fact and FactList: a label over its value, as a grid of facts (the details of a record, the band of figures of a drawer). A FactList is a `<dl>`; each Fact is a
// `<dt>` (12px, muted) over its `<dd>` (13px) inside a div, the valid way to group them. The grid fills the width with as many columns as fit (`min` is the
// narrowest a column gets), so one column on a phone and four on a wide window need no breakpoints. A long value wraps (a word with no break too). A Fact with
// no value says so ("—", or "Not set" where the person can set it: `empty`), never a blank. `variant="boxed"` gives each fact its own box (a band of figures).
//
//   <FactList><Fact label="Owner"><PersonChip name="Olivia Owner" /></Fact><Fact label="Next review" empty="Not set">{null}</Fact></FactList>
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { EMPTY } from '@/lib/format';

export interface FactProps {
  /** What the value is: "Owner". */
  label: string;
  /** The value. Left out, empty or false: `empty` is drawn in muted words. */
  children?: ReactNode;
  /** What to say when there is no value: the dash (not recorded, default) or "Not set" (the person can set it). */
  empty?: string;
}

const has = (children: ReactNode): boolean => children !== undefined && children !== null && children !== false && children !== '';

export function Fact({ label, children, empty = EMPTY }: FactProps) {
  return (
    <div className="min-w-0">
      <dt className="text-ds-label font-normal text-ds-fg-muted">{label}</dt>
      <dd className="mt-[2px] min-w-0 break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{has(children) ? children : <span className="text-ds-fg-muted">{empty}</span>}</dd>
    </div>
  );
}

export interface FactListProps {
  /** The Facts. */
  children: ReactNode;
  /** `plain` (default) is label over value; `boxed` gives each fact its own box. */
  variant?: 'plain' | 'boxed';
  /** The narrowest a column gets, in px (default 160): the grid has as many columns as fit. */
  min?: number;
  /** Layout only (margin, width). */
  className?: string;
}

// the boxed look is the parent's: every fact (a div) is a box, so a Fact needs no variant of its own
const BOXED = '[&>div]:rounded-ds-card [&>div]:border [&>div]:border-ds-border [&>div]:bg-ds-surface [&>div]:px-[12px] [&>div]:py-[10px]';

export function FactList({ children, variant = 'plain', min = 160, className }: FactListProps) {
  const column = Math.max(1, Math.floor(Number.isFinite(min) ? min : 160));
  return (
    <dl
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${column}px), 1fr))` }}
      className={clsx('grid min-w-0 gap-x-[16px] gap-y-[12px]', variant === 'boxed' && BOXED, className)}
    >
      {children}
    </dl>
  );
}
