'use client';

// The strip under the Frameworks heading: Journeys | Library | Onboarding. Journeys and Library are two registers of one page (?tab=), Onboarding is its own page, so these are links (the one the
// person is on is `aria-current`), drawn like the kit's tab strip. No counts on the strip: each tab says its own true counts in its quick views. The list and the addresses are hubAddress.ts (STRIP).
import Link from 'next/link';
import { clsx } from 'clsx';
import { STRIP, type StripKey } from './hubAddress';

const BAR = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-[500] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export function FrameworksStrip({ current }: { current: StripKey }) {
  return (
    <nav aria-label="Frameworks pages" className={BAR}>
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
