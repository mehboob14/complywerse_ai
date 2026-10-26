'use client';

/**
 * The Documents area's tabs (Documents · Comply AI Studio · Attestation · Exceptions · Settings), shown in the top bar instead of a row
 * of their own so the page below gets the height. From xl up every tab is an icon and a label (Settings is just the gear); below that
 * only the open tab keeps its label. The product keeps its full name, "Comply AI Studio", on every screen; "Policy exceptions" is
 * "Exceptions" here, its full name staying as the tooltip and as what a screen reader says.
 * Colours are explicit hex on purpose: the platform CSS repaints the accent utilities (PITFALLS: grc-frontend UI).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, FileText, Settings, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { studioApi } from '@/lib/studio/api';
import { usePermissions } from '@/hooks/usePermissions';

// name: the full name (tooltip, screen reader); label: what the tab shows
const DOCUMENTS = { name: 'Documents', label: 'Documents', href: '/governance/documents', icon: FileText };
const ATTESTATION = { name: 'Attestation', label: 'Attestation', href: '/governance/documents/attestation', icon: ClipboardCheck };
const EXCEPTIONS = { name: 'Policy exceptions', label: 'Exceptions', href: '/governance/exceptions', icon: AlertTriangle };
const STUDIO = { name: 'Comply AI Studio', label: 'Comply AI Studio', href: '/governance/documents/studio', icon: Sparkles };      // only where the Comply AI Studio is on
const SETTINGS = { name: 'Settings', label: 'Settings', href: '/governance/settings', icon: Settings, iconOnly: true };        // administrators and governance:settings:* holders

/** Whether a page belongs to the Documents area (the pages these tabs lead to). */
export const inDocumentsArea = (pathname: string | null) =>
  !!pathname && (pathname.startsWith('/governance/documents') || pathname.startsWith('/governance/exceptions') || pathname.startsWith(SETTINGS.href));

export default function DocumentsTabs() {
  const pathname = usePathname() ?? '';
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  const tabs = studio.data?.enabled ? [DOCUMENTS, STUDIO, ATTESTATION, EXCEPTIONS] : [DOCUMENTS, ATTESTATION, EXCEPTIONS];
  if (usePermissions().hasPermission('governance:settings:*')) tabs.push(SETTINGS);
  // a document opens in the AI Studio where it is on, so that tab is the open one there
  const docInStudio = !!studio.data?.enabled && /^\/governance\/documents\/\d+$/.test(pathname);
  return (
    <nav aria-label="Documents" className="-mb-px flex min-w-0 self-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        // Documents only for itself and a document's own pages, not for the attestation or AI Studio pages under it
        const active = t === DOCUMENTS
          ? pathname === t.href || (!docInStudio && pathname.startsWith(`${t.href}/`) && !pathname.startsWith(ATTESTATION.href) && !pathname.startsWith(STUDIO.href))
          : t === STUDIO ? docInStudio || pathname.startsWith(t.href) : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} title={t.name} aria-label={t.name} aria-current={active ? 'page' : undefined}
            // the ring is inset: the strip scrolls sideways, which would clip one drawn outside the tab
            className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f766e]',
              active ? 'border-[#0f766e] text-[#0f766e]' : 'border-transparent text-[#586472] hover:border-[#c3ccd5] hover:text-[#1f2933]')}>
            <t.icon size={16} strokeWidth={1.75} aria-hidden />
            <span className={'iconOnly' in t && t.iconOnly ? 'sr-only' : active ? undefined : 'hidden xl:inline'}>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
