'use client';

// Contracting & Controls CRUD surface (stage 07). Contracts + their control
// obligations with renewal dates. RBAC-gated; toasts on mutate.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ChevronDown, ChevronRight, FileSignature, Loader2 } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { Contract, Obligation } from './types';
import { CONTRACT_TYPES, fmtDate } from './constants';
import { useUnsavedGuard } from './useUnsavedGuard';

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function ContractsPanel({ vendorId, assessmentId }: { vendorId: number; assessmentId?: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:contracts:edit') || hasPermission('erm:risks:edit');
  const canCreate = hasPermission('vendor_risk:contracts:create') || canEdit;
  const canDelete = hasPermission('vendor_risk:contracts:delete') || canEdit;

  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-contracts', vendorId],
    queryFn: async () => (await tpraApi.listContracts(vendorId)).data as { items: Contract[] },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tpra-contracts', vendorId] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
  };

  const createMut = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createContract(vendorId, { ...p, assessment_id: assessmentId }),
    onSuccess: () => { invalidate(); setShowCreate(false); toast({ type: 'success', title: 'Contract added' }); },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => tpraApi.deleteContract(id),
    onSuccess: () => { invalidate(); toast({ type: 'success', title: 'Contract removed' }); },
  });

  const contracts = data?.items || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        {canCreate && (
          <button onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
            <Plus className="h-3.5 w-3.5" /> Add contract
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <FileSignature className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No contracts yet</p>
          <p className="text-xs text-gray-500">Capture the DPA / SLA / security addendum and its control obligations.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => (
            <ContractCard key={c.id} contract={c} expanded={expanded === c.id}
              onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
              canEdit={canEdit} canDelete={canDelete} onDelete={() => deleteMut.mutate(c.id)} />
          ))}
        </div>
      )}

      <CreateContractPanel open={showCreate} onClose={() => setShowCreate(false)}
        onSubmit={(p) => createMut.mutate(p)} busy={createMut.isPending} />
    </div>
  );
}

function ContractCard({
  contract, expanded, onToggle, canEdit, canDelete, onDelete,
}: { contract: Contract; expanded: boolean; onToggle: () => void; canEdit: boolean; canDelete: boolean; onDelete: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showObl, setShowObl] = useState(false);

  const { data: obl } = useQuery({
    queryKey: ['tpra-obligations', contract.id],
    queryFn: async () => (await tpraApi.listObligations(contract.id)).data as { items: Obligation[] },
    enabled: expanded,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tpra-obligations', contract.id] });

  const addObl = useMutation({
    mutationFn: (p: Record<string, unknown>) => tpraApi.createObligation(contract.id, p),
    onSuccess: () => { refresh(); setShowObl(false); toast({ type: 'success', title: 'Obligation added' }); },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });
  const delObl = useMutation({ mutationFn: (id: number) => tpraApi.deleteObligation(id), onSuccess: refresh });

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-start gap-3 p-3">
        <button onClick={onToggle} aria-label={expanded ? 'Collapse' : 'Expand'} className="mt-0.5 text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{contract.contract_type.replace('_', ' ')}</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{contract.status}</span>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">{contract.title || 'Untitled contract'}</p>
          <p className="mt-0.5 text-[11px] text-gray-500">Renewal {fmtDate(contract.renewal_date)} · Expiry {fmtDate(contract.expiry_date)}</p>
        </div>
        {canDelete && (
          <button onClick={onDelete} aria-label="Delete contract" className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-3 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Control obligations</p>
            {canEdit && <button onClick={() => setShowObl(true)} className="text-[11px] font-medium text-primary-600 hover:underline">+ Add obligation</button>}
          </div>
          {(obl?.items || []).length === 0 ? (
            <p className="text-xs text-gray-400">No obligations.</p>
          ) : (
            <div className="space-y-1.5">
              {obl!.items.map((o) => (
                <div key={o.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-800">{o.obligation}</p>
                    <p className="text-[11px] text-gray-500">{o.control_ref || '—'} · renewal {fmtDate(o.renewal_date)} · {o.status}</p>
                  </div>
                  {canEdit && (
                    <button onClick={() => delObl.mutate(o.id)} aria-label="Delete obligation" className="text-gray-400 hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <AddObligationPanel open={showObl} onClose={() => setShowObl(false)} onSubmit={(p) => addObl.mutate(p)} busy={addObl.isPending} />
    </div>
  );
}

function CreateContractPanel({
  open, onClose, onSubmit, busy,
}: { open: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [form, setForm] = useState({ contract_type: 'security_addendum', title: '', renewal_date: '', expiry_date: '' });
  useUnsavedGuard(open && !!form.title);
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Add contract" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tpra-contract-form" type="submit" disabled={busy}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add contract'}
          </button>
        </div>
      }>
      <form id="tpra-contract-form" onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, renewal_date: form.renewal_date || undefined, expiry_date: form.expiry_date || undefined });
      }} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Title</label>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Type</label>
          <select className={inputCls} value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
            {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Renewal date</label>
            <input type="date" className={inputCls} value={form.renewal_date} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Expiry date</label>
            <input type="date" className={inputCls} value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} />
          </div>
        </div>
      </form>
    </RightSlidePanel>
  );
}

function AddObligationPanel({
  open, onClose, onSubmit, busy,
}: { open: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [form, setForm] = useState({ obligation: '', control_ref: '', renewal_date: '' });
  useUnsavedGuard(open && !!form.obligation);
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Add control obligation" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tpra-obl-form" type="submit" disabled={busy}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add obligation'}
          </button>
        </div>
      }>
      <form id="tpra-obl-form" onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, control_ref: form.control_ref || undefined, renewal_date: form.renewal_date || undefined });
      }} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Obligation</label>
          <textarea className={inputCls} rows={3} value={form.obligation} onChange={(e) => setForm({ ...form, obligation: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Control ref</label>
            <input className={inputCls} value={form.control_ref} onChange={(e) => setForm({ ...form, control_ref: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Renewal date</label>
            <input type="date" className={inputCls} value={form.renewal_date} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })} />
          </div>
        </div>
      </form>
    </RightSlidePanel>
  );
}
