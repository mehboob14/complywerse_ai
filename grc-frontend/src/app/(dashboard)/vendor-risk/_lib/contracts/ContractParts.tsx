'use client';

// The pieces of the contract drawer that are a part of their own: the supplier picker of a new contract, what the contract binds the supplier to (obligations), its history, and the two small
// forms that act on a contract from the Contracts page and from the drawer (record a renewal, close it out). On the kit: kit fields and modal, every change reported and a failure said with
// the server's words; no native dialog. The drawer (ContractDrawer.tsx) re-exports the two dialogs and `refreshContracts`, so every import path is as it was.
import { useId, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import {
  Button, ErrorState, FormError, FormField, IconButton, Select, Textarea, TextInput, useConfirm, useReportedMutation,
} from '@/components/ui/ds';
import { formatDate, statusLabel } from '@/lib/format';
import { tpraApi, vendorContractsApi, vendorRiskApi } from '@/lib/api';
import { describe } from './contractForm';
import { OBLIGATION_STATUS, money, nextTerm, type ContractDetail, type ContractRow, type HistoryRow } from './shared';

const MUTED = 'text-ds-fg-muted';
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Whatever a change to a contract may move: the Contracts page, the drawer, a supplier's contracting stage and its panel. */
export function refreshContracts(qc: QueryClient) {
  void qc.invalidateQueries({ predicate: (q) => ['tprm-contracts', 'tprm-contract', 'tpra-lifecycle', 'tpra-contracts'].includes(String(q.queryKey[0])) });
}

// ── the supplier of a new contract ───────────────────────────────────────────────────────────────────────────────────────

export function VendorPicker({ value, onChange }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['tprm-vendor-pick', q],
    queryFn: async () => (await vendorRiskApi.getVendors({ search: q || undefined, limit: 20 })).data as { items: Array<{ id: number; name: string }> },
    enabled: !value,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[12px]">
        <div className="min-w-0"><p className={`text-ds-label ${MUTED}`}>Supplier</p><p className="break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{value.name}</p></div>
        <Button variant="link" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <FormField label="Which supplier is it with?" required>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers" autoFocus />
      </FormField>
      {query.isError ? <ErrorState compact title="Couldn't load the suppliers" onRetry={() => { void query.refetch(); }} /> : (
        <ul className="m-0 flex max-h-[192px] list-none flex-col gap-[2px] overflow-y-auto p-0">
          {(query.data?.items || []).map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => onChange({ id: v.id, name: v.name })} className="min-h-ds-control w-full rounded-ds-control px-[8px] py-[4px] text-left text-ds-body text-ds-fg-body [overflow-wrap:anywhere] hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">{v.name}</button>
            </li>
          ))}
          {query.isLoading && <li><p role="status" className={`px-[8px] text-ds-label ${MUTED}`}>Searching…</p></li>}
          {query.data && query.data.items.length === 0 && <li><p className={`px-[8px] text-ds-body ${MUTED}`}>No supplier matches.</p></li>}
        </ul>
      )}
    </div>
  );
}

// ── what it binds the supplier to ────────────────────────────────────────────────────────────────────────────────────────

