'use client';

// One supplier's action plan: what is planned, what happened, and a form to plan more.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { vendorActionsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { ActionForm, ActionRow, type ActionItem } from '../../../_lib/actions/shared';

export default function ActionPlanPanel({ vendorId }: { vendorId: number }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit');
  const [planning, setPlanning] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tprm-actions', vendorId],
    queryFn: async () => (await vendorActionsApi.forVendor(vendorId)).data as { items: ActionItem[] },
  });
  const items = data?.items || [];
  const upcoming = items.filter((i) => i.status === 'scheduled').sort((a, b) => a.due_on.localeCompare(b.due_on));
  const past = items.filter((i) => i.status !== 'scheduled');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Action plan</h2>
          <p className="max-w-2xl text-xs text-slate-500">
            Things to do on this supplier, or to have happen, on a date: a to-do for someone, a questionnaire sent, the
            check-in asked for, or a reassessment opened. Planned for nobody means the supplier’s owner.
          </p>
        </div>
        {canEdit && !planning && (
          <button type="button" onClick={() => setPlanning(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700">
            <CalendarPlus className="h-4 w-4" /> Plan an action
          </button>
        )}
      </div>
      {planning && <ActionForm vendorId={vendorId} onDone={() => setPlanning(false)} />}
      {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {isError && <p className="text-sm text-rose-700">Could not load the action plan.</p>}
      {!isLoading && !isError && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white" aria-label="Planned">
            <h3 className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Planned ({upcoming.length})</h3>
            {upcoming.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing planned.</p> : (
              <ul className="divide-y divide-slate-100">{upcoming.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} />)}</ul>
            )}
          </section>
          {past.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white" aria-label="Done, cancelled or could not happen">
              <h3 className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">History ({past.length})</h3>
              <ul className="divide-y divide-slate-100">{past.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} />)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
