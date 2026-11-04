'use client';

// A number of the overview. With an address it is a link that opens the library on exactly what it counts; without one (the server gave none:
// the library cannot filter on it) it is plain text. A zero is quiet (muted) but is still a link, so every number behaves alike. What a screen
// reader hears is what the link opens ("3 overdue reviews. Open in the library"); the number alone would say nothing.
import Link from 'next/link';
import { clsx } from 'clsx';
import { formatCount } from '@/lib/format';
import { figureName, type Tone } from './_model';

const TONE: Record<Tone, string> = { default: 'text-ds-fg', success: 'text-ds-success', warning: 'text-ds-warning', danger: 'text-ds-danger' };
const NUMBER = 'tabular-nums';
const BIG = 'text-[20px] font-[600] leading-[28px]';
const SMALL = 'text-ds-body font-medium';

export function Figure({ value, href, noun, tone = 'default', big = false, className }: {
  value: number;
  href: string | null;
  /** what it counts, for the name of the link: "overdue reviews" */
  noun: string;
  tone?: Tone;
  /** 20px, for the figure a block is about */
  big?: boolean;
  className?: string;
}) {
  const look = clsx(NUMBER, big ? BIG : SMALL, value === 0 ? 'text-ds-fg-muted' : TONE[tone], className);
  if (!href) return <span className={look}>{formatCount(value)}</span>;
  return (
    <Link
      href={href}
      aria-label={figureName(value, noun)}
      className={clsx(look, 'inline-block min-w-[24px] rounded-ds-control text-right hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring')}
    >
      {formatCount(value)}
    </Link>
  );
}
