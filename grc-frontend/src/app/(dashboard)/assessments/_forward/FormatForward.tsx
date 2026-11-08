'use client';

// An old address of a kind that is one workbook (the sidebar's DPIA / PIA, Saudi PDPL and Digital Operations Maturity, the KPI report link, the NCA hub's tabs): look up the assessments of that kind
// and go where forwardModel.targetFor says (the one assessment, Types when there is none, the register when there are several). While it looks it says so; if the lookup fails it says what
// failed with Retry and offers the register, so a stored link never ends in a blank page.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { api, retryRead } from '../_data/assessmentData';
import { REGISTER, targetFor } from './forwardModel';

export function FormatForward({ format, orElse }: { format: string; orElse?: string }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ['assessments-forward', format], queryFn: () => api.ofFormat(format), retry: retryRead, retryDelay: 800, staleTime: 0 });
  useEffect(() => {
    if (q.data) router.replace(targetFor(format, q.data, orElse));
  }, [q.data, format, orElse, router]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-[16px]">
      <PageHeader variant="page" title="Assessments" />
      {q.isError ? (
        <>
          <ErrorState title="Couldn't open this assessment" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
          <div><Button href={REGISTER}>Open all assessments</Button></div>
        </>
      ) : (
        <div role="status" aria-busy="true"><span className="sr-only">Opening the assessment</span><SkeletonLines lines={3} label="Opening the assessment" /></div>
      )}
    </div>
  );
}
