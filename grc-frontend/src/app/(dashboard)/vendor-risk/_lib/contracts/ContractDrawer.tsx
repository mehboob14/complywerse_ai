'use client';

// One contract and everything about it: its dates and how it renews, what it
// costs, the signed copy (the AI can read the terms back out of it), the
// obligations it binds the supplier to, and what has changed. Used by the
// Contracts page and by the contracting stage on a vendor.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ExternalLink, FileUp, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { tpraApi, vendorContractsApi, vendorRiskApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';
import { fmtDate } from '../tprmShared';
import { errText } from '../intake/types';
import { useUnsavedGuard } from '../../vendors/[id]/_tpra/useUnsavedGuard';
import {
  CONTRACT_TYPES, FIELD_LABEL, OBLIGATION_STATUS, RENEWAL_LABEL, STATE_META, STATUS_LABEL,
  countdown, money, nextTerm, type ContractDetail, type ContractRow, type HistoryRow, type RenewalType,
} from './shared';

const PRICE_KEYS = ['unit_price', 'included_units', 'overage_price', 'one_time_fees', 'price_cap_pct'] as const;
const PRICE_LABEL: Record<(typeof PRICE_KEYS)[number], string> = {
  unit_price: 'Price per unit or seat', included_units: 'Units included', overage_price: 'Price per extra unit',
  one_time_fees: 'One-off fees', price_cap_pct: 'Cap on yearly price rises (%)',
};
const FILE_ACCEPT = '.pdf,.docx,.txt,.rtf,.png,.jpg,.jpeg,.tif,.tiff';

type Form = {
  title: string; contract_type: string; status: string; reference: string; record_link: string;
  effective_date: string; renewal_date: string; expiry_date: string; renewal_type: string; notice_days: string;
  annual_value: string; currency: string; billing: string; termination: string; terms: string;
  unit_price: string; included_units: string; overage_price: string; one_time_fees: string; price_cap_pct: string;
  uplift: '' | 'yes' | 'no';
};

const EMPTY: Form = {
  title: '', contract_type: 'master', status: 'active', reference: '', record_link: '', effective_date: '',
  renewal_date: '', expiry_date: '', renewal_type: '', notice_days: '', annual_value: '', currency: '', billing: '',
  termination: '', terms: '', unit_price: '', included_units: '', overage_price: '', one_time_fees: '',
  price_cap_pct: '', uplift: '',
};

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function toForm(c: ContractRow): Form {
  const p = c.pricing || {};
  return {
    title: text(c.title), contract_type: c.contract_type || 'master', status: c.status || 'draft',
    reference: text(c.reference), record_link: text(c.record_link), effective_date: text(c.effective_date).slice(0, 10),
    renewal_date: text(c.renewal_date).slice(0, 10), expiry_date: text(c.expiry_date).slice(0, 10),
    renewal_type: text(c.renewal_type), notice_days: text(c.notice_days), annual_value: text(c.annual_value),
    currency: text(c.currency), billing: text(c.billing), termination: text(c.termination), terms: text(c.terms),
    unit_price: text(p.unit_price), included_units: text(p.included_units), overage_price: text(p.overage_price),
    one_time_fees: text(p.one_time_fees), price_cap_pct: text(p.price_cap_pct),
    uplift: p.uplift === undefined ? '' : p.uplift ? 'yes' : 'no',
  };
}

function toPayload(f: Form): Record<string, unknown> {
  const t = (v: string) => (v.trim() ? v.trim() : null);
  const n = (v: string) => (v.trim() ? Number(v) : null);
  const pricing: Record<string, unknown> = {};
  PRICE_KEYS.forEach((k) => { if (f[k].trim()) pricing[k] = Number(f[k]); });
  if (f.uplift) pricing.uplift = f.uplift === 'yes';
  return {
    title: t(f.title), contract_type: f.contract_type, status: f.status, reference: t(f.reference),
    record_link: t(f.record_link), effective_date: t(f.effective_date), renewal_date: t(f.renewal_date),
    expiry_date: t(f.expiry_date), renewal_type: t(f.renewal_type), notice_days: n(f.notice_days),
    annual_value: n(f.annual_value), currency: t(f.currency.toUpperCase()), billing: t(f.billing),
    termination: t(f.termination), terms: t(f.terms), pricing: Object.keys(pricing).length ? pricing : null,
  };
}

