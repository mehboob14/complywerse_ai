'use client';

// Stage 01 — Intake & Scoping. Turns the static intake stage into a real
// data-capture form editing the vendor profile (PUT /vendor-risk/vendors/{id}).
// Setting a business owner + a data access level satisfies the intake exit gate
// (has_owner + has_data_classification), so this directly unblocks Advance.

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { vendorRiskApi, adminApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'mb-1 block text-xs font-medium text-gray-700';

const DATA_ACCESS_LEVELS = [
  { value: 'none', label: 'None' },
  { value: 'internal', label: 'Internal' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'confidential', label: 'Confidential' },
];

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}
const toList = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean);
const fromList = (v: unknown): string => (Array.isArray(v) ? v.join(', ') : '');

export default function IntakePanel({ vendorId, onChanged }: { vendorId: number; onChanged?: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');

  const { data: vendor, isLoading } = useQuery({
    queryKey: ['vendor-intake', vendorId],
    queryFn: async () => (await vendorRiskApi.getVendor(vendorId)).data as Record<string, unknown>,
  });

  const { data: users } = useQuery({
    queryKey: ['admin-users-for-tpra-intake'],
    queryFn: async () => {
      try {
        const r = await adminApi.getUsers();
        return ((r.data || []) as Array<{ id: number; email?: string; full_name?: string; name?: string; first_name?: string; last_name?: string }>).map((u) => ({
          id: u.id,
          name: u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || `User ${u.id}`,
        }));
      } catch { return []; }
    },
  });

  const [form, setForm] = useState({
    owner_id: '' as number | '' , data_access_level: 'none', data_types_accessed: '',
    services_provided: '', geographic_locations: '', contract_value: '' as number | '',
    vendor_type: '', industry: '', website: '',
    primary_contact_name: '', primary_contact_email: '', description: '',
  });

  useEffect(() => {
    if (!vendor) return;
    setForm({
      owner_id: (vendor.owner_id as number) ?? '',
      data_access_level: (vendor.data_access_level as string) || 'none',
      data_types_accessed: fromList(vendor.data_types_accessed),
      services_provided: fromList(vendor.services_provided),
      geographic_locations: fromList(vendor.geographic_locations),
      contract_value: (vendor.contract_value as number) ?? '',
      vendor_type: (vendor.vendor_type as string) || '',
      industry: (vendor.industry as string) || '',
      website: (vendor.website as string) || '',
      primary_contact_name: (vendor.primary_contact_name as string) || '',
      primary_contact_email: (vendor.primary_contact_email as string) || '',
      description: (vendor.description as string) || '',
    });
  }, [vendor]);

  const save = useMutation({
    mutationFn: () => vendorRiskApi.updateVendor(vendorId, {
      owner_id: form.owner_id === '' ? null : Number(form.owner_id),
      data_access_level: form.data_access_level,
      data_types_accessed: toList(form.data_types_accessed),
      services_provided: toList(form.services_provided),
      geographic_locations: toList(form.geographic_locations),
      contract_value: form.contract_value === '' ? null : Number(form.contract_value),
      vendor_type: form.vendor_type || null,
      industry: form.industry || null,
      website: form.website || null,
      primary_contact_name: form.primary_contact_name || null,
      primary_contact_email: form.primary_contact_email || null,
      description: form.description || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-intake', vendorId] });
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      onChanged?.();
      toast({ type: 'success', title: 'Intake saved' });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errMsg(e, 'Try again.') }),
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading vendor…</div>;
  }

  const ownerSet = form.owner_id !== '';
  const classSet = form.data_access_level !== 'none';

  return (
    <div className="space-y-4">
      {/* Gate helper */}
      <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600" />
        <div>
          <p>Capture the business owner and the data/service scope. A named <span className="font-medium">business owner</span> and a <span className="font-medium">data access level</span> above &ldquo;None&rdquo; satisfy this stage&apos;s exit gate.</p>
          <div className="mt-1.5 flex flex-wrap gap-3 text-[11px]">
            <span className={`inline-flex items-center gap-1 ${ownerSet ? 'text-emerald-600' : 'text-gray-400'}`}>
              <CheckCircle2 className="h-3 w-3" /> Business owner {ownerSet ? 'set' : 'needed'}
            </span>
            <span className={`inline-flex items-center gap-1 ${classSet ? 'text-emerald-600' : 'text-gray-400'}`}>
              <CheckCircle2 className="h-3 w-3" /> Data classification {classSet ? 'set' : 'needed'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Business owner</label>
          <select className={inputCls} value={form.owner_id} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, owner_id: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">Unassigned</option>
            {(users || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Data access level</label>
          <select className={inputCls} value={form.data_access_level} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, data_access_level: e.target.value })}>
            {DATA_ACCESS_LEVELS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelCls}>Data types accessed <span className="text-gray-400">(comma-separated)</span></label>
        <input className={inputCls} value={form.data_types_accessed} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, data_types_accessed: e.target.value })}
          placeholder="PII, cardholder data, health records" />
      </div>
      <div>
        <label className={labelCls}>Systems &amp; services in scope <span className="text-gray-400">(comma-separated)</span></label>
        <input className={inputCls} value={form.services_provided} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, services_provided: e.target.value })}
          placeholder="Cloud hosting, payment processing" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Geographic locations <span className="text-gray-400">(comma-separated)</span></label>
          <input className={inputCls} value={form.geographic_locations} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, geographic_locations: e.target.value })} placeholder="US, EU" />
        </div>
        <div>
          <label className={labelCls}>Annual contract value</label>
          <input type="number" className={inputCls} value={form.contract_value} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, contract_value: e.target.value ? Number(e.target.value) : '' })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>Vendor type</label>
          <input className={inputCls} value={form.vendor_type} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, vendor_type: e.target.value })} placeholder="Processor / SaaS" />
        </div>
        <div>
          <label className={labelCls}>Industry</label>
          <input className={inputCls} value={form.industry} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, industry: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Website</label>
          <input className={inputCls} value={form.website} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Primary contact</label>
          <input className={inputCls} value={form.primary_contact_name} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, primary_contact_name: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Contact email</label>
          <input type="email" className={inputCls} value={form.primary_contact_email} disabled={!canEdit}
            onChange={(e) => setForm({ ...form, primary_contact_email: e.target.value })} />
        </div>
      </div>

      <div>
        <label className={labelCls}>Service description &amp; business need</label>
        <textarea className={inputCls} rows={2} value={form.description} disabled={!canEdit}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save intake
          </button>
        </div>
      )}
    </div>
  );
}
