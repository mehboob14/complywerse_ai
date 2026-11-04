'use client';

/**
 * The Documents area's tabs (Documents · Overview · Comply AI Studio · Attestation · Reviews · Exceptions · Settings), shown in the top bar instead of a row
 * of their own so the page below gets the height. From xl up every tab is an icon and a label (Settings is just the gear); below that
 * only the open tab keeps its label. With the Studio and the Settings gear there were six tabs, 629px of them against the 576px the top bar leaves at 1280:
 * from 1280 to 1359 the tabs' side padding is 4px, which made the six fit with their labels; the Overview tab (a seventh, ~90px) is not measured yet:
 * where the seven do not fit the strip scrolls sideways and brings the open tab into view. The product keeps its full name, "Comply AI Studio", on every screen; "Policy exceptions" is
 * "Exceptions" and "Document Reviews" is "Reviews" here, their full names staying as the tooltip and as what a screen reader says.
 * Which tabs there are, their names and order, who sees them and which page lights which come from the navigation registry
 * (lib/navRegistry.ts); this file is how a tab looks. Colours are explicit hex on purpose: the platform CSS repaints the accent
 * utilities (PITFALLS: grc-frontend UI).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ClipboardCheck, FileText, LayoutDashboard, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { studioApi } from '@/lib/studio/api';
import { usePermissions } from '@/hooks/usePermissions';
import { activeTab, isInArea, tabsFor } from '@/lib/navRegistry';
import { scrollDelta } from '@/lib/tabsModel';

// the look of each tab of the registry's 'documents' strip, by its id
const LOOK: Record<string, { icon: LucideIcon; iconOnly?: boolean }> = {
  documents: { icon: FileText },
  overview: { icon: LayoutDashboard },
  studio: { icon: Sparkles },
  attestation: { icon: ClipboardCheck },
  reviews: { icon: CalendarClock },
  exceptions: { icon: AlertTriangle },
  settings: { icon: Settings, iconOnly: true },
};

/** Whether a page belongs to the Documents area (the pages these tabs lead to). */
export const inDocumentsArea = (pathname: string | null) => isInArea('documents', pathname);

export default function DocumentsTabs() {
  const pathname = usePathname() ?? '';
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  const { hasPermission } = usePermissions();
  const studioOn = !!studio.data?.enabled;
  // a document opens in the AI Studio where it is on, so that tab is the open one there (the registry knows which page a tab takes)
  const tabs = tabsFor('documents', { studio: studioOn, can: hasPermission });
  const open = activeTab('documents', pathname, { studio: studioOn });
  // the strip scrolls sideways on a narrow screen: the tab that is open is brought into view (sideways only), so a page far along the strip says where it is
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const fit = () => {
      const box = strip.current;
      const here = box?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!box || !here) return;
      const b = box.getBoundingClientRect();
      const t = here.getBoundingClientRect();
      const by = scrollDelta({ start: b.left, end: b.right }, { start: t.left, end: t.right });
      if (by !== 0) box.scrollLeft += by;
    };
    fit();
    window.addEventListener('resize', fit);                       // turning the phone moves the strip's edges
    return () => window.removeEventListener('resize', fit);
  }, [pathname, tabs.length]);
  return (
    <nav ref={strip} aria-label="Documents" className="-mb-px flex min-w-0 self-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const active = t === open;
        const { icon: Icon, iconOnly } = LOOK[t.tab.id];
        return (
          <Link key={t.path} href={t.path} title={t.label} aria-label={t.label} aria-current={active ? 'page' : undefined}
            // the ring is inset: the strip scrolls sideways, which would clip one drawn outside the tab
            className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 xl:max-[1359px]:px-1 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f766e]',
              active ? 'border-[#0f766e] text-[#0f766e]' : 'border-transparent text-[#586472] hover:border-[#c3ccd5] hover:text-[#1f2933]')}>
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            <span className={iconOnly ? 'sr-only' : active ? undefined : 'hidden xl:inline'}>{t.shortLabel ?? t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
