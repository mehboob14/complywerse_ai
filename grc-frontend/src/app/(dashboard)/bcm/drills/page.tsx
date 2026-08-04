'use client';

export const dynamic = 'force-dynamic';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Eye, Trash2, CalendarClock, Siren } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, AnimatedModal, PageLoader } from '@/components/ui';
import EmptyState from '@/components/common/EmptyState';
import {
  DrillStatusBadge, DRILL_STATUS_LABEL, DRILL_TYPE_LABEL, DRILL_TYPE_OPTIONS,
  SOURCE_TYPE_LABEL, fmtDate, BcmSelect, BcmEntitySelect, useBcmToast,
} from '../_bcm-ui';

const SOURCE_OPTIONS = [
  { value: 'scheduled_test', label: 'Scheduled Test' },
  { value: 'incident_triggered', label: 'Incident-Triggered' },
];

const input = 'w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none';
const lbl = 'mb-0.5 block text-xs font-medium text-slate-600';

export default function BcmDrillsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('bcm:drills:create');
  const canDelete = hasPermission('bcm:drills:delete');
  const qc = useQueryClient();
  const { ok, fail } = useBcmToast();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bcm-drills'],
    queryFn: async () => (await bcmApi.drills.list()).data.items as any[],
    placeholderData: keepPreviousData,
  });

  const delMut = useMutation({ mutationFn: (id: number) => bcmApi.drills.remove(id), onSuccess: () => { qc.invalidateQueries({ queryKey: ['bcm-drills'] }); ok('Drill deleted'); }, onError: (e) => fail(e, 'Could not delete drill') });

  const filtered = useMemo(() => {
    let rows = data || [];
    if (statusFilter !== 'all') rows = rows.filter((d) => d.effective_status === statusFilter);
    if (typeFilter !== 'all') rows = rows.filter((d) => d.drill_type === typeFilter);
    if (sourceFilter !== 'all') rows = rows.filter((d) => d.source_type === sourceFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((d) => (d.title || '').toLowerCase().includes(q) || (d.plan_title || '').toLowerCase().includes(q));
    }
    return rows;
  }, [data, statusFilter, typeFilter, sourceFilter, search]);

  if (isLoading) return <PageLoader className="h-64" />;
  if (error) return <div className="px-3 sm:px-6"><div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600">Failed to load drills.</div></div>;

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><CalendarClock className="h-5 w-5" strokeWidth={1.75} /></span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Drills & Invocations</h1>
            <p className="text-xs text-slate-500">{filtered.length} of {data?.length || 0}</p>
          </div>
        </div>
        {canCreate && (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"><Plus size={16} /> Schedule Drill</button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-[200px] flex-1 sm:max-w-md"><SearchInput value={search} onChange={setSearch} placeholder="Search drills…" size="md" /></div>
        <div className="flex flex-wrap items-center gap-2">
          <MultiSelectDropdown title="Status" items={Object.entries(DRILL_STATUS_LABEL).map(([value, label]) => ({ value, label }))} selectedValues={statusFilter === 'all' ? [] : [statusFilter]} onApply={(v: string[]) => setStatusFilter(v[0] || 'all')} multiSelect={false} />
          <MultiSelectDropdown title="Type" items={DRILL_TYPE_OPTIONS} selectedValues={typeFilter === 'all' ? [] : [typeFilter]} onApply={(v: string[]) => setTypeFilter(v[0] || 'all')} multiSelect={false} />
          <MultiSelectDropdown title="Source" items={Object.entries(SOURCE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} selectedValues={sourceFilter === 'all' ? [] : [sourceFilter]} onApply={(v: string[]) => setSourceFilter(v[0] || 'all')} multiSelect={false} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="No drills yet" description="Schedule a continuity test or link a real incident-triggered invocation." primaryAction={canCreate ? { label: 'Schedule Drill', onClick: () => setShowCreate(true) } : undefined} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Drill</th>
                  <th className="px-3 py-2 text-left font-semibold">Type</th>
                  <th className="px-3 py-2 text-left font-semibold">Source</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Scheduled</th>
                  <th className="px-3 py-2 text-right font-semibold">Findings</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="max-w-[260px] px-3 py-2">
                      <Link href={`/bcm/drills/${d.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-primary-600">{d.title}</Link>
                      <div className="truncate text-[11px] text-slate-400">{d.plan_title || '—'}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{DRILL_TYPE_LABEL[d.drill_type] || d.drill_type}</td>
                    <td className="px-3 py-2">
                      {d.source_type === 'incident_triggered'
                        ? <span className="inline-flex items-center gap-1 text-rose-600"><Siren className="h-3.5 w-3.5" /> Incident</span>
                        : <span className="text-slate-500">Test</span>}
                    </td>
                    <td className="px-3 py-2"><DrillStatusBadge status={d.effective_status} /></td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(d.scheduled_date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{d.finding_count}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <Link href={`/bcm/drills/${d.id}`} aria-label={`View ${d.title}`} className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-600" title="View"><Eye size={16} /></Link>
                        {canDelete && <button onClick={() => { if (window.confirm(`Delete drill "${d.title}"?`)) delMut.mutate(d.id); }} aria-label={`Delete ${d.title}`} className="inline-flex items-center justify-center rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600" title="Delete"><Trash2 size={16} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && <CreateDrillModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateDrillModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { ok } = useBcmToast();
  const { data: plans } = useQuery({ queryKey: ['bcm-plans-min'], queryFn: async () => (await bcmApi.plans.list()).data.items as any[] });
  const [f, setF] = useState<any>({ plan_id: '', title: '', drill_type: 'tabletop', source_type: 'scheduled_test', scheduled_date: '', scenario: '', incident_id: null, incident_title: '' });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  const mut = useMutation({
    mutationFn: () => bcmApi.drills.create({
      plan_id: Number(f.plan_id), title: f.title, drill_type: f.drill_type, source_type: f.source_type,
      scheduled_date: f.scheduled_date || null, scenario: f.scenario || null,
      linked_incident_id: f.source_type === 'incident_triggered' ? f.incident_id : null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bcm-drills'] }); ok('Drill created'); onClose(); },
  });

  const valid = f.plan_id && f.title.trim() && (f.source_type !== 'incident_triggered' || f.incident_id);

  return (
    <AnimatedModal isOpen onClose={onClose} title="Schedule drill / log invocation" size="md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancel</button>
        <button disabled={!valid || mut.isPending} onClick={() => mut.mutate()} className="rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-[#0a0a0a] disabled:opacity-40">{mut.isPending ? 'Saving…' : 'Create'}</button>
      </div>}>
      <div className="space-y-3 p-5">
        <div><label className={lbl}>Plan *</label>
          <BcmSelect value={f.plan_id} onChange={(v) => set('plan_id', v)}
            options={(plans || []).map((p) => ({ value: String(p.id), label: p.title }))}
            placeholder="Select a plan…" ariaLabel="Plan" />
        </div>
        <div><label className={lbl}>Title *</label><input className={input} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Q3 failover tabletop" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Type</label><BcmSelect value={f.drill_type} onChange={(v) => set('drill_type', v)} options={DRILL_TYPE_OPTIONS} ariaLabel="Drill type" /></div>
          <div><label className={lbl}>Source</label><BcmSelect value={f.source_type} onChange={(v) => set('source_type', v)} options={SOURCE_OPTIONS} ariaLabel="Source" /></div>
        </div>
        {f.source_type === 'incident_triggered' && (
          <div>
            <label className={lbl}>Linked incident *</label>
            <BcmEntitySelect kind="incidents" value={f.incident_id} onChange={(id) => set('incident_id', id)} placeholder="Select an incident…" />
            <p className="mt-1 text-[11px] text-slate-400">Links a real incident so its invocation reports alongside rehearsed drills.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Scheduled date</label><input type="date" className={input} value={f.scheduled_date} onChange={(e) => set('scheduled_date', e.target.value)} /></div>
        </div>
        <div><label className={lbl}>Scenario</label><textarea rows={2} className={input} value={f.scenario} onChange={(e) => set('scenario', e.target.value)} /></div>
        {mut.isError && <p className="text-xs text-rose-600">{(mut.error as any)?.response?.data?.detail || 'Failed to create drill.'}</p>}
      </div>
    </AnimatedModal>
  );
}
