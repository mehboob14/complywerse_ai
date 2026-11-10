'use client';

// The two strips of links the module draws, both from the navigation model (railModel.ts):
//   VendorTabs  the pages an entry groups (Vendors: Register, Assessments, Contracts, Check-ins; Monitoring; Insights; Setup), under the page's head. A page that draws its own head
//               (HEAD 'page') puts <VendorTabs /> right under it; for every other page the layout does. Nothing for an entry without tabs.
//   ModuleRow   the eight entries as one row, drawn ONLY while the sidebar does not list them (layout.tsx decides): the module is never a dead end. Once navAccess lists the eight
//               entries as sub-items it is never drawn.
// Each tab is a link (a modifier click opens it in a new tab, Back works) and the one on is `aria-current="page"`, drawn like the kit's strip; the strip scrolls sideways on a phone
// without making the page wider. Tokens and arbitrary values only (kit rules).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { badgeText } from './portfolioModel';
import { usePortfolioCounts } from './portfolioApi';
import { RAIL, entryOf, tabActive } from './railModel';

const STRIP = 'flex min-h-ds-control overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center gap-[6px] whitespace-nowrap border-b-2 px-[12px] text-ds-body font-[500] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const OPEN = 'border-ds-primary text-ds-primary-text';
const SHUT = 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg';

export function VendorTabs() {
  const pathname = usePathname() ?? '';
  const entry = entryOf(pathname);
  if (!entry?.tabs) return null;
  return (
    <nav aria-label={`${entry.name} pages`} className={STRIP}>
      {entry.tabs.map((t) => {
        const here = tabActive(pathname, t.href);
        return (
          <Link key={t.href} href={t.href} prefetch={false} aria-current={here ? 'page' : undefined} className={clsx(TAB, here ? OPEN : SHUT)}>
            {t.name}
          </Link>
        );
      })}
    </nav>
  );
}

export function ModuleRow() {
  const pathname = usePathname() ?? '';
  const counts = usePortfolioCounts();
  const on = entryOf(pathname);
  return (
    <nav aria-label="Third-party risk" className={STRIP}>
      {RAIL.map((item) => {
        const here = on?.key === item.key;
        const n = badgeText(item.count ? counts?.[item.count] : 0);
        return (
          <Link key={item.key} href={item.href} prefetch={false} aria-current={here ? 'page' : undefined} className={clsx(TAB, here ? OPEN : SHUT)}>
            {item.name}
            {n && (
              <span className={clsx('inline-flex min-w-[20px] items-center justify-center rounded-full px-[6px] text-ds-label tabular-nums', here ? 'bg-ds-primary-soft text-ds-primary-text' : 'bg-ds-border text-ds-fg-muted')}>
                {n}<span className="sr-only"> {item.waiting}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
