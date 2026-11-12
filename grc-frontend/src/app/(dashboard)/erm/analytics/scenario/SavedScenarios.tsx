'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Button, EmptyState, ErrorState, StatusPill } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import ScenarioDetail from './ScenarioDetail';
import ScenarioForm from './ScenarioForm';
import { CARD, day, formatMoney, SCENARIO_STATUS, SCENARIOS, type ScenarioRow } from './scenarioModel';

/** The Scenarios tab: the list (last run, severe loss, status), a new scenario, and one scenario's detail and review. */
export default function SavedScenarios() {
  const { hasAnyPermission } = usePermissions();
  const canCreate = hasAnyPermission(['risks:risk_assessment:create', 'erm:risks:create']);
  const canEdit = hasAnyPermission(['risks:risk_assessment:edit', 'erm:risks:edit']);
  const canDelete = hasAnyPermission(['risks:risk_assessment:delete', 'erm:risks:delete']);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: SCENARIOS, queryFn: async () => (await ermApi.scenarios.list()).data as ScenarioRow[] });

  useEffect(() => {      // a notification links to ?id=<scenario>
    const id = Number(new URLSearchParams(window.location.search).get('id'));
    if (id > 0) setOpenId(id);
  }, []);

  if (creating) return <ScenarioForm onSaved={(id) => { setCreating(false); setOpenId(id); }} onCancel={() => setCreating(false)} />;
  if (openId !== null) {
    return <ScenarioDetail id={openId} canEdit={canEdit} canCreate={canCreate} canDelete={canDelete} onOpen={setOpenId} onBack={() => setOpenId(null)} />;
  }
  if (q.isError) return <ErrorState title="Couldn't load the scenarios" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />;

  const rows = q.data ?? [];
  const newButton = canCreate && <Button variant="primary" leftIcon={<Plus />} onClick={() => setCreating(true)}>New scenario</Button>;

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (rows.length === 0) return <EmptyState kind="firstUse" title="No scenarios yet." action={newButton || undefined} />;

  return (
    <div className="space-y-4">
      {newButton && <div className="flex justify-end">{newButton}</div>}
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-600">
              <th className="py-2 pr-3 font-medium">Scenario</th>
              <th className="py-2 pr-3 font-medium">Risks</th>
              <th className="py-2 pr-3 font-medium">Last run</th>
              <th className="py-2 pr-3 text-right font-medium">Estimated loss (currency), 1 in 100</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="py-2.5 pr-3">
                  <button type="button" className="text-left font-medium text-slate-900 hover:underline" onClick={() => setOpenId(r.id)}>{r.title}</button>
                </td>
                <td className="py-2.5 pr-3 text-slate-600">{r.risk_count}</td>
                <td className="py-2.5 pr-3 text-slate-600">{r.last_run_at ? day(r.last_run_at) : 'Not run'}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-900">{formatMoney(r.severe_loss, r.currency)}</td>
                <td className="py-2.5"><StatusPill size="sm" tone={SCENARIO_STATUS[r.status].tone} label={SCENARIO_STATUS[r.status].label} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
