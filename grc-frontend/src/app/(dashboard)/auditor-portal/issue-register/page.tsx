'use client';

export const dynamic = 'force-dynamic';

/**
 * Auditor Portal > Issue Register: Audit Services' own register, regrouped by job (Register, Summary, Reports, Queues, Setup).
 *
 * The client's monthly workbook comes in from the head, and here Audit Services track, validate and report the findings. Each finding is also an Issue, so the owners doing the remediation work
 * on it from Issues. Only a tenant that keeps the client's register has this page (the server answers 404 for any other, and the sidebar hides the entry); a failed read is said as a failure, never
 * as "not enabled". The head is the kit's page head: the title is the sidebar's name, one line of facts, and the head carries the actions.
 */
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui';
import { EmptyState, ErrorState, NoAccessState, SkeletonRows } from '@/components/ui/ds';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { AuditRegister } from '@/components/audit-register/AuditRegister';
import { auditRegisterApi } from '@/lib/api';
import { routeFor } from '@/lib/navRegistry';

const INFO = "Audit Services' register of regulatory, internal audit, pen-test and self-identified findings: imported from the monthly workbook, validated here and reported to the Audit Committee.";

export default function IssueRegisterPage() {
  const label = routeFor('/auditor-portal/issue-register')?.label ?? 'Issue Register';
  const status = useQuery({ queryKey: ['audit-register-status'], retry: false, queryFn: async () => (await auditRegisterApi.status()).data });
  const code = statusOf(status.error);

  if (status.isLoading) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={label} info={INFO} />
        <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={5} label="Loading the register" /></div>
      </div>
    );
  }
  if (status.isError) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={label} info={INFO} />
        {code === 404 ? <EmptyState kind="firstUse" title="The Issue Register is not enabled for your organisation" description="It is kept for organisations that track the client's audit workbook." />
          : code === 403 ? <NoAccessState title="You don't have access to the Issue Register" reason="Reading the register needs the right to view issues." />
          : <ErrorState title="Couldn't open the Issue Register" message={errorMessage(status.error)} onRetry={() => { void status.refetch(); }} />}
      </div>
    );
  }
  return (
    <AuditRegister
      head={({ actions, meta }) => <PageHeader variant="page" title={label} info={INFO} meta={meta} actions={actions} />}
    />
  );
}
