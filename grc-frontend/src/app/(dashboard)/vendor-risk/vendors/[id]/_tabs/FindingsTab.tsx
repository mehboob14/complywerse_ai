'use client';

// Findings tab of the vendor record. Every finding of the vendor, all its engagements and General together, the open ones and the worst first: the same cards as the Findings register's
// drawer and the lifecycle's Findings stage (THE finding card), then the action plan. `findingId` (a link from the register, an alert or the work queue) opens that finding.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, Checkbox, EmptyState, ErrorState, SectionCard, SkeletonRows, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePeople } from '../../../_lib/actions/shared';
import { useEngagements } from '../../../_lib/engagementsApi';
import { findingsApi, refreshFindings, useVendorFindings, type RaiseInput } from '../../../_lib/findingsApi';
import { blockingLine } from '../../../_lib/findingCardModel';
import ActionPlanPanel from '../_tpra/ActionPlanPanel';
import { useFindingRights } from '../_tpra/FindingCard';
import FindingList, { useSharedFindings } from '../_tpra/FindingList';
import { RaiseFindingDialog } from '../_tpra/FindingDialogs';
import type { TabProps } from './tabProps';

export default function FindingsTab({ vendorId, engagementId, findingId, onChanged }: TabProps) {
  const qc = useQueryClient();
  const { rights, canRaise } = useFindingRights();
  const [removed, setRemoved] = useState(false);
  const [raising, setRaising] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);

  const list = useVendorFindings(vendorId, removed);
  const people = usePeople();
  const { data: engaged } = useEngagements(vendorId);
  const shared = useSharedFindings(vendorId);

  const items = list.data?.items ?? [];
  // The engagements a finding can be about, besides the vendor itself.
  const uses = (engaged?.items ?? []).filter((e) => !e.is_general && e.id && e.status !== 'ended').map((e) => ({ id: e.id as number, name: e.name }));

  const raise = useReportedMutation({
    mutationFn: (input: RaiseInput) => findingsApi.raise(vendorId, input),
    success: 'Finding raised',
    failure: 'Could not raise the finding',
    toast: 'success',
    onError: (e) => setProblem(e),
    onSuccess: () => { refreshFindings(qc); onChanged?.(); setRaising(false); },
  });

  let body;
  if (list.isLoading) {
    body = <SkeletonRows rows={3} columns={2} label="Loading the findings" />;
  } else if (!list.data) {
    body = <ErrorState compact title="Couldn't load the findings" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />;
  } else if (items.length === 0) {
    body = <EmptyState kind="firstUse" bare title="No findings" description="They come from questionnaires, reviews and service level misses." />;
  } else {
    body = <FindingList items={items} people={people} rights={rights} shared={shared} deepLinkId={findingId} onChanged={onChanged} />;
  }

  const total = list.data?.total;
  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard
        id="vendor-findings"
        title="Findings"
        meta={[typeof total === 'number' && total > 0 ? String(total) : null, blockingLine(items, list.data?.blocking_total)].filter(Boolean).join(' · ') || undefined}
        actions={(
          <>
            {rights.remove && <Checkbox label="Show removed" checked={removed} onChange={(e) => setRemoved(e.target.checked)} />}
            {canRaise && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => { setProblem(null); setRaising(true); }}>Raise finding</Button>}
          </>
        )}
      >
        {body}
      </SectionCard>

      <ActionPlanPanel vendorId={vendorId} />

      <RaiseFindingDialog
        open={raising} onClose={() => setRaising(false)} busy={raise.isPending} error={problem} people={people}
        engagements={uses} defaultEngagementId={engagementId}
        onRaise={(input) => { setProblem(null); raise.mutate(input); }}
      />
    </div>
  );
}