export function Obligations({ contract, canEdit }: { contract: ContractDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ obligation: '', control_ref: '' });
  const done = () => refreshContracts(qc);
  const add = useReportedMutation({
    mutationFn: () => tpraApi.createObligation(contract.id, { obligation: draft.obligation.trim(), control_ref: draft.control_ref.trim() || undefined }),
    failure: "Couldn't add the obligation",
    retryable: false,
    onSuccess: () => { setDraft({ obligation: '', control_ref: '' }); done(); },
  });
  const update = useReportedMutation({
    mutationFn: ({ id, status, row_version }: { id: number; status: string; row_version: number }) => tpraApi.updateObligation(id, { status, row_version }),
    failure: "Couldn't change the obligation",
    onSuccess: done,
  });
  const drop = useReportedMutation({ mutationFn: (id: number) => tpraApi.deleteObligation(id), success: 'Obligation removed', failure: "Couldn't remove the obligation", onSuccess: done });

  return (
    <div className="flex flex-col gap-[12px]">
      {contract.obligations.length === 0 && <p className={`text-ds-body ${MUTED}`}>No obligations recorded. Add the security and service commitments the contract makes.</p>}
      <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
        {contract.obligations.map((o) => (
          <li key={o.id} className={`flex items-center gap-[8px] rounded-ds-card border px-[12px] py-[8px] ${o.status === 'breached' ? 'border-ds-danger-border bg-ds-danger-soft' : 'border-ds-border'}`}>
            <div className="min-w-0 flex-1">
              <p className="break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{o.obligation}</p>
              {o.control_ref && <p className={`text-ds-label ${MUTED}`}>{o.control_ref}</p>}
            </div>
            <div className="w-[120px] shrink-0">
              <Select aria-label={`Status of: ${o.obligation}`} value={o.status} disabled={!canEdit || update.isPending} onChange={(e) => update.mutate({ id: o.id, status: e.target.value, row_version: o.row_version })}>
                {OBLIGATION_STATUS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </Select>
            </div>
            {canEdit && <IconButton label={`Remove obligation: ${o.obligation}`} onClick={() => drop.mutate(o.id)}><X aria-hidden /></IconButton>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-[8px]">
          <div className="min-w-[12rem] flex-1">
            <FormField label="New obligation"><TextInput value={draft.obligation} onChange={(e) => setDraft({ ...draft, obligation: e.target.value })} placeholder="e.g. Report breaches to us within 24 hours" /></FormField>
          </div>
          <div className="w-[140px]">
            <FormField label="Control reference" optional><TextInput value={draft.control_ref} onChange={(e) => setDraft({ ...draft, control_ref: e.target.value })} placeholder="Control ref" /></FormField>
          </div>
          <Button leftIcon={<Plus aria-hidden />} loading={add.isPending} disabled={draft.obligation.trim().length < 3} onClick={() => add.mutate()}>Add</Button>
        </div>
      )}
    </div>
  );
}

// ── what has changed ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function History({ rows }: { rows: HistoryRow[] }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
      {rows.map((h) => (
        <li key={h.id}>
          <p className="text-ds-body text-ds-fg">{describe(h)}</p>
          <p className={`text-ds-label ${MUTED}`}>{formatDate(h.at)} · {h.by || 'System'}{h.reason && h.action !== 'attach_file' && <> · “{h.reason}”</>}</p>
        </li>
      ))}
    </ol>
  );
}

// ── act on a contract ────────────────────────────────────────────────────────────────────────────────────────────────────

