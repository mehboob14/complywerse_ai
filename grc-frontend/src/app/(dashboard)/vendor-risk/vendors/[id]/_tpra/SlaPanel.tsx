'use client';

// Service levels of a vendor: each service level measured against the contract it
// is promised in. With a target, a measurement and the way that is good, met or missed
// follows from the numbers; a miss becomes a monitoring signal.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus } from 'lucide-react';
import { vendorContractsApi, vendorRiskApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN, Panel, StatusPill, fmt } from '../../../_ui';
import { errText } from '../../../_lib/intake/types';
import type { Register } from '../../../_lib/contracts/shared';
import { paperworkApi, type SlaRecord } from '../../../_lib/paperworkApi';

type Direction = '' | 'higher_is_better' | 'lower_is_better';
type Form = {
  sla_metric: string; contract_id: string; target_value: string; actual_value: string; unit: string;
  direction: Direction; measurement_period: string; is_compliant: 'yes' | 'no'; notes: string;
};

const PERIODS = ['monthly', 'quarterly', 'yearly'];
const th = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#64707e]';
const td = 'px-3 py-2.5 text-[13px] leading-5 text-[#26323d]';
const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500';

const amount = (v: number | null, unit: string | null) =>
  v === null ? '-' : unit === '%' ? `${v}%` : unit ? `${v} ${unit}` : String(v);

/** The rule the server applies, so the form can say met or missed before saving. */
function metByNumbers(f: Form): boolean | null {
  if (!f.target_value.trim() || !f.actual_value.trim() || !f.direction) return null;
  const target = Number(f.target_value);
  const measured = Number(f.actual_value);
  return f.direction === 'higher_is_better' ? measured >= target : measured <= target;
}

function toForm(r: SlaRecord | null): Form {
  return {
    sla_metric: r?.sla_metric ?? '', contract_id: r?.contract_id ? String(r.contract_id) : '',
    target_value: r?.target_value != null ? String(r.target_value) : '', actual_value: r?.actual_value != null ? String(r.actual_value) : '',
    unit: r?.unit ?? '', direction: r?.direction ?? '', measurement_period: r?.measurement_period || 'monthly',
    is_compliant: r && !r.is_compliant ? 'no' : 'yes', notes: r?.notes ?? '',
  };
}

