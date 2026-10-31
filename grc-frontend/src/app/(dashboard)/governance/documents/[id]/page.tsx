'use client';

/**
 * A governance document's one link. Where the AI Studio is on, it opens in the AI Studio's document view (read, act, Edit opens the
 * person's draft); only where it is off, the classic page. Old ?tab= links keep working in both.
 */
import { useQuery } from '@tanstack/react-query';
import { Skeleton, SkeletonLines } from '@/components/ui/ds';
import { studioApi } from '@/lib/studio/api';
import DocumentStudio from './_DocumentStudio';
import { ClassicDocumentPage } from './_LegacyDocumentPage';
import { inStudio } from '../_view/docRoute';

export default function DocumentPage() {
  const studio = useQuery({ queryKey: ['studio', 'status'], queryFn: studioApi.status, staleTime: 5 * 60_000, retry: false });
  // grey blocks while the switch is read (the document page that follows draws the same ones), never an empty page
  if (studio.isLoading) return <div className="space-y-4 p-4"><Skeleton className="h-[24px] w-[260px]" /><SkeletonLines lines={8} label="Loading the document" /></div>;
  return inStudio(studio.data?.enabled) ? <DocumentStudio /> : <ClassicDocumentPage />;
}
