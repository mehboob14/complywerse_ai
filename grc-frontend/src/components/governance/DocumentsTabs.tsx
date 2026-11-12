'use client';

/**
 * The Documents area's tabs (Documents · Comply AI Studio · Attestation · Reviews · Exceptions · Settings), shown in the top bar instead of a row
 * of their own so the page below gets the height. Every tab is an icon and a label (Settings is just the gear) while the strip fits; when it does not,
 * only the open tab keeps its label (the others have it as their tooltip and for a screen reader). The strip is measured with every label showing, once the tabs are
 * known, and again whenever its width changes (the window, the menu opening): the labels go when the strip does not fit (the At a glance tab, which made the strip eight, went to the Governance Overview on 2026-11-12). Past that the strip still scrolls sideways and brings the open tab into view. The product keeps its full name, "Comply AI Studio", on every screen; "Policy exceptions" is
 * "Exceptions" and "Document Reviews" is "Reviews" here, their full names staying as the tooltip and as what a screen reader says.
 * Which tabs there are, their names and order, who sees them and which page lights which come from the navigation registry
 * (lib/navRegistry.ts); this file is how a tab looks. Colours are explicit hex on purpose: the platform CSS repaints the accent
 * utilities (PITFALLS: grc-frontend UI).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ClipboardCheck, FileText, Settings, Sparkles, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { studioApi } from '@/lib/studio/api';
import { usePermissions } from '@/hooks/usePermissions';
import { activeTab, isInArea, tabsFor } from '@/lib/navRegistry';
import { scrollDelta } from '@/lib/tabsModel';

// the look of each tab of the registry's 'documents' strip, by its id
const LOOK: Record<string, { icon: LucideIcon; iconOnly?: boolean }> = {
  documents: { icon: FileText },
  studio: { icon: Sparkles },
  attestation: { icon: ClipboardCheck },
  reviews: { icon: CalendarClock },
  exceptions: { icon: AlertTriangle },
  settings: { icon: Settings, iconOnly: true },
};

// measured before the browser paints (no flash of the wrong strip); on the server there is nothing to measure
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Whether a page belongs to the Documents area (the pages these tabs lead to). */
export const inDocumentsArea = (pathname: string | null) => isInArea('documents', pathname);

export default function DocumentsTabs({ ownerOnly = false }: { ownerOnly?: boolean }) {
  const pathname = usePathname() ?? '';
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  const { hasPermission } = usePermissions();
  const studioOn = !!studio.data?.enabled;
  // a document opens in the AI Studio where it is on, so that tab is the open one there (the registry knows which page a tab takes)
  const tabs = tabsFor('documents', { studio: studioOn, can: hasPermission, ownerOnly });
  const open = activeTab('documents', pathname, { studio: studioOn });
  // the strip scrolls sideways on a narrow screen: the tab that is open is brought into view (sideways only), so a page far along the strip says where it is
  const strip = useRef<HTMLElement>(null);
  // the strip does not fit with every label: only the open tab keeps its (see the comment at the top)
  const [tight, setTight] = useState(false);
  const full = useRef(0);                                             // the strip's width with every label showing
  useBeforePaint(() => { setTight(false); }, [tabs.length]);          // other tabs: measure the whole strip again
  useBeforePaint(() => {
    const box = strip.current;
    if (!box) return undefined;
    if (!tight) full.current = box.scrollWidth;
    // the room is what the top bar gives the strip (its own width is only as wide as its tabs, so it cannot say)
    const room = box.parentElement;
    const decide = () => setTight(full.current > (room ? room.clientWidth - 8 : box.clientWidth) + 1);
    decide();
    if (typeof ResizeObserver === 'undefined' || !room) {
      window.addEventListener('resize', decide);
      return () => window.removeEventListener('resize', decide);
    }
    const watch = new ResizeObserver(decide);                         // the window, and the menu opening or closing
    watch.observe(room);
    return () => watch.disconnect();
  }, [tight, tabs.length]);
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
            <span className={iconOnly ? 'sr-only' : active || !tight ? undefined : 'hidden'}>{t.shortLabel ?? t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
