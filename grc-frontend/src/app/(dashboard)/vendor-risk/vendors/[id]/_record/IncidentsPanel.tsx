'use client';

// Incidents at a vendor: what happened, how bad, and where it stands. Moved from its own tab to Monitoring. "Record incident" opens a
// dialog; a critical incident opens an Issue on its own, linked from its row. "Loss event" records one as a Basel loss event in Risk
// Management, once (backend tpra/outsourcing.record_loss_event); its row then links to it.
import { useId, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Loader2, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { BUSINESS_LINES, EVENT_TYPES } from '@/app/(dashboard)/erm/incidents/lossEvents';
import { BTN, BTN_PRIMARY, Dialog, EmptyState, ErrorState, Panel, SeverityChip, Skeleton, StatusPill, fmt, type Tone } from '../../../_ui';
import { TPRM_QUERY_OPTS } from '../../../_lib/tprmQuery';
import { localToServer } from '../../../_lib/vendorRecordModel';
import { lossEventProblem, netLoss } from '../../../_lib/outsourcingModel';
import { AREA, FIELD, HINT, LABEL } from '../../_components/formStyles';

interface Incident {
  id: number; title: string; severity: string; status: string; description: string | null; occurred_at: string | null;
  resolved_at: string | null; linked_issue_id?: number | null; loss_event_id?: number | null;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUS_TONE: Record<string, Tone> = { open: 'danger', investigating: 'warning', resolved: 'success', closed: 'neutral' };
const TH = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#64707e]';
const TD = 'px-3 py-2.5 align-top text-[13px] leading-5 text-[#26323d]';
const incidentsKey = (vendorId: number) => ['vendor-incidents', vendorId] as const;

export default function IncidentsPanel({ vendorId }: { vendorId: number }) {
  const { hasPermission } = usePermissions();
  // as the server holds it: recording an incident is a monitoring write
  const canCreate = hasPermission('vendor_risk:monitoring:create') || hasPermission('erm:risks:edit');
  // writing a loss event is Risk Management's right, on top of the monitoring write
  const canLoss = (hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit'))
    && (hasPermission('erm:incidents:create') || hasPermission('erm:risks:create'));
  const [adding, setAdding] = useState(false);
  const [losing, setLosing] = useState<Incident | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: incidentsKey(vendorId),
    queryFn: async () => {
      const d = (await vendorRiskApi.getVendorIncidents(vendorId)).data;
      return (Array.isArray(d) ? d : d.items ?? []) as Incident[];
    },
    ...TPRM_QUERY_OPTS,
  });
  const rows = data ?? [];

  return (
    <Panel
      title="Incidents"
      count={rows.length || undefined}
      info="A critical incident opens an Issue of its own, linked from its row."
      action={canCreate ? <button type="button" onClick={() => setAdding(true)} className={BTN}><Plus aria-hidden className="h-4 w-4" /> Record incident</button> : undefined}
    >
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : isError ? (
        <ErrorState title="Couldn't load the incidents" onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState bare title="No incidents recorded" />
      ) : (
        <div className="-mx-5 overflow-x-auto" tabIndex={0} role="region" aria-label="Table of incidents">
          <table className="min-w-full">
            <thead>
              <tr className="border-y border-[#e1e6eb] bg-[#f7f9fa]">
                {['Incident', 'Severity', 'Status', 'Occurred', 'Resolved'].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e1e6eb]">
              {rows.map((inc) => (
                <tr key={inc.id}>
                  <td className={TD}>
                    <span className="font-medium text-[#1f2933]">{inc.title}</span>
                    {inc.linked_issue_id && (
                      <Link href={`/issues/${inc.linked_issue_id}`} className="ml-2 inline-flex items-center gap-0.5 text-[12px] font-medium text-[#0f766e] hover:underline">
                        Issue #{inc.linked_issue_id} <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
                      </Link>
                    )}
                    {inc.loss_event_id ? (
                      <Link href={`/erm/incidents/${inc.loss_event_id}`} className="ml-2 inline-flex items-center gap-0.5 text-[12px] font-medium text-[#0f766e] hover:underline">
                        Loss event #{inc.loss_event_id} <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
                      </Link>
                    ) : canLoss ? (
                      <button type="button" onClick={() => setLosing(inc)} className="ml-2 text-[12px] font-medium text-[#0f766e] hover:underline">
                        Record as loss event
                      </button>
                    ) : null}
                    {inc.description && <span className="line-clamp-2 block text-[12px] leading-4 text-[#64707e]">{inc.description}</span>}
                  </td>
                  <td className={TD}><SeverityChip severity={inc.severity} solid={false} /></td>
                  <td className={TD}><StatusPill tone={STATUS_TONE[String(inc.status).toLowerCase()] ?? 'neutral'} variant="inline">{fmt.status(inc.status)}</StatusPill></td>
                  <td className={`${TD} whitespace-nowrap`}>{fmt.date(inc.occurred_at)}</td>
                  <td className={`${TD} whitespace-nowrap`}>{inc.resolved_at ? fmt.date(inc.resolved_at) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <RecordDialog vendorId={vendorId} open={adding} onClose={() => setAdding(false)} />
      <LossEventDialog vendorId={vendorId} incident={losing} onClose={() => setLosing(null)} />
    </Panel>
  );
}

function LossEventDialog({ vendorId, incident, onClose }: { vendorId: number; incident: Incident | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useId();
  const blank = { gross: '', recoveries: '', currency: '', event_type: 'execution_delivery', business_line: '' };
  const [f, setF] = useState(blank);
  const set = (patch: Partial<typeof blank>) => setF((prev) => ({ ...prev, ...patch }));
  const problem = lossEventProblem(f.gross, f.recoveries, f.currency);
  const net = netLoss(f.gross, f.recoveries);

  const save = useMutation({
    mutationFn: async () => (await tpraApi.recordLossEvent(incident!.id, {
      event_type: f.event_type,
      ...(f.business_line ? { business_line: f.business_line } : {}),
      ...(f.gross.trim() ? { gross_loss: Number(f.gross) } : {}),
      ...(f.recoveries.trim() ? { recoveries: Number(f.recoveries) } : {}),
      ...(f.currency.trim() ? { currency: f.currency.trim().toUpperCase() } : {}),
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: incidentsKey(vendorId) });
      setF(blank);
      toast({ type: 'success', title: 'Loss event recorded', message: 'It waits for a second person to validate it in Loss Events.' });
      onClose();
    },
    onError: (e) => toast({ type: 'error', title: 'Not recorded', message: apiErrorText(e, 'Try again.') }),
  });

  return (
    <Dialog open={!!incident} onClose={onClose} size={600} title="Record as loss event"
      description={incident ? `${incident.title}: a Basel loss event in Risk Management, linked to this incident.` : undefined}
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={!!problem || save.isPending} className={BTN_PRIMARY}>
            {save.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Record
          </button>
        </>
      )}
    >
      <form id={form} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (!problem && !save.isPending) save.mutate(); }}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${form}-type`} className={LABEL}>Event type</label>
            <select id={`${form}-type`} className={FIELD} value={f.event_type} onChange={(e) => set({ event_type: e.target.value })}>
              {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-line`} className={LABEL}>Business line <span className={HINT}>(optional)</span></label>
            <select id={`${form}-line`} className={FIELD} value={f.business_line} onChange={(e) => set({ business_line: e.target.value })}>
              <option value="">Not set</option>
              {BUSINESS_LINES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <div>
            <label htmlFor={`${form}-gross`} className={LABEL}>Gross loss</label>
            <input id={`${form}-gross`} inputMode="decimal" className={FIELD} value={f.gross} onChange={(e) => set({ gross: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${form}-rec`} className={LABEL}>Recoveries</label>
            <input id={`${form}-rec`} inputMode="decimal" className={FIELD} value={f.recoveries} onChange={(e) => set({ recoveries: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${form}-cur`} className={LABEL}>Currency</label>
            <input id={`${form}-cur`} maxLength={3} placeholder="USD" className={FIELD} value={f.currency} onChange={(e) => set({ currency: e.target.value })} />
          </div>
        </div>
        <p className="text-[13px] text-[#586472]">
          {problem ?? (net === null ? 'No amount: recorded as an event without a loss figure.' : `Net loss ${net.toLocaleString('en-GB')} ${f.currency.trim().toUpperCase()}`)}
        </p>
      </form>
    </Dialog>
  );
}

function RecordDialog({ vendorId, open, onClose }: { vendorId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useId();
  const blank = { title: '', severity: 'medium', occurred_at: '', description: '' };
  const [f, setF] = useState(blank);
  const set = (patch: Partial<typeof blank>) => setF((prev) => ({ ...prev, ...patch }));

  const record = useMutation({
    mutationFn: async () => (await vendorRiskApi.createVendorIncident(vendorId, {
      title: f.title.trim(), severity: f.severity,
      ...(f.occurred_at ? { occurred_at: localToServer(f.occurred_at) } : {}),
      ...(f.description.trim() ? { description: f.description.trim() } : {}),
    })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: incidentsKey(vendorId) });
      qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
      setF(blank);
      toast({ type: 'success', title: 'Incident recorded' });
      onClose();
    },
    onError: (e) => toast({ type: 'error', title: 'Not recorded', message: apiErrorText(e, 'Try again.') }),
  });
  const ready = !!f.title.trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={600}
      title="Record incident"
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={!ready || record.isPending} className={BTN_PRIMARY}>
            {record.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Record
          </button>
        </>
      )}
    >
      <form id={form} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready && !record.isPending) record.mutate(); }}>
        <div>
          <label htmlFor={`${form}-title`} className={LABEL}>What happened</label>
          <input id={`${form}-title`} data-autofocus required maxLength={255} className={FIELD} value={f.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${form}-severity`} className={LABEL}>Severity</label>
            <select id={`${form}-severity`} className={FIELD} value={f.severity} onChange={(e) => set({ severity: e.target.value })}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{fmt.status(s)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${form}-when`} className={LABEL}>When <span className={HINT}>(now if blank)</span></label>
            <input id={`${form}-when`} type="datetime-local" className={FIELD} value={f.occurred_at} onChange={(e) => set({ occurred_at: e.target.value })} />
          </div>
        </div>
        <div>
          <label htmlFor={`${form}-desc`} className={LABEL}>Detail <span className={HINT}>(optional)</span></label>
          <textarea id={`${form}-desc`} rows={3} className={AREA} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </div>
      </form>
    </Dialog>
  );
}