export function RenewDialog({ contract, onClose }: { contract: ContractRow; onClose: () => void }) {
  const qc = useQueryClient();
  const uid = useId();
  const [dates, setDates] = useState(nextTerm(contract));
  const [value, setValue] = useState(text(contract.annual_value));
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const save = useReportedMutation({
    mutationFn: () => vendorContractsApi.renew(contract.id, {
      renewal_date: contract.renewal_date ? dates.renewal_date || undefined : undefined,
      expiry_date: contract.expiry_date ? dates.expiry_date || undefined : undefined,
      annual_value: value.trim() && Number(value) !== contract.annual_value ? Number(value) : undefined,
      note: note.trim() || undefined,
    }),
    success: 'Renewal recorded',
    failure: "Couldn't record the renewal",
    toast: 'success',
    retryable: false,
    onSuccess: () => { refreshContracts(qc); onClose(); },
    onError: setProblem,
  });
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title="Record a renewal"
      subtitle={`${contract.vendor.name} · ${contract.title || contract.type_label}`}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-renew`} variant="primary" loading={save.isPending}>Record renewal</Button>
        </div>
      )}
    >
      <form id={`${uid}-renew`} className="flex flex-col gap-[12px] px-[20px] py-[16px]" onSubmit={(e) => { e.preventDefault(); setProblem(null); save.mutate(); }}>
        <FormError title="Couldn't record the renewal" error={problem} />
        <div className="grid gap-[12px] sm:grid-cols-2">
          {contract.renewal_date && <FormField label="Next renewal date" required><TextInput type="date" required value={dates.renewal_date} onChange={(e) => setDates({ ...dates, renewal_date: e.target.value })} /></FormField>}
          {contract.expiry_date && <FormField label="New end date" required><TextInput type="date" required value={dates.expiry_date} onChange={(e) => setDates({ ...dates, expiry_date: e.target.value })} /></FormField>}
          <FormField label={`Value per year${contract.currency ? ` (${contract.currency})` : ''}`} hint={contract.annual_value !== null ? `Was ${money(contract.annual_value, contract.currency)}` : undefined}>
            <TextInput type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Note" optional><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was agreed, e.g. a price change or new terms" /></FormField>
      </form>
    </AnimatedModal>
  );
}

export function CloseOutDialog({ contract, onClose }: { contract: ContractRow; onClose: () => void }) {
  const qc = useQueryClient();
  const uid = useId();
  const [how, setHow] = useState<'expired' | 'terminated'>('expired');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const save = useReportedMutation({
    mutationFn: () => vendorContractsApi.update(contract.id, { status: how, reason: reason.trim(), row_version: contract.row_version }),
    success: 'Contract closed out',
    failure: "Couldn't close out the contract",
    toast: 'success',
    retryable: false,
    onSuccess: () => { refreshContracts(qc); onClose(); },
    onError: setProblem,
  });
  const choices = [['expired', 'It ran its course', 'The term ended and was not renewed.'], ['terminated', 'It was ended early', 'Either side gave notice or it was terminated.']] as const;
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title="Close out this contract"
      subtitle={`${contract.vendor.name} · ${contract.title || contract.type_label}. It leaves the inbox and stops reminding anyone.`}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-close`} variant="primary" loading={save.isPending} disabled={reason.trim().length < 5}>Close out</Button>
        </div>
      )}
    >
      <form id={`${uid}-close`} className="flex flex-col gap-[12px] px-[20px] py-[16px]" onSubmit={(e) => { e.preventDefault(); setProblem(null); save.mutate(); }}>
        <FormError title="Couldn't close out the contract" error={problem} />
        <div className="flex flex-col gap-[8px]" role="radiogroup" aria-label="How it ended">
          {choices.map(([k, label, help]) => (
            <label key={k} className={`flex cursor-pointer gap-[12px] rounded-ds-card border px-[12px] py-[8px] ${how === k ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border'}`}>
              <input type="radio" name={`${uid}-how`} checked={how === k} onChange={() => setHow(k)} className="mt-[3px] accent-ds-primary" />
              <span><span className="block text-ds-body font-[600] text-ds-fg">{label}</span><span className={`text-ds-label ${MUTED}`}>{help}</span></span>
            </label>
          ))}
        </div>
        <FormField label="Why" required hint="At least 5 characters."><Textarea rows={2} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Replaced by a new supplier; service no longer needed" /></FormField>
      </form>
    </AnimatedModal>
  );
}

/** Asked before a contract is deleted: its history stays in the audit trail. */
export function useDeleteContract(onDeleted: () => void) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const remove = useReportedMutation({
    mutationFn: (id: number) => vendorContractsApi.remove(id),
    success: 'Contract deleted',
    failure: "Couldn't delete the contract",
    onSuccess: () => { refreshContracts(qc); onDeleted(); },
  });
  const ask = async (id: number, name: string) => {
    const yes = await confirm({ title: 'Delete this contract?', message: `${name} is deleted. Its history stays in the audit trail.`, confirmLabel: 'Delete contract', tone: 'danger' });
    if (yes) remove.mutate(id);
  };
  return { ask, deleting: remove.isPending, confirmDialog };
}

