'use client';

export const dynamic = 'force-dynamic';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Eye, Trash2, LifeBuoy } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, AnimatedModal, PageLoader } from '@/components/ui';
import EmptyState from '@/components/common/EmptyState';
import {
  PlanStatusBadge, PLAN_STATUS_LABEL, FREQUENCY_OPTIONS, FREQUENCY_LABEL,
  fmtHours, fmtDate, BcmSelect, BcmEntitySelect, useBcmToast,
} from '../_bcm-ui';

export default function BcmPlansPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('bcm:plans:create');
  const canDelete = hasPermission('bcm:plans:delete');
  const queryClient = useQueryClient();
  const { ok, fail } = useBcmToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bcm-plans'],
    queryFn: async () => (await bcmApi.plans.list()).data.items as any[],
    placeholderData: keepPreviousData,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => bcmApi.plans.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bcm-plans'] }); ok('Plan deleted'); },
    onError: (e) => fail(e, 'Could not delete plan'),
  });

  const filtered = useMemo(() => {
    let rows = data || [];
    if (statusFilter !== 'all') rows = rows.filter((p) => p.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((p) => (p.title || '').toLowerCase().includes(q) || (p.business_unit || '').toLowerCase().includes(q));
    }
    return rows;
  }, [data, statusFilter, search]);

  if (isLoading) return <PageLoader className="h-64" />;
  if (error) {
    return <div className="px-3 sm:px-6"><div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">Failed to load plans.</div></div>;
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <LifeBuoy className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Continuity Plans</h1>
            <p className="text-xs text-slate-500">{filtered.length} of {data?.length || 0} plans</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700">
            <Plus size={16} /> Add Plan
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-[200px] flex-1 sm:max-w-md">
          <SearchInput value={search} onChange={setSearch} placeholder="Search plans…" size="md" />
        </div>
        <MultiSelectDropdown
          title="Status"
          items={Object.entries(PLAN_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          selectedValues={statusFilter === 'all' ? [] : [statusFilter]}
          onApply={(v: string[]) => setStatusFilter(v[0] || 'all')}
          multiSelect={false}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy />}
          title="No continuity plans yet"
          description="Create your first BCM plan to start tracking recovery objectives and drills."
          primaryAction={canCreate ? { label: 'Add Plan', onClick: () => setShowCreate(true) } : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Plan</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">RTO</th>
                  <th className="px-3 py-2 text-right font-semibold">RPO</th>
                  <th className="px-3 py-2 text-left font-semibold">Cadence</th>
                  <th className="px-3 py-2 text-right font-semibold">BIA</th>
                  <th className="px-3 py-2 text-right font-semibold">Drills</th>
                  <th className="px-3 py-2 text-left font-semibold">Review Due</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="max-w-[260px] px-3 py-2">
                      <Link href={`/bcm/plans/${p.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-primary-600">{p.title}</Link>
                      {p.business_unit && <div className="truncate text-[11px] text-slate-400">{p.business_unit}</div>}
                    </td>
                    <td className="px-3 py-2"><PlanStatusBadge status={p.status} /></td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtHours(p.rto_hours)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmtHours(p.rpo_hours)}</td>
                    <td className="px-3 py-2 text-slate-600">{FREQUENCY_LABEL[p.testing_frequency] || p.testing_frequency}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{p.bia_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{p.drill_count}</td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(p.next_review_due)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Link href={`/bcm/plans/${p.id}`} aria-label={`View ${p.title}`} className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-600" title="View"><Eye size={16} /></Link>
                        {canDelete && (
                          <button
                            onClick={() => { if (window.confirm(`Delete plan "${p.title}"? This removes its BIA and drills.`)) deleteMut.mutate(p.id); }}
                            aria-label={`Delete ${p.title}`}
                            className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600" title="Delete"><Trash2 size={16} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && <CreatePlanModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreatePlanModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { ok, fail } = useBcmToast();
  const [form, setForm] = useState<any>({
    title: '', business_unit: '', description: '', owner_id: null, owner_name: '',
    document_ref_id: null, document_title: '', rto_hours: '', rpo_hours: '',
    testing_frequency: 'annual', next_review_due: '',
  });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const createMut = useMutation({
    mutationFn: () => bcmApi.plans.create({
      title: form.title,
      business_unit: form.business_unit || null,
      description: form.description || null,
      owner_id: form.owner_id,
      document_ref_id: form.document_ref_id,
      rto_hours: form.rto_hours === '' ? null : Number(form.rto_hours),
      rpo_hours: form.rpo_hours === '' ? null : Number(form.rpo_hours),
      testing_frequency: form.testing_frequency,
      next_review_due: form.next_review_due || null,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bcm-plans'] }); ok('Plan created'); onClose(); },
    onError: (e) => fail(e, 'Could not create plan'),
  });

  const input = 'w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none';
  const label = 'mb-0.5 block text-xs font-medium text-slate-600';

  return (
    <AnimatedModal isOpen onClose={onClose} title="New Continuity Plan" size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button disabled={!form.title.trim() || createMut.isPending} onClick={() => createMut.mutate()}
            className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-40">
            {createMut.isPending ? 'Creating…' : 'Create Plan'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <div>
          <label className={label}>Title *</label>
          <input className={input} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Core Banking Continuity Plan" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Business unit / scope</label>
            <input className={input} value={form.business_unit} onChange={(e) => set('business_unit', e.target.value)} placeholder="e.g. Retail Banking" />
          </div>
          <div>
            <label className={label}>Testing cadence</label>
            <BcmSelect value={form.testing_frequency} onChange={(v) => set('testing_frequency', v)} options={FREQUENCY_OPTIONS} ariaLabel="Testing cadence" />
          </div>
        </div>
        <div>
          <label className={label}>Description</label>
          <textarea rows={2} className={input} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>RTO (hours)</label>
            <input type="number" min={0} className={input} value={form.rto_hours} onChange={(e) => set('rto_hours', e.target.value)} />
          </div>
          <div>
            <label className={label}>RPO (hours)</label>
            <input type="number" min={0} className={input} value={form.rpo_hours} onChange={(e) => set('rpo_hours', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Owner</label>
            <BcmEntitySelect kind="users" value={form.owner_id} onChange={(id) => set('owner_id', id)} placeholder="Assign owner…" />
          </div>
          <div>
            <label className={label}>Review due</label>
            <input type="date" className={input} value={form.next_review_due} onChange={(e) => set('next_review_due', e.target.value)} />
          </div>
        </div>
        <div>
          <label className={label}>Plan document (reference)</label>
          <BcmEntitySelect kind="documents" value={form.document_ref_id} onChange={(id) => set('document_ref_id', id)} placeholder="Link a governance document…" />
          <p className="mt-1 text-[11px] text-slate-400">References an existing document — no duplicate upload.</p>
        </div>
        {createMut.isError && <p className="text-xs text-rose-600">{(createMut.error as any)?.response?.data?.detail || 'Failed to create plan.'}</p>}
      </div>
    </AnimatedModal>
  );
}
