'use client';

// The strip across the top of the Reports area: four pages, one lit. It is a row of links (each tab is a page of its own, with its own address), drawn like the kit's tabs. A tab is offered to the
// people its page lets in (stripModel.ts). It says nothing while the person's rights are still loading, and nothing at all when they have a single tab (a strip of one is not a choice).
import Link from 'next/link';
import { clsx } from 'clsx';
import { usePermissions } from '@/hooks/usePermissions';
import { stripTabOf, visibleTabs } from './stripModel';

const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const TAB_OPEN = 'border-ds-primary text-ds-primary-text';
const TAB_SHUT = 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg';

export function ReportsStrip({ pathname }: { pathname: string }) {
  const { hasPermission, isLoading } = usePermissions();
  if (isLoading) return null;
  const tabs = visibleTabs((right) => hasPermission(right));
  if (tabs.length < 2) return null;
  const open = stripTabOf(pathname);
  return (
    <nav aria-label="Reports sections" className={STRIP}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === open ? 'page' : undefined} className={clsx(TAB, t.key === open ? TAB_OPEN : TAB_SHUT)}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
