'use client';

// Regulatory changes: every circular the organisation is working through. One
// row each (what it is, where it stands, when it takes effect, how far the work
// has got); click a row to open it.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Eye, FileWarning, Loader2, PenLine, Trash2, Upload } from 'lucide-react';
import { MultiSelectDropdown, SearchInput, useToast } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { regulatoryApi } from '@/lib/api';
import RowActionsMenu from '../documents/_workspace/RowActionsMenu';
import CreatePanel, { type CreateMode } from './_CreatePanel';
import {
  CHANGE_STATUSES, ConfirmDialog, PRIORITIES, Pill, PillSelect, REGULATORS, apiError, dueIn, fmtDate, labelOf, toneOf,
  type RegulatoryChange,
} from './_ui';

const GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[minmax(0,1fr)_8.5rem_5rem_7.5rem_7rem_2rem]';

export default function RegulatoryChangesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:regulatory_changes:create');
  const canDelete = hasPermission('governance:regulatory_changes:delete');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [create, setCreate] = useState<CreateMode | null>(null);
  const [deleting, setDeleting] = useState<RegulatoryChange | null>(null);

  const { data: dashboard } = useQuery({
    queryKey: ['regulatory-dashboard'],
    queryFn: async () => (await regulatoryApi.getDashboard()).data as { total_changes: number; by_status: Record<string, number> },
  });
  const { data: changes = [], isLoading, isFetching } = useQuery({
    queryKey: ['regulatory-changes', source, status, priority, search],
    placeholderData: keepPreviousData,
    queryFn: async () => (await regulatoryApi.getChanges({
      source: source || undefined, status: status || undefined, priority: priority || undefined, search: search || undefined,
    })).data as RegulatoryChange[],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['regulatory-changes'] });
    qc.invalidateQueries({ queryKey: ['regulatory-dashboard'] });
  };
  const setChangeStatus = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) => regulatoryApi.updateChange(id, { status: value }),
    onSuccess: refresh,
    onError: (e) => toast({ title: 'Not saved', message: apiError(e), type: 'error' }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => regulatoryApi.deleteChange(id),
    onSuccess: () => { refresh(); setDeleting(null); toast({ title: 'Change deleted', type: 'success' }); },
    onError: (e) => toast({ title: 'Not deleted', message: apiError(e), type: 'error' }),
  });

  const tabs = [
    { value: '', label: 'All', n: dashboard?.total_changes ?? 0 },
    ...CHANGE_STATUSES.map((s) => ({ value: s.value, label: s.label, n: dashboard?.by_status?.[s.value] ?? 0 })),
  ];
  const filtered = !!(search || source || priority);
  const open = (c: RegulatoryChange) => router.push(`/governance/regulatory-changes/${c.id}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Regulatory changes</h1>
          <p className="text-sm text-slate-500">Circulars you are working through, from obligation to closure.</p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setCreate('circular')} className="btn-primary flex items-center gap-2">
              <Upload className="h-4 w-4" /> Upload circular
            </button>
            <button type="button" onClick={() => setCreate('manual')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <PenLine className="h-4 w-4" /> Add manually
            </button>
          </div>
        )}
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Filter by status">
        {tabs.map((t) => {
          const on = status === t.value;
          return (
            <button key={t.value || 'all'} type="button" onClick={() => setStatus(t.value)} aria-pressed={on}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                on ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {t.label}
              <span className={`rounded-full px-1.5 text-[11px] ${on ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-600'}`}>{t.n}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by title or reference" size="md" />
        </div>
        <MultiSelectDropdown title="Regulator" multiSelect={false} autoApply
          items={REGULATORS.map((r) => ({ value: r.value, label: r.hint }))}
          selectedValues={source ? [source] : []} onApply={(v) => setSource(v[0] || '')} />
        <MultiSelectDropdown title="Priority" multiSelect={false} autoApply
          items={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          selectedValues={priority ? [priority] : []} onApply={(v) => setPriority(v[0] || '')} />
        {filtered && (
          <button type="button" onClick={() => { setSearch(''); setSource(''); setPriority(''); }} className="text-xs text-primary-700 hover:underline">
            Clear filters
          </button>
        )}
        {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-label="Updating" />}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className={`${GRID} hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 md:grid`}>
          <span>Change</span><span>Status</span><span>Priority</span><span>Effective</span><span>Tasks</span><span />
        </div>
        {isLoading ? (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading changes…</p>
        ) : changes.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <FileWarning className="mb-3 h-10 w-10 text-slate-300" strokeWidth={1.5} />
            <p className="text-sm font-medium text-slate-700">{status || filtered ? 'No change matches these filters' : 'No regulatory changes yet'}</p>
            {!status && !filtered && canCreate && (
              <button type="button" onClick={() => setCreate('circular')} className="btn-primary mt-4 flex items-center gap-2">
                <Upload className="h-4 w-4" /> Upload your first circular
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {changes.map((c) => {
              const due = dueIn(c.effective_date);
              const tasks = c.task_count || 0;
              const done = c.completed_task_count || 0;
              const reading = ['queued', 'running'].includes(c.analysis?.status || '');
              return (
                <li key={c.id} onClick={() => open(c)} className={`${GRID} cursor-pointer px-4 py-3 hover:bg-slate-50`}>
                  <div className="min-w-0">
                    <Link href={`/governance/regulatory-changes/${c.id}`} onClick={(e) => e.stopPropagation()}
                      className="block truncate text-sm font-medium text-slate-900 hover:text-primary-700">{c.title}</Link>
                    <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500">
                      <span className="font-medium text-slate-600">{c.source}</span>
                      {c.reference_number && <span className="truncate">· {c.reference_number}</span>}
                      {reading && <span className="inline-flex items-center gap-1 text-primary-700"><Loader2 className="h-3 w-3 animate-spin" /> AI reading</span>}
                      <span className="md:hidden">· {labelOf(PRIORITIES, c.priority)} priority{tasks ? ` · ${done}/${tasks} tasks` : ''}</span>
                    </p>
                  </div>
                  <PillSelect value={c.status} options={CHANGE_STATUSES} label={`Status of ${c.title}`}
                    onChange={(v) => setChangeStatus.mutate({ id: c.id, value: v })} />
                  <span className="hidden md:block"><Pill tone={toneOf(PRIORITIES, c.priority)}>{labelOf(PRIORITIES, c.priority)}</Pill></span>
                  <div className="hidden text-xs md:block">
                    {c.effective_date ? (
                      <>
                        <p className="text-slate-800">{fmtDate(c.effective_date)}</p>
                        {due && !due.late && c.status !== 'completed' && <p className="text-[11px] text-slate-500">{due.text}</p>}
                      </>
                    ) : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="hidden md:block">
                    {tasks ? (
                      <>
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / tasks) * 100}%` }} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">{done} of {tasks} done</p>
                      </>
                    ) : <span className="text-xs text-slate-400">No tasks</span>}
                  </div>
                  <div className="hidden md:block" onClick={(e) => e.stopPropagation()}>
                    {canDelete ? (
                      <RowActionsMenu actions={[
                        { key: 'open', label: 'Open', icon: Eye, onClick: () => open(c) },
                        { key: 'delete', label: 'Delete', icon: Trash2, variant: 'danger', onClick: () => setDeleting(c) },
                      ]} />
                    ) : <ChevronRight className="h-4 w-4 text-slate-300" />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CreatePanel open={!!create} mode={create || 'circular'} onMode={setCreate} onClose={() => setCreate(null)} />
      <ConfirmDialog open={!!deleting} title="Delete this regulatory change?" busy={remove.isPending}
        message={<>&ldquo;{deleting?.title}&rdquo; and its obligations, assessments and tasks will be removed.</>}
        onCancel={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}
