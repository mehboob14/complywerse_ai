'use client';

// /assessments/a/<id>: one assessment, whatever its type. This file reads it (GET /compliance/assessments/<id>?grouped=0, key ['assessment-workspace', id]) and says what the read did: a
// skeleton while it loads, and when it fails WHAT happened in the server's words (gone, not one of the person's, the server unreachable) with Retry where trying again can help. The page
// itself is components/assessments/workspace/AssessmentWorkspace. /assessments/a/nca is the organization's NCA workspace (made on request, never by a GET). The three older detail screens
// (the board's in-place detail, /compliance/assessments/<id>, /cyber-security/assessments/<id>) forward here. Built on the design-system kit (components/ui/ds).
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Skeleton, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { AssessmentWorkspace } from '@/components/assessments/workspace/AssessmentWorkspace';
import { NcaEntry } from '@/components/assessments/workspace/NcaEntry';
import { KEYS, workspaceApi } from '@/components/assessments/workspace/workspaceApi';
import { BACK, idOfParam } from '@/components/assessments/workspace/workspaceModel';

function Missing({ title, message, retry }: { title: string; message: string; retry?: () => void }) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-[16px]">
      <PageHeader variant="page" title="Assessment" back={BACK} />
      <ErrorState title={title} message={message} onRetry={retry} />
      <div><Button href={BACK.href}>{BACK.label}</Button></div>
    </div>
  );
}

function Loaded({ id }: { id: number }) {
  const q = useQuery({ queryKey: KEYS.detail(id), queryFn: () => workspaceApi.detail(id), staleTime: 15_000 });
  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading the assessment" className="mx-auto flex max-w-7xl flex-col gap-[16px]">
        <Skeleton className="h-[28px] w-[60%]" />
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4"><Skeleton className="h-[96px] w-full" /><Skeleton className="h-[96px] w-full" /><Skeleton className="h-[96px] w-full" /><Skeleton className="h-[96px] w-full" /></div>
        <SkeletonLines lines={6} />
      </div>
    );
  }
  if (q.isError || !q.data) {
    const gone = statusOf(q.error) === 404;
    return <Missing title={gone ? 'Assessment not found' : "Couldn't open this assessment"} message={gone ? 'It was deleted, or it is not one of the assessments you may see.' : errorMessage(q.error)} retry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
  }
  return <AssessmentWorkspace detail={q.data} />;
}

export default function AssessmentPage() {
  const params = useParams();
  const raw = params?.id;
  if (raw === 'nca') return <NcaEntry />;
  const id = idOfParam(raw);
  if (id === null) return <Missing title="Assessment not found" message="That address is not an assessment." />;
  return <Loaded id={id} />;
}
