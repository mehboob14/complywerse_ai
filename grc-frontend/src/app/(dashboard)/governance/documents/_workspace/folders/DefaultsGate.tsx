'use client';

// What the Approvals and Exceptions tabs show before there is anything to show: the answer loading, the answer refused (a person without a governance right, who does not manage the
// unit, is told so: that is not an error), the answer failed (with Retry unless asking again cannot help), and the "view only" line for a person who may read and not change.
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { InfoTip } from '@/components/ui/InfoTip';
import { ErrorState, NoAccessState, ReadOnlyNote, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import type { DefaultsAnswer } from '@/lib/approvalDefaults';

const UNIT_READ_ONLY = 'Only an administrator, someone allowed to change governance settings or someone who manages this unit can change these.';
const ORG_READ_ONLY = 'Only an administrator or someone allowed to change governance settings can change these.';

export function DefaultsGate({ query, what, children }: { query: UseQueryResult<DefaultsAnswer>; what: string; children: (answer: DefaultsAnswer) => ReactNode }) {
  if (query.isLoading) return <SkeletonLines lines={6} label={`Loading the ${what}`} />;
  if (query.isError || !query.data) {
    if (statusOf(query.error) === 403) return <NoAccessState title="No access" reason={errorMessage(query.error)} />;
    return <ErrorState title={`Couldn't load the ${what}`} message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  }
  return <>{children(query.data)}</>;
}

export function ViewOnly({ org }: { org: boolean }) {
  return <div><ReadOnlyNote>View only<InfoTip text={org ? ORG_READ_ONLY : UNIT_READ_ONLY} label="Why these are view only" /></ReadOnlyNote></div>;
}
