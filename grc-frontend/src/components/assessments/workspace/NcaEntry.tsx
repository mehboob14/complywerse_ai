'use client';

/**
 * /assessments/a/nca: the tenant's NCA workspace. It is one record that exists once per organization, and it is made the first time somebody asks for it: a read only reports whether it
 * exists (a GET never writes), and "Set up the NCA workspace" makes it (`POST /compliance/nca/container`, asking twice gives the same record). Once it exists the address forwards to it.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, SkeletonLines, useReportedMutation } from '@/components/ui/ds';
import { PageHeader } from '@/components/ui';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { BACK, readOnlyFor, workspaceHref } from './workspaceModel';
import { KEYS, workspaceApi } from './workspaceApi';

export function NcaEntry() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const readOnly = readOnlyFor(hasPermission('compliance:assessments:edit'));
  const q = useQuery({ queryKey: KEYS.nca, queryFn: workspaceApi.ncaContainer });
  const exists = q.data?.exists && q.data.id ? q.data.id : null;
  useEffect(() => { if (exists) router.replace(workspaceHref(exists)); }, [exists, router]);
  const create = useReportedMutation({
    mutationFn: workspaceApi.createNcaContainer,
    success: 'NCA workspace set up',
    failure: "Couldn't set up the NCA workspace",
    retryable: false,
    onSuccess: (made) => router.replace(workspaceHref(made.id)),
  });
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-[16px]">
      <PageHeader variant="page" title="NCA workspace" back={BACK} />
      {q.isPending || exists ? <SkeletonLines lines={4} label="Opening the NCA workspace" />
        : q.isError ? <ErrorState title="Couldn't open the NCA workspace" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
        : (
          <EmptyState kind="firstUse" title="The NCA workspace is not set up yet"
            description={readOnly ? 'Ask someone who can edit assessments to set it up.' : 'It holds your DCC controls and your audit plan, once for the organization.'}
            action={!readOnly ? <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>Set up the NCA workspace</Button> : undefined} />
        )}
    </div>
  );
}