/** The last day to give notice, as the form currently has it. */
function noticeBy(f: Form): string | null {
  const ends = [f.renewal_date, f.expiry_date].filter(Boolean).sort()[0];
  if (!ends) return null;
  const d = new Date(ends);
  d.setDate(d.getDate() - (Number(f.notice_days) || 0));
  return d.toISOString().slice(0, 10);
}

export function refreshContracts(qc: QueryClient) {
  qc.invalidateQueries({ predicate: (q) => ['tprm-contracts', 'tprm-contract', 'tpra-lifecycle', 'tpra-contracts']
    .includes(String(q.queryKey[0])) });
}

const inputCls = (ai = false) => clsx(
  'w-full rounded-lg border px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50',
  ai ? 'border-violet-300 bg-violet-50/50' : 'border-slate-300 bg-white');

function Field({ id, label, ai, hint, children, className }: {
  id?: string; label: string; ai?: boolean; hint?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
        {label}
        {ai && <span className="rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-700" title="Filled in by AI">AI</span>}
      </label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function ContractDrawer({ contractId, vendorId, assessmentId, onClose }: {
  contractId: number | null; vendorId?: number; assessmentId?: number; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:contracts:edit') || hasPermission('erm:risks:edit');
  const canCreate = hasPermission('vendor_risk:contracts:create') || canEdit;
  const canDelete = hasPermission('vendor_risk:contracts:delete') || canEdit;
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [id, setId] = useState<number | null>(contractId);
  const [pickedVendor, setPickedVendor] = useState<{ id: number; name: string } | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [initial, setInitial] = useState<Form>(EMPTY);
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<string[]>([]);
  const [renewing, setRenewing] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data, isLoading } = useQuery<ContractDetail>({
    queryKey: ['tprm-contract', id],
    queryFn: async () => (await vendorContractsApi.get(id as number)).data,
    enabled: !!id,
  });
  useEffect(() => {
    if (data) { const f = toForm(data); setForm(f); setInitial(f); }
  }, [data]);

  const changed = useMemo(() => {
    const now = toPayload(form);
    const before = toPayload(initial);
    return Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])));
  }, [form, initial]);
  const dirty = Object.keys(changed).length > 0;
  useUnsavedGuard(dirty);
  const editable = id ? canEdit : canCreate;
  const owner = vendorId ?? data?.vendor.id ?? pickedVendor?.id;

  const save = useMutation({
    mutationFn: async () => {
      if (id) return (await vendorContractsApi.update(id, { ...changed, row_version: data?.row_version })).data;
      return (await vendorContractsApi.create(owner as number, { ...toPayload(form), assessment_id: assessmentId })).data;
    },
    onSuccess: (saved: { id: number }) => {
      refreshContracts(qc);
      setAiKeys(new Set());
      setSkipped([]);
      if (!id) {
        setId(saved.id);
        toast({ type: 'success', title: 'Contract added', message: 'Attach the signed copy below.' });
      } else {
        toast({ type: 'success', title: 'Contract saved' });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') }),
  });
  const remove = useMutation({
    mutationFn: () => vendorContractsApi.remove(id as number),
    onSuccess: () => { refreshContracts(qc); toast({ type: 'success', title: 'Contract deleted' }); onClose(); },
    onError: (e) => toast({ type: 'error', title: 'Not deleted', message: errText(e, 'Try again.') }),
  });
  const attach = useMutation({
    mutationFn: (file: File) => vendorContractsApi.attachFile(id as number, file),
    onSuccess: () => { refreshContracts(qc); toast({ type: 'success', title: 'Signed copy attached' }); },
    onError: (e) => toast({ type: 'error', title: 'Not attached', message: errText(e, 'Try again.') }),
  });
  const read = useMutation({
    mutationFn: async () => (await vendorContractsApi.readTerms(id as number)).data as {
      suggested: Record<string, unknown>; skipped: string[];
    },
    onSuccess: ({ suggested, skipped: missed }) => {
      const next = { ...form };
      const bag = next as unknown as Record<string, string>;
      const keys = new Set<string>();
      Object.entries(suggested).forEach(([k, v]) => {
        if (k === 'pricing' && v && typeof v === 'object') {
          Object.entries(v as Record<string, unknown>).forEach(([pk, pv]) => {
            if (pk === 'uplift') next.uplift = pv ? 'yes' : 'no';
            else if (pk in bag) bag[pk] = String(pv);
            keys.add(pk);
          });
        } else if (k in bag) {
          bag[k] = String(v);
          keys.add(k);
        }
      });
      setForm(next);
      setAiKeys(keys);
      setSkipped(missed);
      toast(keys.size ? { type: 'success', title: `AI filled ${keys.size} field${keys.size === 1 ? '' : 's'}`, message: 'Check them, then save.' }
        : { type: 'info', title: 'The AI found no commercial terms in this file' });
    },
    onError: (e) => toast({ type: 'error', title: 'The AI could not read it', message: errText(e, 'Try again.') }),
  });

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const ai = (key: string) => aiKeys.has(key);
  const fid = (key: string) => `${uid}-${key}`;
  const by = noticeBy(form);
  const title = id ? (data?.title || data?.type_label || 'Contract') : 'New contract';

  return (
    <RightSlidePanel isOpen onClose={onClose} title={title} subtitle={data?.vendor.name || pickedVendor?.name}
      width="w-full max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div>
            {id && canDelete && (
              <button type="button" onClick={() => { if (window.confirm('Delete this contract? Its history stays in the audit trail.')) remove.mutate(); }}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-rose-700 hover:bg-rose-50">
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              {dirty ? 'Cancel' : 'Close'}
            </button>
            {editable && (
              <button type="submit" form={`${uid}-form`} disabled={!dirty || save.isPending || (!id && !owner)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {id ? 'Save changes' : 'Add contract'}
              </button>
            )}
          </div>
        </div>
      }>
      {id && isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <form id={`${uid}-form`} className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (dirty) save.mutate(); }}>
          {data && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className={clsx('rounded-full border px-2 py-0.5 text-xs font-medium', STATE_META[data.state].cls)}>{STATE_META[data.state].label}</span>
              <div className="min-w-0 flex-1 text-xs text-slate-600">
                <p>{countdown(data) || (data.ends_on ? `Runs to ${fmtDate(data.ends_on)}` : 'No end date')}</p>
                {data.act_by && data.act_by !== data.ends_on && <p className="text-slate-400">Notice by {fmtDate(data.act_by)} · {data.renewal_type === 'auto' ? 'renews' : 'ends'} {fmtDate(data.ends_on)}</p>}
              </div>
              <Link href={`/vendor-risk/vendors/${data.vendor.id}?stage=contracting`} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
                Supplier <ExternalLink className="h-3 w-3" />
              </Link>
              {canEdit && data.status === 'active' && data.ends_on && (
                <button type="button" onClick={() => setRenewing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                  <RefreshCw className="h-3.5 w-3.5" /> Record renewal
                </button>
              )}
              {canEdit && data.status === 'active' && (
                <button type="button" onClick={() => setClosing(true)}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                  Close out
                </button>
              )}
            </div>
          )}

          {!id && !vendorId && <VendorPicker value={pickedVendor} onChange={setPickedVendor} />}

          {aiKeys.size > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>The AI filled the fields marked <b>AI</b> from the signed copy. Check them against the contract, then save.
                {skipped.length > 0 && <> It could not read: {skipped.map((k) => FIELD_LABEL[k] || k).join(', ')}.</>}</p>
            </div>
          )}

          <Section title="Agreement">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={fid('title')} label="Title" ai={ai('title')} className="sm:col-span-2">
                <input id={fid('title')} className={inputCls(ai('title'))} value={form.title} onChange={set('title')} disabled={!editable}
                  required placeholder="e.g. Master services agreement" />
              </Field>
              <Field id={fid('type')} label="Type" ai={ai('contract_type')}>
                <select id={fid('type')} className={inputCls(ai('contract_type'))} value={form.contract_type} onChange={set('contract_type')} disabled={!editable}>
                  {Object.entries(CONTRACT_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field id={fid('status')} label="Status">
                <select id={fid('status')} className={inputCls()} value={form.status} onChange={set('status')} disabled={!editable}>
                  {Object.entries(STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              <Field id={fid('reference')} label="Reference" ai={ai('reference')} hint="Contract, order or purchase-order number">
                <input id={fid('reference')} className={inputCls(ai('reference'))} value={form.reference} onChange={set('reference')} disabled={!editable} />
              </Field>
              <Field id={fid('link')} label="Where it is held" ai={ai('record_link')} hint="A link to the contract system, if there is one">
                <input id={fid('link')} type="url" className={inputCls(ai('record_link'))} value={form.record_link} onChange={set('record_link')}
                  disabled={!editable} placeholder="https://" />
              </Field>
            </div>
          </Section>

          <Section title="Dates and renewal">
            <div className="grid gap-3 sm:grid-cols-3">
              {([['effective_date', 'Starts'], ['renewal_date', 'Renews'], ['expiry_date', 'Ends']] as const).map(([k, label]) => (
                <Field key={k} id={fid(k)} label={label} ai={ai(k)}>
                  <input id={fid(k)} type="date" className={inputCls(ai(k))} value={form[k]} onChange={set(k)} disabled={!editable} />
                </Field>
              ))}
              <Field id={fid('renewal_type')} label="How it renews" ai={ai('renewal_type')}>
                <select id={fid('renewal_type')} className={inputCls(ai('renewal_type'))} value={form.renewal_type} onChange={set('renewal_type')} disabled={!editable}>
                  <option value="">Not stated</option>
                  {(Object.keys(RENEWAL_LABEL) as RenewalType[]).map((k) => <option key={k} value={k}>{RENEWAL_LABEL[k]}</option>)}
                </select>
              </Field>
              <Field id={fid('notice')} label="Notice needed (days)" ai={ai('notice_days')} className="sm:col-span-2"
                hint={by ? <>Last day to give notice: <b className="text-slate-600">{fmtDate(by)}</b></> : 'Add a renewal or end date to see the last day to give notice.'}>
                <input id={fid('notice')} type="number" min={0} max={3650} className={inputCls(ai('notice_days'))} value={form.notice_days}
                  onChange={set('notice_days')} disabled={!editable} />
              </Field>
            </div>
          </Section>

          <Section title="Money">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id={fid('value')} label="Value per year" ai={ai('annual_value')}>
                <input id={fid('value')} type="number" min={0} step="0.01" className={inputCls(ai('annual_value'))} value={form.annual_value}
                  onChange={set('annual_value')} disabled={!editable} />
              </Field>
              <Field id={fid('currency')} label="Currency" ai={ai('currency')}>
                <input id={fid('currency')} maxLength={3} className={clsx(inputCls(ai('currency')), 'uppercase')} value={form.currency}
                  onChange={set('currency')} disabled={!editable} placeholder="USD" />
              </Field>
              <Field id={fid('billing')} label="Billed" ai={ai('billing')}>
                <select id={fid('billing')} className={inputCls(ai('billing'))} value={form.billing} onChange={set('billing')} disabled={!editable}>
                  <option value="">Not stated</option>
                  <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option>
                </select>
              </Field>
            </div>
            <details className="mt-3 group" open={PRICE_KEYS.some((k) => form[k]) || !!form.uplift}>
              <summary className="cursor-pointer text-xs font-medium text-primary-700">Pricing detail</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {PRICE_KEYS.map((k) => (
                  <Field key={k} id={fid(k)} label={PRICE_LABEL[k]} ai={ai(k)}>
                    <input id={fid(k)} type="number" min={0} step={k === 'included_units' ? 1 : 0.01} className={inputCls(ai(k))}
                      value={form[k]} onChange={set(k)} disabled={!editable} />
                  </Field>
                ))}
                <Field id={fid('uplift')} label="Price rises at renewal" ai={ai('uplift')}>
                  <select id={fid('uplift')} className={inputCls(ai('uplift'))} value={form.uplift} onChange={set('uplift')} disabled={!editable}>
                    <option value="">Not stated</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </Field>
              </div>
            </details>
          </Section>

          <Section title="Getting out">
            <Field id={fid('termination')} label="Termination rights" ai={ai('termination')}>
              <textarea id={fid('termination')} rows={2} className={inputCls(ai('termination'))} value={form.termination}
                onChange={set('termination')} disabled={!editable} placeholder="How either side can end it, and the notice needed" />
            </Field>
            <Field id={fid('terms')} label="Notes" className="mt-3">
              <textarea id={fid('terms')} rows={2} className={inputCls()} value={form.terms} onChange={set('terms')} disabled={!editable} />
            </Field>
          </Section>

          {id && data && (
            <Section title="Signed copy" aside={canEdit && data.file && (
              <button type="button" onClick={() => read.mutate()} disabled={read.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60">
                {read.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {read.isPending ? 'Reading…' : 'Read the terms with AI'}
              </button>
            )}>
              <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" aria-label="Signed copy of the contract"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate(f); e.target.value = ''; }} />
              {data.file ? (
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800">{data.file.name}</p>
                    <p className="text-[11px] text-slate-400">Added {fmtDate(data.file.uploaded_at)} · kept in the evidence library</p>
                  </div>
                  <EvidencePreviewButton evidenceId={data.file.evidence_id} label="View" />
                  {canEdit && (
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={attach.isPending}
                      className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Replace</button>
                  )}
                </div>
              ) : canEdit ? (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={attach.isPending}
                  className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-600 hover:bg-slate-50">
                  {attach.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5 text-slate-400" />}
                  Attach the signed copy
                  <span className="text-[11px] text-slate-400">PDF, Word, text or a scan, up to 25 MB. The AI can then read its terms.</span>
                </button>
              ) : <p className="text-sm text-slate-500">No signed copy attached.</p>}
            </Section>
          )}

          {id && data && <Obligations contract={data} canEdit={canEdit} />}
          {id && data && data.history.length > 0 && <History rows={data.history} />}
        </form>
      )}
      {renewing && data && <RenewDialog contract={data} onClose={() => setRenewing(false)} />}
      {closing && data && <CloseOutDialog contract={data} onClose={() => setClosing(false)} />}
    </RightSlidePanel>
  );
}

function VendorPicker({ value, onChange }: { value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['tprm-vendor-pick', q],
    queryFn: async () => (await vendorRiskApi.getVendors({ search: q || undefined, limit: 20 })).data as { items: Array<{ id: number; name: string }> },
    enabled: !value,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div><p className="text-xs text-slate-500">Supplier</p><p className="text-sm font-medium text-slate-900">{value.name}</p></div>
        <button type="button" onClick={() => onChange(null)} className="text-xs text-primary-700 hover:underline">Change</button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <label htmlFor="tprm-contract-vendor" className="mb-1 block text-xs font-medium text-slate-700">Which supplier is it with?</label>
      <input id="tprm-contract-vendor" className={inputCls()} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers" autoFocus />
      <div className="mt-2 max-h-48 overflow-y-auto">
        {isFetching && !data ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : (data?.items || []).map((v) => (
          <button key={v.id} type="button" onClick={() => onChange({ id: v.id, name: v.name })}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50">{v.name}</button>
        ))}
        {data && data.items.length === 0 && <p className="px-2 py-1.5 text-sm text-slate-500">No supplier matches.</p>}
      </div>
    </div>
  );
}

function Obligations({ contract, canEdit }: { contract: ContractDetail; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState({ obligation: '', control_ref: '' });
  const done = () => refreshContracts(qc);
  const fail = (e: unknown) => toast({ type: 'error', title: 'Not saved', message: errText(e, 'Try again.') });
  const add = useMutation({
    mutationFn: () => tpraApi.createObligation(contract.id, { obligation: draft.obligation.trim(), control_ref: draft.control_ref.trim() || undefined }),
    onSuccess: () => { setDraft({ obligation: '', control_ref: '' }); done(); }, onError: fail,
  });
  const update = useMutation({
    mutationFn: ({ id, status, row_version }: { id: number; status: string; row_version: number }) =>
      tpraApi.updateObligation(id, { status, row_version }),
    onSuccess: done, onError: fail,
  });
  const drop = useMutation({ mutationFn: (id: number) => tpraApi.deleteObligation(id), onSuccess: done, onError: fail });

  return (
    <Section title="What it binds the supplier to">
      {contract.obligations.length === 0 && <p className="mb-2 text-sm text-slate-500">No obligations recorded. Add the security and service commitments the contract makes.</p>}
      <ul className="space-y-1.5">
        {contract.obligations.map((o) => (
          <li key={o.id} className={clsx('flex items-center gap-2 rounded-lg border px-3 py-2', o.status === 'breached' ? 'border-rose-200 bg-rose-50' : 'border-slate-200')}>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">{o.obligation}</p>
              {o.control_ref && <p className="text-[11px] text-slate-400">{o.control_ref}</p>}
            </div>
            <select aria-label="Obligation status" value={o.status} disabled={!canEdit || update.isPending}
              onChange={(e) => update.mutate({ id: o.id, status: e.target.value, row_version: o.row_version })}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs capitalize">
              {OBLIGATION_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {canEdit && (
              <button type="button" aria-label="Remove obligation" onClick={() => drop.mutate(o.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <input aria-label="New obligation" className={clsx(inputCls(), 'min-w-[12rem] flex-1')} value={draft.obligation}
            onChange={(e) => setDraft({ ...draft, obligation: e.target.value })} placeholder="e.g. Report breaches to us within 24 hours" />
          <input aria-label="Control reference" className={clsx(inputCls(), 'w-36')} value={draft.control_ref}
            onChange={(e) => setDraft({ ...draft, control_ref: e.target.value })} placeholder="Control ref" />
          <button type="button" disabled={draft.obligation.trim().length < 3 || add.isPending} onClick={() => add.mutate()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      )}
    </Section>
  );
}

function shown(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key.endsWith('_date')) return fmtDate(String(value));
  if (key === 'status') return STATUS_LABEL[String(value)]?.split(' (')[0] || String(value);
  if (key === 'contract_type') return CONTRACT_TYPES[String(value)] || String(value);
  if (key === 'renewal_type') return RENEWAL_LABEL[value as RenewalType] || String(value);
  if (key === 'notice_days') return `${value} days`;
  if (typeof value === 'object') return 'updated';
  return String(value);
}

function describe(h: HistoryRow): string {
  if (h.entity === 'obligation') return `Obligation ${h.action === 'create' ? 'added' : h.action === 'delete' ? 'removed' : 'updated'}`;
  if (h.action === 'create') return 'Added';
  if (h.action === 'delete') return 'Deleted';
  if (h.action === 'attach_file') return `Signed copy attached${h.reason ? `: ${h.reason}` : ''}`;
  if (h.action === 'renew') return `Renewed: now runs to ${fmtDate(h.to_value)}${h.from_value ? ` (was ${fmtDate(h.from_value)})` : ''}`;
  const parts = Object.entries(h.changes || {}).map(([k, [a, b]]) =>
    k === 'terms' || k === 'termination' || k === 'pricing' ? FIELD_LABEL[k] || k : `${FIELD_LABEL[k] || k} ${shown(k, a)} → ${shown(k, b)}`);
  return parts.length ? `Changed ${parts.join('; ')}` : 'Updated';
}

function History({ rows }: { rows: HistoryRow[] }) {
  return (
    <Section title="History">
      <ol className="space-y-2">
        {rows.map((h) => (
          <li key={h.id} className="text-sm">
            <p className="text-slate-800">{describe(h)}</p>
            <p className="text-[11px] text-slate-400">{fmtDate(h.at)} · {h.by || 'System'}
              {h.reason && h.action !== 'attach_file' && <> · “{h.reason}”</>}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Dialog({ label, children, onClose }: { label: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={label}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">{children}</div>
    </div>
  );
}

export function RenewDialog({ contract, onClose }: { contract: ContractRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dates, setDates] = useState(nextTerm(contract));
  const [value, setValue] = useState(text(contract.annual_value));
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => vendorContractsApi.renew(contract.id, {
      renewal_date: contract.renewal_date ? dates.renewal_date || undefined : undefined,
      expiry_date: contract.expiry_date ? dates.expiry_date || undefined : undefined,
      annual_value: value.trim() && Number(value) !== contract.annual_value ? Number(value) : undefined,
      note: note.trim() || undefined,
    }),
    onSuccess: () => { refreshContracts(qc); toast({ type: 'success', title: 'Renewal recorded' }); onClose(); },
  });
  const input = inputCls();
  return (
    <Dialog label="Record a renewal" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Record a renewal</h2>
          <p className="text-xs text-slate-500">{contract.vendor.name} · {contract.title || contract.type_label}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {contract.renewal_date && (
            <Field id="renew-renewal" label="Next renewal date">
              <input id="renew-renewal" type="date" className={input} required value={dates.renewal_date}
                onChange={(e) => setDates({ ...dates, renewal_date: e.target.value })} />
            </Field>
          )}
          {contract.expiry_date && (
            <Field id="renew-end" label="New end date">
              <input id="renew-end" type="date" className={input} required value={dates.expiry_date}
                onChange={(e) => setDates({ ...dates, expiry_date: e.target.value })} />
            </Field>
          )}
          <Field id="renew-value" label={`Value per year${contract.currency ? ` (${contract.currency})` : ''}`}
            hint={contract.annual_value !== null ? `Was ${money(contract.annual_value, contract.currency)}` : undefined}>
            <input id="renew-value" type="number" min={0} step="0.01" className={input} value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
        </div>
        <Field id="renew-note" label="Note">
          <textarea id="renew-note" rows={2} className={input} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="What was agreed, e.g. a price change or new terms" />
        </Field>
        {save.isError && <p className="text-sm text-rose-700">{errText(save.error, 'Could not record the renewal')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Record renewal
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function CloseOutDialog({ contract, onClose }: { contract: ContractRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [how, setHow] = useState<'expired' | 'terminated'>('expired');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => vendorContractsApi.update(contract.id, { status: how, reason: reason.trim(), row_version: contract.row_version }),
    onSuccess: () => { refreshContracts(qc); toast({ type: 'success', title: 'Contract closed out' }); onClose(); },
  });
  return (
    <Dialog label="Close out a contract" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Close out this contract</h2>
          <p className="text-xs text-slate-500">{contract.vendor.name} · {contract.title || contract.type_label}. It leaves the inbox and stops reminding anyone.</p>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label="How it ended">
          {([['expired', 'It ran its course', 'The term ended and was not renewed.'],
            ['terminated', 'It was ended early', 'Either side gave notice or it was terminated.']] as const).map(([k, label, help]) => (
            <label key={k} className={clsx('flex cursor-pointer gap-3 rounded-lg border px-3 py-2', how === k ? 'border-primary-400 bg-primary-50' : 'border-slate-200')}>
              <input type="radio" name="closeout" checked={how === k} onChange={() => setHow(k)} className="mt-1" />
              <span><span className="block text-sm font-medium text-slate-800">{label}</span><span className="text-xs text-slate-500">{help}</span></span>
            </label>
          ))}
        </div>
        <Field id="close-reason" label="Why">
          <textarea id="close-reason" rows={2} className={inputCls()} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Replaced by a new supplier; service no longer needed" />
        </Field>
        {save.isError && <p className="text-sm text-rose-700">{errText(save.error, 'Could not close it out')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={save.isPending || reason.trim().length < 5}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Close out
          </button>
        </div>
      </form>
    </Dialog>
  );
}
