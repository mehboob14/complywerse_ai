'use client';

// The strip of tabs under the head of the Overview, All assessments and Types (tabsModel.ts says which is lit and which are offered). Each tab is a link, so a tab opens in a new tab with a
// modifier click and the Back button works; the lit one is `aria-current="page"`. The strip scrolls sideways on a phone without making the page wider. While the person's rights are being read
// it keeps its height (an empty strip), so the page does not jump when the tabs appear.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { usePermissions } from '@/hooks/usePermissions';
import { tabOf, tabsFor } from './tabsModel';

const STRIP = 'flex min-h-ds-control overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-[500] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const OPEN = 'border-ds-primary text-ds-primary-text';
const SHUT = 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg';

export function AssessmentTabs() {
  const pathname = usePathname() ?? '';
  const { hasPermission, isLoading } = usePermissions();
  const current = tabOf(pathname);
  const tabs = isLoading ? [] : tabsFor(hasPermission, current);
  return (
    <nav aria-label="Assessments sections" className={STRIP}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} prefetch={false} aria-current={t.key === current ? 'page' : undefined} className={clsx(TAB, t.key === current ? OPEN : SHUT)}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
