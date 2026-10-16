'use client';

/**
 * The Documents area's tabs (Documents · AI Studio · Attestation · Policy Exceptions), shown in the top bar instead of a row of
 * their own so the page below gets the height. Below xl only the open tab keeps its label; the others show their icon.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, FileText, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { studioApi } from '@/lib/studio/api';

const DOCUMENTS = { name: 'Documents', href: '/governance/documents', icon: FileText };
const ATTESTATION = { name: 'Attestation', href: '/governance/documents/attestation', icon: ClipboardCheck };
const EXCEPTIONS = { name: 'Policy Exceptions', href: '/governance/exceptions', icon: AlertTriangle };
const STUDIO = { name: 'AI Studio', href: '/governance/documents/studio', icon: Sparkles };      // only where the AI Studio is on

/** Whether a page belongs to the Documents area (the pages these tabs lead to). */
export const inDocumentsArea = (pathname: string | null) =>
  !!pathname && (pathname.startsWith('/governance/documents') || pathname.startsWith('/governance/exceptions'));

export default function DocumentsTabs() {
  const pathname = usePathname() ?? '';
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  const tabs = studio.data?.enabled ? [DOCUMENTS, STUDIO, ATTESTATION, EXCEPTIONS] : [DOCUMENTS, ATTESTATION, EXCEPTIONS];
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
            className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors',
              active ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800')}>
            <t.icon size={14} aria-hidden />
            <span className={active ? undefined : 'hidden xl:inline'}>{t.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}
