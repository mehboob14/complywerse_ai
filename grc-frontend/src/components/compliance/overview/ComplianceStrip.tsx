'use client';

// The strip that opens the Compliance Overview and the pages the Overview used to reach only through tiles (Controls, Control Library, Statements, Assurance: P-23). They are
// pages of their own, so these are links (the page the person is on is `aria-current`), drawn like the kit's tab strip. The Overview and Statements draw it; a page that joins them
// passes its own `current`. The list and the addresses are overviewModel.ts (STRIP).
import Link from 'next/link';
import { clsx } from 'clsx';
import { STRIP, type StripItem } from './overviewModel';

const BAR = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-[500] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export function ComplianceStrip({ current }: { current: StripItem['key'] }) {
  return (
    <nav aria-label="Compliance pages" className={BAR}>
      {STRIP.map((item) => {
        const open = item.key === current;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={open ? 'page' : undefined}
            className={clsx(TAB, open ? 'border-ds-primary text-ds-primary-text' : 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
