'use client';

/**
 * Help Desk panel on the finding detail (Remediation tab).
 *
 * Create a Help Desk ticket for THIS finding, see its ticket(s) and status.
 * The ticket engine stays invisible: the client never picks a connector — the
 * backend resolves the tenant's Help Desk connection server-side. Statuses are
 * shown "as of last sync" with a manual refresh.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/cyber-assurance/lib/api';
import { usePermissions } from '@/cyber-assurance/hooks/usePermissions';
import { Ticket, Loader2, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';

interface TicketLink {
  connection_id: number;
  external_ticket_id: string | null;
  normalised_status: string | null;
  pushed_at: string | null;
  resolved_at: string | null;
  plan_advanced_at: string | null;
  push_error: string | null;
}

const STATUS_PILL: Record<string, string> = {
  new: 'bg-slate-50 text-slate-600',
  in_progress: 'bg-amber-50 text-amber-700',
  on_hold: 'bg-amber-50 text-amber-700',
  resolved: 'bg-emerald-50 text-emerald-700',
  closed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-rose-50 text-rose-700',
};

export default function ItsmPanel({ vulnId }: { vulnId: number }) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vulnerabilities:vulnerability_register:edit');
  const [error, setError] = useState<string | null>(null);

  const { data: ticketData } = useQuery({
    queryKey: ['itsm-tickets', vulnId],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.itsmTickets(vulnId)).data,
  });
  const tickets: TicketLink[] = ticketData?.tickets || [];
  // Deep-link straight to the created ticket instead of the whole board.
  const primaryTicketId = tickets.find((t) => t.external_ticket_id)?.external_ticket_id;

  // No connection_id: the Help Desk engine is invisible, resolved server-side.
  const pushMut = useMutation({
    mutationFn: () => vulnManagementApi.vulnerabilities.pushToItsm(vulnId),
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: ['itsm-tickets', vulnId] }); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Could not create ticket'),
  });
  const syncMut = useMutation({
    mutationFn: (connId: number) => vulnManagementApi.vulnerabilities.syncItsmStatuses(connId),
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: ['itsm-tickets', vulnId] }); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Sync failed'),
  });

  return (
    <section className="cw-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Ticket className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
          Help Desk
        </h2>
        {canEdit && (
          <button
            onClick={() => pushMut.mutate()}
            disabled={pushMut.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {pushMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />}
            Create Help Desk ticket
          </button>
        )}
      </div>

      {error && (
        <p className="mb-2 flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {tickets.length === 0 ? (
        <p className="text-xs text-slate-500">
          No Help Desk ticket yet. Creating one opens a ticket (auto-assigned, with an SLA)
          and a remediation plan; resolving the ticket advances the plan to <em>applied</em>
          (a proven fix still requires a re-scan).
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tickets.map((t, i) => {
            const pill = STATUS_PILL[t.normalised_status || 'new'] || STATUS_PILL.new;
            return (
              <li key={i} className="flex items-center justify-between gap-2 py-2 text-xs">
                <span className="min-w-0">
                  <span className="font-mono text-slate-700">{t.external_ticket_id || '(create failed)'}</span>
                  {t.plan_advanced_at && <span className="ml-1 text-emerald-600">· plan applied</span>}
                  {t.push_error && <span className="ml-1 text-rose-600">· {t.push_error}</span>}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className={`rounded-full px-1.5 py-0 text-[10px] font-semibold ${pill}`}>
                    {t.normalised_status || 'new'}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => syncMut.mutate(t.connection_id)}
                      disabled={syncMut.isPending}
                      className="text-slate-400 hover:text-slate-700"
                      title="Refresh ticket status"
                    >
                      {syncMut.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Link href={primaryTicketId ? `/helpdesk/tickets/${primaryTicketId}` : "/helpdesk/tickets"} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
        <ExternalLink className="h-3.5 w-3.5" /> View in Help Desk →
      </Link>
    </section>
  );
}
