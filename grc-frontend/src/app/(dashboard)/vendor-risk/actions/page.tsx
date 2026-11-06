'use client';

// Planned actions across every supplier: what is coming, what is due now, and
// what could not happen. Each is planned on its supplier's Action plan tab.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { CalendarClock, Loader2 } from 'lucide-react';
import { vendorActionsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { ActionRow, type ActionItem } from '../_lib/actions/shared';

type State = 'open' | 'due' | 'failed' | 'done';
const TABS: Array<{ key: State; label: string }> = [
  { key: 'due', label: 'Due now' }, { key: 'open', label: 'All planned' }, { key: 'failed', label: 'Could not happen' },
  { key: 'done', label: 'Done' },
];

export default function PlannedActionsPage() {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit');
  const [state, setState] = useState<State>('due');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tprm-actions-all', state, scope],
    queryFn: async () => (await vendorActionsApi.all({ state, scope })).data as
      { items: ActionItem[]; counts: { due: number; failed: number } },
    ...TPRM_QUERY_OPTS,
  });
  const items = data?.items || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900"><CalendarClock className="h-5 w-5 text-slate-500" /> Planned actions</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
          Every supplier’s action plan in one place. To-dos wait for a person to mark them done; questionnaires, check-ins
          and reassessments happen on their date. Plan one from a supplier’s Action plan tab.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Which actions">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={state === t.key} onClick={() => setState(t.key)}
              className={clsx('rounded-full border px-3 py-1 text-xs font-medium',
                state === t.key ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
              {t.label}
              {t.key === 'due' && data?.counts.due ? ` (${data.counts.due})` : ''}
              {t.key === 'failed' && data?.counts.failed ? ` (${data.counts.failed})` : ''}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Whose">
          {(['all', 'mine'] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => setScope(s)}
              className={clsx('rounded-md px-3 py-1 text-xs font-medium', scope === s ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500')}>
              {s === 'all' ? 'Everyone’s' : 'Mine'}
            </button>
          ))}
        </div>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white">
        {isLoading ? <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          : isError ? <p className="px-4 py-8 text-sm text-rose-700">Could not load the planned actions.</p>
            : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                {state === 'due' ? 'Nothing is due now.' : state === 'failed' ? 'Everything planned has happened.' : 'Nothing here.'}
              </p>
            ) : <ul className="divide-y divide-slate-100">{items.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} showVendor />)}</ul>}
      </section>
    </div>
  );
}
