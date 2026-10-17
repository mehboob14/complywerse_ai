'use client';

/**
 * A governance document's one link. Where the AI Studio is on, it opens in the AI Studio's document view (read, act, Edit opens the
 * person's draft); only where it is off, the classic page. Old ?tab= links keep working in both.
 */
import { useQuery } from '@tanstack/react-query';
import { PageLoader } from '@/components/ui';
import { studioApi } from '@/lib/studio/api';
import DocumentStudio from './_DocumentStudio';
import { ClassicDocumentPage } from './_LegacyDocumentPage';
import { inStudio } from '../_view/docRoute';

export default function DocumentPage() {
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  if (studio.isLoading) return <PageLoader className="h-64" />;
  return inStudio(studio.data?.enabled) ? <DocumentStudio /> : <ClassicDocumentPage />;
}
