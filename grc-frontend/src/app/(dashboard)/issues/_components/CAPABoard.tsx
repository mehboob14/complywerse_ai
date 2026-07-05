'use client';

// CAPA Board — cross-issue Kanban grouped by action status.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckCircle2, Clock, ShieldCheck, AlertOctagon, Ban, ListChecks, Loader2 } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { formatDate, daysFromNow } from './shared';

interface ActionRow {
  id: number;
  issue_id: number;
  action_type: string;
  title: string;
  status: string;
  assignee_id: number | null;
  assignee_name: string | null;
  due_date: string | null;
}

const COLUMNS: Array<{ id: string; label: string; icon: React.ElementType; accent: string }> = [
  { id: 'planned',     label: 'Planned',     icon: ListChecks,    accent: 'border-slate-200 bg-slate-50' },
  { id: 'in_progress', label: 'In Progress', icon: Clock,         accent: 'border-primary-200 bg-primary-50/40' },
  { id: 'blocked',     label: 'Blocked',     icon: AlertOctagon,  accent: 'border-amber-200 bg-amber-50/40' },
  { id: 'completed',   label: 'Completed',   icon: CheckCircle2,  accent: 'border-emerald-200 bg-emerald-50/40' },
  { id: 'verified',    label: 'Verified',    icon: ShieldCheck,   accent: 'border-emerald-300 bg-emerald-50/40' },
  { id: 'cancelled',   label: 'Cancelled',   icon: Ban,           accent: 'border-slate-200 bg-slate-100' },
];

const TYPE_TONE: Record<string, string> = {
  corrective:   'border-primary-200 bg-primary-50 text-primary-700',
  preventive:   'border-emerald-200 bg-emerald-50 text-emerald-700',
  containment:  'border-amber-200 bg-amber-50 text-amber-700',
  verification: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function CAPABoard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ActionRow[]>({
    queryKey: ['capa-actions'],
    queryFn: async () => (await issuesApi.actions.listAll()).data,
    staleTime: 15_000,
  });

  const verifyMutation = useMutation({
    mutationFn: (id: number) => issuesApi.actions.verify(id, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['capa-actions'] }),
  });
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      issuesApi.actions.patch(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['capa-actions'] }),
  });

  if (isLoading) {
    return (
      <div className="flex h-[200px] items-center justify-center text-slate-400 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading CAPA actions…
      </div>
    );
  }

  const actions = data || [];
  const byStatus = COLUMNS.reduce<Record<string, ActionRow[]>>((acc, c) => {
    acc[c.id] = actions.filter((a) => a.status === c.id);
    return acc;
  }, {});

  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-10 text-center">
        <ListChecks className="mb-2 h-7 w-7 text-slate-300" />
        <h3 className="text-sm font-semibold text-slate-700">No CAPA actions yet</h3>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          Open an Issue and use the CAPA tab to add a corrective / preventive action.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2 lg:grid-cols-3 xl:grid-cols-6">
      {COLUMNS.map((col) => {
        const Icon = col.icon;
        const items = byStatus[col.id] || [];
        return (
          <div key={col.id} className={`rounded-xl border ${col.accent} flex flex-col min-h-[200px]`}>
            <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-1.5">
              <Icon className="h-3.5 w-3.5 text-slate-600" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">{col.label}</span>
              <span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 border border-slate-200">{items.length}</span>
            </div>
            <div className="p-2 space-y-1.5 overflow-y-auto max-h-[420px]">
              {items.map((a) => {
                const days = daysFromNow(a.due_date);
                const overdue = days != null && days < 0 && !['completed', 'verified', 'cancelled'].includes(a.status);
                return (
                  <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                    <div className="flex items-center gap-1 mb-1">
                      <span className={`rounded border px-1 py-px text-[9px] font-medium uppercase ${TYPE_TONE[a.action_type] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                        {a.action_type}
                      </span>
                      <Link href={`/issues/${a.issue_id}`} className="ml-auto text-[10px] font-semibold text-slate-500 hover:text-primary-700">
                        #{a.issue_id}
                      </Link>
                    </div>
                    <Link href={`/issues/${a.issue_id}`} className="block text-xs font-medium text-slate-900 line-clamp-2 hover:text-primary-700">
                      {a.title}
                    </Link>
                    <div className="mt-1.5 flex items-center justify-between text-[10px]">
                      <span className="text-slate-500 truncate">{a.assignee_name || 'Unassigned'}</span>
                      {a.due_date && (
                        <span className={overdue ? 'text-rose-700 font-semibold' : 'text-slate-500'}>
                          {formatDate(a.due_date)}
                        </span>
                      )}
                    </div>
                    {col.id === 'planned' && (
                      <button
                        onClick={() => updateStatusMutation.mutate({ id: a.id, status: 'in_progress' })}
                        className="mt-1.5 w-full rounded border border-primary-200 bg-white px-2 py-1 text-[10px] font-medium text-primary-700 hover:bg-primary-50"
                      >
                        Start
                      </button>
                    )}
                    {col.id === 'in_progress' && (
                      <button
                        onClick={() => updateStatusMutation.mutate({ id: a.id, status: 'completed' })}
                        className="mt-1.5 w-full rounded border border-emerald-200 bg-white px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        Mark Complete
                      </button>
                    )}
                    {col.id === 'completed' && (
                      <button
                        onClick={() => verifyMutation.mutate(a.id)}
                        className="mt-1.5 w-full rounded border border-emerald-300 bg-white px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        Verify Effectiveness
                      </button>
                    )}
                  </div>
                );
              })}
              {items.length === 0 && (
                <p className="px-1 py-2 text-[10px] text-slate-400 text-center">—</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
