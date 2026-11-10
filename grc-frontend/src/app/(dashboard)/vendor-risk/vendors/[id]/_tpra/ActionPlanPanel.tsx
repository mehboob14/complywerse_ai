'use client';

// One vendor's action plan: what is planned, what happened, and a form to plan more. The Findings tab places it under the findings. Rebuilt on the kit (vendor-intake-findings, 2026-11-10);
// who may plan and change an action is what the server allows: the module's own right, or the risk right that accepts every write of the module.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { Button, ErrorState, SectionCard, SkeletonRows } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { vendorActionsApi } from '@/lib/api';
import { ActionForm, ActionRow, type ActionItem } from '../../../_lib/actions/shared';

const SUBHEAD = 'mt-[8px] border-t border-ds-border px-[4px] pt-[8px] !text-ds-label !font-[600] uppercase tracking-wide !text-ds-fg-muted';

export default function ActionPlanPanel({ vendorId }: { vendorId: number }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [planning, setPlanning] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tprm-actions', vendorId],
    queryFn: async () => (await vendorActionsApi.forVendor(vendorId)).data as { items: ActionItem[] },
  });
  const items = data?.items || [];
  const upcoming = items.filter((i) => i.status === 'scheduled').sort((a, b) => a.due_on.localeCompare(b.due_on));
  const past = items.filter((i) => i.status !== 'scheduled');

  let body;
  if (isLoading) {
    body = <SkeletonRows rows={2} columns={2} label="Loading the action plan" />;
  } else if (!data) {
    body = <ErrorState compact title="Couldn't load the action plan" message={errorMessage(error)} onRetry={canRetry(error) ? () => { void refetch(); } : undefined} />;
  } else {
    body = (
      <>
        <h3 className={SUBHEAD}>Planned ({upcoming.length})</h3>
        {upcoming.length === 0
          ? <p className="px-[4px] pb-[8px] pt-[4px] text-ds-body text-ds-fg-muted">Nothing planned.</p>
          : <ul className="m-0 list-none p-0">{upcoming.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} />)}</ul>}
        {past.length > 0 && (
          <>
            <h3 className={SUBHEAD}>History ({past.length})</h3>
            <ul className="m-0 list-none p-0">{past.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} />)}</ul>
          </>
        )}
      </>
    );
  }

  return (
    <SectionCard
      id="vendor-action-plan"
      title="Action plan"
      info="Things to do on this vendor, or to have happen, on a date: a to-do for someone, a questionnaire sent, the check-in asked for, or a reassessment opened. Planned for nobody means the vendor’s owner."
      actions={canEdit && !planning ? <Button variant="primary" leftIcon={<CalendarPlus aria-hidden />} onClick={() => setPlanning(true)}>Plan an action</Button> : undefined}
    >
      {planning && <div className="mb-[12px]"><ActionForm vendorId={vendorId} onDone={() => setPlanning(false)} /></div>}
      {body}
    </SectionCard>
  );
}
