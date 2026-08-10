'use client';

/**
 * CTEM Phase 5 — ITSM mobilisation panel on the finding detail page.
 *
 * Push this finding to a configured ticketing connector, see its ticket(s)
 * and their status. Statuses are shown "as of last sync" (no scheduler in
 * this deployment — the computed_at honesty pattern), with a manual sync.
 * Resolving a ticket in ServiceNow advances the remediation plan to applied
 * (never verified — that stays the scanner/retest path).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi, connectorsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
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
  const [pickConn, setPickConn] = useState<number | ''>('');

  const { data: connData } = useQuery({
    queryKey: ['ticketing-connectors'],
    queryFn: async () => (await connectorsApi.list()).data,
  });
  const ticketingConns = useMemo(
    () => (connData?.items || []).filter((c) => c.category === 'ticketing'),
    [connData],
  );

  const { data: ticketData } = useQuery({
    queryKey: ['itsm-tickets', vulnId],
    queryFn: async () => (await vulnManagementApi.vulnerabilities.itsmTickets(vulnId)).data,
  });
  const tickets: TicketLink[] = ticketData?.tickets || [];

  const pushMut = useMutation({
    mutationFn: (connId: number) => vulnManagementApi.vulnerabilities.pushToItsm(vulnId, connId),
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: ['itsm-tickets', vulnId] }); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Push failed'),
  });
  const syncMut = useMutation({
    mutationFn: (connId: number) => vulnManagementApi.vulnerabilities.syncItsmStatuses(connId),
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: ['itsm-tickets', vulnId] }); },
    onError: (e: any) => setError(e?.response?.data?.detail || 'Sync failed'),
  });

  // Nothing to show and nothing to do → render nothing (tenants without a
  // ticketing connector see no dead panel).
  if (ticketingConns.length === 0 && tickets.length === 0) return null;

  return (
    <section className="cw-card rounded-xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Ticket className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
          ITSM mobilisation
        </h2>
        {canEdit && ticketingConns.length > 0 && (
          <div className="flex items-center gap-1.5">
            <select
              value={pickConn}
              onChange={(e) => setPickConn(e.target.value ? Number(e.target.value) : '')}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="">Connector…</option>
              {ticketingConns.map((c) => (
                <option key={c.id} value={c.id}>{c.connection_name}</option>
              ))}
            </select>
            <button
              onClick={() => pickConn && pushMut.mutate(pickConn)}
              disabled={!pickConn || pushMut.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
            >
              {pushMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Push to ITSM
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-2 flex items-start gap-1.5 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {tickets.length === 0 ? (
        <p className="text-xs text-slate-500">
          Not yet pushed to a ticketing system. Pushing creates (or reuses) a remediation plan
          and opens a ticket; resolving the ticket advances the plan to <em>applied</em> (a
          proven fix still requires a re-scan).
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tickets.map((t, i) => {
            const conn = ticketingConns.find((c) => c.id === t.connection_id);
            const pill = STATUS_PILL[t.normalised_status || 'new'] || STATUS_PILL.new;
            return (
              <li key={i} className="flex items-center justify-between gap-2 py-2 text-xs">
                <span className="min-w-0">
                  <span className="font-mono text-slate-700">{t.external_ticket_id || '(push failed)'}</span>
                  {conn && <span className="text-slate-400"> · {conn.connection_name}</span>}
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
                      title="Sync ticket statuses from the connector"
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
      {tickets.length > 0 && (
        <p className="mt-1.5 text-[10px] text-slate-400">
          Statuses as of the last manual sync — there is no scheduler in this deployment; use the
          sync button to refresh.
        </p>
      )}
    </section>
  );
}
