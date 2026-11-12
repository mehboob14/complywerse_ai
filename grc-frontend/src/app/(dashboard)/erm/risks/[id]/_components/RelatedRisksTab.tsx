'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranch, Loader2, Plus, Trash2 } from 'lucide-react';
import { ermApi } from '@/lib/api';
import type { RiskDependencyCreate } from '@/types';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { errorText } from '@/components/settings/CustomFields';

// The /erm/dependencies contract, as the Dependencies page uses it (the shared RiskDependency type still says `strength`).
interface DependencyRow {
  id: number;
  source_risk_id: number;
  target_risk_id: number;
  dependency_type: string;
  impact_factor: number;
  description?: string | null;
  source_risk_title?: string | null;
  target_risk_title?: string | null;
}

const DEPENDENCY_TYPES = [
  { value: 'causes', label: 'Causes' },
  { value: 'caused_by', label: 'Caused by' },
  { value: 'related', label: 'Related' },
  { value: 'amplifies', label: 'Amplifies' },
  { value: 'mitigates', label: 'Mitigates' },
];
const typeLabel = (value: string) => DEPENDENCY_TYPES.find((t) => t.value === value)?.label || value;

/** Risk-to-risk links (both directions) on the Dependencies API, and adding one from this risk. */
export default function RelatedRisksTab({ riskId, canEdit, canDelete }: { riskId: number; canEdit: boolean; canDelete: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ target_risk_id: 0, dependency_type: 'related', impact_factor: 1, description: '' });
  const [error, setError] = useState<string | null>(null);

  const { data: links, isLoading } = useQuery({
    queryKey: ['risk-dependencies', riskId],
    queryFn: async () => {
      const [outgoing, incoming] = await Promise.all([
        ermApi.dependencies.getAll({ source_risk_id: riskId }),
        ermApi.dependencies.getAll({ target_risk_id: riskId }),
      ]);
      return [...outgoing.data, ...incoming.data] as unknown as DependencyRow[];
    },
  });
  const { data: risks } = useQuery({
    queryKey: ['erm-risks-for-related', riskId],
    queryFn: async () => (await ermApi.risks.getAll()).data,
    enabled: adding,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['risk-dependencies', riskId] });
  const create = useMutation({
    mutationFn: () => ermApi.dependencies.create({ ...form, source_risk_id: riskId } as unknown as RiskDependencyCreate),
    onSuccess: () => { refresh(); setAdding(false); setError(null); setForm({ target_risk_id: 0, dependency_type: 'related', impact_factor: 1, description: '' }); },
    onError: (e: unknown) => setError(errorText(e, 'Could not link the risks.')),
  });
  const remove = useMutation({
    mutationFn: (id: number) => ermApi.dependencies.delete(id),
    onSuccess: refresh,
    onError: (e: unknown) => setError(errorText(e, 'Could not remove the link.')),
  });

  const linked = new Set((links || []).flatMap((l) => [l.source_risk_id, l.target_risk_id]));
  const riskOptions = (risks || []).filter((r) => r.id !== riskId && !linked.has(r.id))
    .map((r) => ({ value: String(r.id), label: r.title, subLabel: `RISK-${r.id}` }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <GitBranch className="h-4 w-4 text-slate-400" strokeWidth={1.75} /> Related risks
        </h3>
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Link a risk
          </button>
        )}
      </div>

      {adding && (
        <form className="space-y-3 rounded-lg border border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); if (form.target_risk_id) create.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">This risk…</label>
              <MultiSelectDropdown title="Relationship" items={DEPENDENCY_TYPES} selectedValues={[form.dependency_type]}
                onApply={(v) => setForm({ ...form, dependency_type: v[0] || 'related' })} multiSelect={false} triggerVariant="input" size="md" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">…this risk</label>
              <MultiSelectDropdown title="Risk" items={riskOptions} selectedValues={form.target_risk_id ? [String(form.target_risk_id)] : []}
                onApply={(v) => setForm({ ...form, target_risk_id: v[0] ? Number(v[0]) : 0 })} multiSelect={false} triggerVariant="input"
                size="md" forceSearch placeholder="Choose a risk" />
            </div>
          </div>
          <div>
            <label htmlFor="related-impact-factor" className="block text-xs font-medium text-slate-700">Impact factor (multiplies the linked risk&apos;s score in the cascade)</label>
            <input id="related-impact-factor" type="range" min="0.1" max="2" step="0.1" value={form.impact_factor}
              onChange={(e) => setForm({ ...form, impact_factor: Number(e.target.value) })} className="mt-1 w-full" />
            <p className="text-right text-xs font-medium text-slate-900">×{form.impact_factor}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); setError(null); }}
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={!form.target_risk_id || create.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Link
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}

      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : !links?.length ? (
        <p className="text-sm italic text-slate-400">No related risks. Link the risks this one causes, amplifies or is caused by, so the cascade shows on the Dependencies page.</p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => {
            const outgoing = link.source_risk_id === riskId;
            const otherId = outgoing ? link.target_risk_id : link.source_risk_id;
            const otherTitle = (outgoing ? link.target_risk_title : link.source_risk_title) || `Risk #${otherId}`;
            return (
              <li key={link.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-slate-500">{outgoing ? 'This risk' : <Link href={`/erm/risks/${otherId}`} className="text-primary-700 hover:underline">{otherTitle}</Link>}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                    {typeLabel(link.dependency_type)} <ArrowRight aria-hidden="true" className="h-3 w-3" />
                  </span>
                  <span className="text-slate-500">{outgoing ? <Link href={`/erm/risks/${otherId}`} className="text-primary-700 hover:underline">{otherTitle}</Link> : 'this risk'}</span>
                  <span className="text-xs text-slate-400">×{link.impact_factor}</span>
                </div>
                {canDelete && (
                  <button type="button" onClick={() => remove.mutate(link.id)} disabled={remove.isPending} aria-label={`Remove the link to ${otherTitle}`}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
