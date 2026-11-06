'use client';

// One vendor's action plan: what is planned, what happened, and a form to plan more. The Findings tab places it under the findings.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { BTN_PRIMARY, ErrorState, Panel, Skeleton } from '@/app/(dashboard)/vendor-risk/_ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { vendorActionsApi } from '@/lib/api';
import { ActionForm, ActionRow, type ActionItem } from '../../../_lib/actions/shared';

const SUBHEAD = 'border-t border-[#e1e6eb] px-5 py-2 text-[12px] font-semibold uppercase tracking-wide text-[#586472]';

export default function ActionPlanPanel({ vendorId }: { vendorId: number }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit');
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
    body = <div className="px-5 pb-5"><Skeleton className="h-12 w-full" /></div>;
  } else if (!data) {
    body = <div className="px-5 pb-5"><ErrorState title="Couldn't load the action plan" message={apiErrorText(error, 'Try again in a moment.')} onRetry={() => refetch()} /></div>;
  } else {
    body = (
      <>
        <h3 className={SUBHEAD}>Planned ({upcoming.length})</h3>
        {upcoming.length === 0
          ? <p className="px-5 pb-5 text-[13px] text-[#586472]">Nothing planned.</p>
          : <ul className="divide-y divide-[#e1e6eb]">{upcoming.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} />)}</ul>}
        {past.length > 0 && (
          <>
            <h3 className={SUBHEAD}>History ({past.length})</h3>
            <ul className="divide-y divide-[#e1e6eb]">{past.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} />)}</ul>
          </>
        )}
      </>
    );
  }

  return (
    <Panel
      title="Action plan"
      flush
      info="Things to do on this vendor, or to have happen, on a date: a to-do for someone, a questionnaire sent, the check-in asked for, or a reassessment opened. Planned for nobody means the vendor’s owner."
      action={canEdit && !planning ? (
        <button type="button" onClick={() => setPlanning(true)} className={BTN_PRIMARY}>
          <CalendarPlus aria-hidden className="h-4 w-4" /> Plan an action
        </button>
      ) : undefined}
    >
      {planning && <div className="px-5 pb-4"><ActionForm vendorId={vendorId} onDone={() => setPlanning(false)} /></div>}
      {body}
    </Panel>
  );
}