export default function SlaPanel({ vendorId }: { vendorId: number }) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:monitoring:create') || hasPermission('erm:risks:edit');
  const canEdit = hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit');
  const [open, setOpen] = useState<SlaRecord | 'new' | null>(null);

  const { data: records, isLoading } = useQuery({
    queryKey: ['vendor-sla', vendorId],
    queryFn: async () => ((await vendorRiskApi.getVendorSLA(vendorId)).data?.items ?? []) as SlaRecord[],
  });
  const { data: contracts } = useQuery<Register>({
    queryKey: ['tprm-contracts', { vendorId }],
    queryFn: async () => (await vendorContractsApi.list({ vendor_id: vendorId })).data,
  });
  const contractName = (id: number | null) => {
    const c = id ? contracts?.items.find((x) => x.id === id) : undefined;
    return c ? c.title || c.type_label : id ? `Contract ${id}` : '-';
  };

  const missed = (records ?? []).filter((s) => !s.is_compliant).length;
  return (
    <Panel
      title="Service levels"
      count={(records ?? []).length || undefined}
      description={missed ? `${missed} missed` : undefined}
      info="Each service level measured against the contract that promises it. With a target, a measurement and the way that is good, met or missed follows from the numbers; a miss becomes a monitoring signal."
      action={canCreate ? (
        <button type="button" onClick={() => setOpen('new')} className={BTN}>
          <Plus className="h-4 w-4" aria-hidden /> Add measurement
        </button>
      ) : undefined}
    >
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table of service levels">
        <table className="min-w-full">
          <thead>
            <tr className="border-y border-[#e1e6eb] bg-[#f7f9fa]">
              <th scope="col" className={th}>Metric</th><th scope="col" className={th}>Target</th><th scope="col" className={th}>Measured</th>
              <th scope="col" className={th}>Result</th><th scope="col" className={th}>Contract</th><th scope="col" className={th}>Period</th>
              <th scope="col" className={th}>Recorded</th>
              {canEdit && <th scope="col" className={th}><span className="sr-only">Edit</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e1e6eb]">
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-[#64707e]"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></td></tr>
            ) : (records ?? []).length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[13px] text-[#64707e]">No service levels measured yet.</td></tr>
            ) : (records ?? []).map((s) => (
              <tr key={s.id}>
                <td className={`${td} font-medium text-[#1f2933]`}>{s.sla_metric}</td>
                <td className={td}>{amount(s.target_value, s.unit)}</td>
                <td className={td}>{amount(s.actual_value, s.unit)}</td>
                <td className={td}><StatusPill tone={s.is_compliant ? 'success' : 'danger'} variant="inline">{s.is_compliant ? 'Met' : 'Missed'}</StatusPill></td>
                <td className={td}>{contractName(s.contract_id)}</td>
                <td className={`${td} capitalize`}>{s.measurement_period || '-'}</td>
                <td className={`${td} whitespace-nowrap`}>{s.recorded_at ? fmt.date(s.recorded_at) : '-'}</td>
                {canEdit && (
                  <td className={`${td} text-right`}>
                    <button type="button" onClick={() => setOpen(s)} aria-label={`Edit ${s.sla_metric}`} title="Edit"
                      className="grid h-8 w-8 place-items-center rounded-lg text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"><Pencil aria-hidden className="h-4 w-4" /></button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open !== null && (
        <SlaForm vendorId={vendorId} record={open === 'new' ? null : open} contracts={contracts?.items ?? []} onClose={() => setOpen(null)} />
      )}
    </Panel>
  );
}

function SlaForm({ vendorId, record, contracts, onClose }: {
  vendorId: number; record: SlaRecord | null; contracts: Register['items']; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => toForm(record));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const met = metByNumbers(form);
  const needsDirection = !!form.target_value.trim() && !!form.actual_value.trim() && !form.direction;

  const save = useMutation({
    mutationFn: async () => {
      const n = (v: string) => (v.trim() ? Number(v) : null);
      const body = {
        sla_metric: form.sla_metric.trim(), contract_id: form.contract_id ? Number(form.contract_id) : null,
        target_value: n(form.target_value), actual_value: n(form.actual_value), unit: form.unit.trim() || null,
        direction: form.direction || null, measurement_period: form.measurement_period,
        is_compliant: form.is_compliant === 'yes', notes: form.notes.trim() || null,
      };
      const res = record ? await paperworkApi.updateSla(vendorId, record.id, body) : await vendorRiskApi.createVendorSLA(vendorId, body);
      return res.data as SlaRecord & { signal_id: number | null };
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['vendor-sla', vendorId] });
      qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
      qc.invalidateQueries({ predicate: (q) => ['tpra-signals', 'tpra-lifecycle'].includes(String(q.queryKey[0])) });
      toast(saved.signal_id ? { type: 'warning', title: 'Missed', message: 'Raised as a monitoring signal.' }
        : { type: 'success', title: record ? 'Measurement saved' : 'Measurement added' });
      onClose();
    },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });

  return (
    <RightSlidePanel isOpen onClose={onClose} title={record ? 'Edit measurement' : 'Add measurement'} width="w-full max-w-xl"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" form="vendor-sla-form" disabled={save.isPending || !form.sla_metric.trim() || needsDirection}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
      }>
      <form id="vendor-sla-form" className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="block md:col-span-2">
          <span className="mb-1 block text-sm font-medium text-gray-800">Metric *</span>
          <input required maxLength={255} className={input} value={form.sla_metric} placeholder="e.g. Uptime"
            onChange={(e) => set('sla_metric', e.target.value)} />
        </label>
        <div className="md:col-span-2">
          <div className="mb-1 flex items-center gap-1">
            <label htmlFor="sla-contract" className="text-sm font-medium text-gray-800">Contract</label>
            <InfoTip label="About the contract" text="The contract that promises this level, so a miss is measured against what was agreed." />
          </div>
          <select id="sla-contract" className={input} value={form.contract_id} onChange={(e) => set('contract_id', e.target.value)}>
            <option value="">None</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.title || c.type_label}</option>)}
          </select>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-800">Target</span>
          <input type="number" step="any" className={input} value={form.target_value} onChange={(e) => set('target_value', e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-800">Measured</span>
          <input type="number" step="any" className={input} value={form.actual_value} onChange={(e) => set('actual_value', e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-800">Unit</span>
          <input maxLength={20} className={input} value={form.unit} placeholder="%, hours, ms" onChange={(e) => set('unit', e.target.value)} />
        </label>
        <div>
          <div className="mb-1 flex items-center gap-1">
            <label htmlFor="sla-direction" className="text-sm font-medium text-gray-800">Better is</label>
            <InfoTip label="About which way is better" text="Higher for uptime, lower for response or fix times. With a target and a measurement, met or missed follows from it." />
          </div>
          <select id="sla-direction" className={input} value={form.direction} onChange={(e) => set('direction', e.target.value as Direction)}
            aria-invalid={needsDirection}>
            <option value="">Not set</option><option value="higher_is_better">Higher</option><option value="lower_is_better">Lower</option>
          </select>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-800">Period</span>
          <select className={input} value={form.measurement_period} onChange={(e) => set('measurement_period', e.target.value)}>
            {Array.from(new Set([...PERIODS, form.measurement_period])).map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
        </label>
        <div className="block">
          {met === null ? (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-800">Result</span>
              <select className={input} value={form.is_compliant} onChange={(e) => set('is_compliant', e.target.value as Form['is_compliant'])}>
                <option value="yes">Met</option><option value="no">Missed</option>
              </select>
            </label>
          ) : (
            <>
              <span className="mb-1 block text-sm font-medium text-gray-800">Result</span>
              <p className={`py-2 text-sm font-medium ${met ? 'text-green-700' : 'text-red-700'}`}>{met ? 'Met' : 'Missed'}</p>
            </>
          )}
        </div>
        {needsDirection && <p role="alert" className="text-xs text-rose-700 md:col-span-2">Say whether a higher or a lower value is better.</p>}
        <label className="block md:col-span-2">
          <span className="mb-1 block text-sm font-medium text-gray-800">Notes</span>
          <textarea rows={2} className={input} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </form>
    </RightSlidePanel>
  );
}
