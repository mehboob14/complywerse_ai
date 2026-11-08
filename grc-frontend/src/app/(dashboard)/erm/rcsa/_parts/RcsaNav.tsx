'use client';

// The four sections of RCSA, as links in the page head (the area's own tab strip is hidden for /erm/rcsa, so the page carries its tabs): Worklist, Campaigns, Templates,
// Findings. They look like the kit's Tabs (the same strip and the same open-tab underline) but are real links, so each section is an address of its own and a middle click
// or a reload lands where it should. Counts are the server's true totals, shown only when the page has them.
import Link from 'next/link';
import { clsx } from 'clsx';
import { formatCount } from '@/lib/format';

export type RcsaSection = 'worklist' | 'campaigns' | 'templates' | 'findings';

const SECTIONS: ReadonlyArray<{ key: RcsaSection; label: string; href: string }> = [
  { key: 'worklist', label: 'Worklist', href: '/erm/rcsa' },
  { key: 'campaigns', label: 'Campaigns', href: '/erm/rcsa/campaigns' },
  { key: 'templates', label: 'Templates', href: '/erm/rcsa/templates' },
  { key: 'findings', label: 'Findings', href: '/erm/rcsa/findings' },
];

const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center gap-[6px] whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const BADGE = 'inline-flex min-w-[20px] items-center justify-center rounded-full px-[6px] text-ds-label tabular-nums';

export function RcsaNav({ active, counts }: { active: RcsaSection; counts?: Partial<Record<RcsaSection, number>> }) {
  return (
    <nav aria-label="RCSA sections" className={STRIP}>
      {SECTIONS.map((s) => {
        const open = s.key === active;
        const n = counts?.[s.key];
        return (
          <Link
            key={s.key}
            href={s.href}
            aria-current={open ? 'page' : undefined}
            className={clsx(TAB, open ? 'border-ds-primary text-ds-primary-text' : 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg')}
          >
            {s.label}
            {n != null && n > 0 && <span className={clsx(BADGE, open ? 'bg-ds-primary-soft text-ds-primary-text' : 'bg-ds-border text-ds-fg-muted')}>{formatCount(n)}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
