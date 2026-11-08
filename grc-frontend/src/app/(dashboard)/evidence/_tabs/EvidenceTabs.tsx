'use client';

// The strip of tabs under the head of every Evidence Management page (tabsModel.ts says which is lit). Each tab is a link, so a tab opens in a new tab with a modifier click and the
// Back button works; the lit one is `aria-current="page"`. The strip scrolls sideways on a phone without making the page wider.
import Link from 'next/link';
import { clsx } from 'clsx';
import { EVIDENCE_TABS, type EvidenceTab } from './tabsModel';

const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-[500] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const OPEN = 'border-ds-primary text-ds-primary-text';
const SHUT = 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg';

export function EvidenceTabs({ current }: { current: EvidenceTab }) {
  return (
    <nav aria-label="Evidence Management sections" className={STRIP}>
      {EVIDENCE_TABS.map((t) => (
        <Link key={t.key} href={t.href} prefetch={false} aria-current={t.key === current ? 'page' : undefined} className={clsx(TAB, t.key === current ? OPEN : SHUT)}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
