'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Scale, X as XIcon } from 'lucide-react';
import { criticalTasksApi, ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { ACCEPTANCE_GROUPS, acceptancesByState } from './actionStatus';

// The acceptance fields GET /erm/risks serves (wave 1); acceptance_state is derived on the server.
export type AcceptanceRisk = {
  id: number;
  title: string;
  owner_id?: number | null;
  acceptance_state?: string | null;
  acceptance_reason?: string | null;
  acceptance_requested_by?: number | null;
  acceptance_requested_at?: string | null;
  accepted_by?: number | null;
  acceptance_expires_at?: string | null;
};

type TenantUser = { id: number; display_name?: string; username?: string; email?: string };

const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString('en-GB') : '—');

export default function AcceptancesTab({ risks }: { risks: AcceptanceRisk[] }) {
  const { hasAnyPermission } = usePermissions();
  // approving: the treatment right or the register edit right; the server refuses whoever asked (409)
  const canDecide = hasAnyPermission(['risks:risk_treatment:edit', 'erm:risks:edit']);
  const queryClient = useQueryClient();
  const groups = useMemo(() => acceptancesByState(risks), [risks]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<{ id: number; message: string } | null>(null);

  const { data: users } = useQuery({
    queryKey: ['tenant-users-for-acceptances'],
    queryFn: async () => ((await criticalTasksApi.getTenantUsers()).data || []) as TenantUser[],
  });
  const nameOf = (id?: number | null) => {
    const u = id ? (users || []).find((x) => x.id === id) : undefined;
    return u ? u.display_name || u.username || u.email || `User #${u.id}` : id ? `User #${id}` : '—';
  };

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      approve ? ermApi.risks.approveAcceptance(id, notes[id] || undefined) : ermApi.risks.rejectAcceptance(id, notes[id] || ''),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['erm-risks-list'] });
    },
    onError: (err: any, { id }) => setError({ id, message: err?.response?.data?.detail || 'Could not save the decision' }),
  });

  return (
    <div className="space-y-4">
      {ACCEPTANCE_GROUPS.map(({ state, label, empty }) => {
        const rows = groups[state] || [];
        return (
          <section key={state} className="rounded-xl border border-slate-200 bg-white">
            <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Scale className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
              <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{rows.length}</span>
            </header>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">{empty}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((risk) => (
                  <li key={risk.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/erm/risks/${risk.id}`} className="text-sm font-medium text-primary-700 hover:underline">
                        {risk.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Risk owner: {nameOf(risk.owner_id)} · Asked by {nameOf(risk.acceptance_requested_by)} on {day(risk.acceptance_requested_at)}
                        {' · '}Expires {day(risk.acceptance_expires_at)}
                        {state !== 'requested' && risk.accepted_by ? ` · Approved by ${nameOf(risk.accepted_by)}` : ''}
                      </p>
                      {risk.acceptance_reason && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{risk.acceptance_reason}</p>
                      )}
                      {error?.id === risk.id && (
                        <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{error.message}</p>
                      )}
                    </div>
                    {state === 'requested' && canDecide && (
                      <div className="flex w-full flex-col gap-2 sm:w-72">
                        <input
                          type="text"
                          value={notes[risk.id] || ''}
                          onChange={(e) => setNotes({ ...notes, [risk.id]: e.target.value })}
                          placeholder="Note (required to refuse)"
                          aria-label={`Decision note for ${risk.title}`}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: risk.id, approve: false })}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <XIcon className="h-3.5 w-3.5" /> Refuse
                          </button>
                          <button
                            type="button"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: risk.id, approve: true })}
                            className="cw-btn-primary inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                          >
                            {decide.isPending && decide.variables?.id === risk.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Check className="h-3.5 w-3.5" />}
                            Approve
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
