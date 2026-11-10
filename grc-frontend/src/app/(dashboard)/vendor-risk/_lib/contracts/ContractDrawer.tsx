'use client';

// One contract and everything about it: its dates and how it renews, what it costs, the signed copy (the AI can read the terms back out of it), the obligations it binds the supplier to,
// and what has changed. Used by the Contracts page and by the contracting stage on a vendor. On the kit: one sheet from the right (a bottom sheet on a phone), kit fields, "Discard changes?"
// for typed input, a confirmation before a delete, every change reported with a Retry. The form and the payload are contractForm.ts (pure, tested); props and exports are as they were.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileUp, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Button, Disclosure, ErrorState, FormField, SectionCard, Select, Sheet, Skeleton, StatusPill, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { contractState } from '@/lib/statuses/vendorRegister';
import { vendorContractsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';
import { paperworkApi } from '../paperworkApi';
import { engagementsApi, engagementsKey, type EngagementList } from '../engagementsApi';
import { useUnsavedGuard } from '../../vendors/[id]/_tpra/useUnsavedGuard';
import { EMPTY, PRICE_KEYS, PRICE_LABEL, applySuggestions, changedPayload, noticeBy, split, toForm, toPayload, type Form } from './contractForm';
import { CloseOutDialog, History, Obligations, RenewDialog, VendorPicker, refreshContracts, useDeleteContract } from './ContractParts';
import { BREACH_TIP, CLAUSES, CONTRACT_TYPES, FIELD_LABEL, RENEWAL_LABEL, STATUS_LABEL, countdown, type ContractDetail, type RenewalType } from './shared';

export { CloseOutDialog, RenewDialog, refreshContracts };

const FILE_ACCEPT = '.pdf,.docx,.txt,.rtf,.png,.jpg,.jpeg,.tif,.tiff';
const MUTED = 'text-ds-fg-muted';
const GRID = 'grid gap-[12px] sm:grid-cols-2';
const GRID3 = 'grid gap-[12px] sm:grid-cols-3';
const day = (v?: string | null) => formatDate(v, { calendar: true });

export default function ContractDrawer({ contractId, vendorId, assessmentId, onClose }: {
  contractId: number | null; vendorId?: number; assessmentId?: number; onClose: () => void;
}) {
  const qc = useQueryClient();
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

  const detail = useQuery<ContractDetail>({
    queryKey: ['tprm-contract', id],
    queryFn: async () => (await vendorContractsApi.get(id as number)).data,
    enabled: !!id,
  });
  const data = detail.data;
  useEffect(() => {
    if (data) { const f = toForm(data); setForm(f); setInitial(f); }
  }, [data]);

  const changed = useMemo(() => changedPayload(form, initial), [form, initial]);
  const dirty = Object.keys(changed).length > 0;
  useUnsavedGuard(dirty);
  const editable = id ? canEdit : canCreate;
  const owner = vendorId ?? data?.vendor.id ?? pickedVendor?.id;
  // What it can apply to: the whole supplier, or one of its engagements (an ended one only if it already does).
  const { data: engaged } = useQuery<EngagementList>({
    queryKey: engagementsKey(owner ?? 0),
    queryFn: async () => (await engagementsApi.list(owner as number)).data,
    enabled: !!owner,
  });
  const uses = (engaged?.items || []).filter((e) => !e.is_general && e.id && (e.status !== 'ended' || String(e.id) === form.engagement_id));

  const save = useReportedMutation({
    mutationFn: async () => {
      if (id) {
        const { clauses, terms } = split(changed);
        // The clauses first: saving them leaves the row version alone, so the terms follow with it.
        if (Object.keys(clauses).length) await paperworkApi.setClauses(id, clauses);
        if (Object.keys(terms).length) return (await vendorContractsApi.update(id, { ...terms, row_version: data?.row_version })).data;
        return { id };
      }
      return (await vendorContractsApi.create(owner as number, { ...split(toPayload(form)).terms, assessment_id: assessmentId })).data;
    },
    success: () => (id ? 'Contract saved' : { title: 'Contract added', message: 'Attach the signed copy below.' }),
    failure: "Couldn't save the contract",
    retryable: false,
    onSuccess: (saved: { id: number }) => {
      refreshContracts(qc);
      setAiKeys(new Set());
      setSkipped([]);
      if (!id) setId(saved.id);
    },
  });
  const { ask, deleting, confirmDialog } = useDeleteContract(onClose);
  const attach = useReportedMutation({
    mutationFn: (file: File) => vendorContractsApi.attachFile(id as number, file),
    success: 'Signed copy attached',
    failure: "Couldn't attach the signed copy",
    onSuccess: () => refreshContracts(qc),
  });
  const read = useReportedMutation({
    mutationFn: async () => (await vendorContractsApi.readTerms(id as number)).data as { suggested: Record<string, unknown>; skipped: string[] },
    success: ({ suggested }) => {
      const { keys } = applySuggestions(form, suggested);
      return keys.length ? { title: `AI filled ${keys.length} field${keys.length === 1 ? '' : 's'}`, message: 'Check them, then save.' } : 'The AI found no commercial terms in this file';
    },
    failure: "The AI couldn't read the signed copy",
    onSuccess: ({ suggested, skipped: missed }) => {
      const out = applySuggestions(form, suggested);
      setForm(out.form);
      setAiKeys(new Set(out.keys));
      setSkipped(missed);
    },
  });

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const ai = (key: string) => aiKeys.has(key);
  /** A label that says when the AI filled the field. */
  const lab = (label: string, key: string): ReactNode => (ai(key) ? <span className="inline-flex items-center gap-[6px]">{label}<StatusPill size="sm" tone="progress" label="AI" /></span> : label);
  const by = noticeBy(form);
  const title = id ? (data?.title || data?.type_label || 'Contract') : 'New contract';
  const pricingOpen = PRICE_KEYS.some((k) => form[k]) || !!form.uplift;

  return (
    <Sheet
      open
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words">{title}</span>}
      subtitle={data?.vendor.name || pickedVendor?.name}
      width="lg"
      dirty={dirty && editable}
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-[8px]">
          <div>
            {id && canDelete && <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={deleting} onClick={() => { void ask(id, title); }}>Delete</Button>}
          </div>
          <div className="flex gap-[8px]">
            <Button onClick={onClose}>{dirty ? 'Cancel' : 'Close'}</Button>
            {editable && <Button type="submit" form={`${uid}-form`} variant="primary" loading={save.isPending} disabled={!dirty || (!id && !owner)}>{id ? 'Save changes' : 'Add contract'}</Button>}
          </div>
        </div>
      )}
    >
      {id && detail.isLoading ? (
        <div aria-busy="true" className="flex flex-col gap-[12px]"><Skeleton className="h-[56px] w-full" /><Skeleton className="h-[160px] w-full" /><Skeleton className="h-[120px] w-full" /></div>
      ) : id && detail.isError && !data ? (
        <ErrorState title="Couldn't load the contract" onRetry={() => { void detail.refetch(); }} />
      ) : (
        <form id={`${uid}-form`} className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (dirty) save.mutate(); }}>
          {data && (
            <div className="flex flex-wrap items-center gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
              <StatusPill size="sm" {...statusPill(contractState, data.state)} />
              <div className={`min-w-0 flex-1 text-ds-label ${MUTED}`}>
                <p>{countdown(data) || (data.ends_on ? `Runs to ${day(data.ends_on)}` : 'No end date')}</p>
                {data.act_by && data.act_by !== data.ends_on && <p>Notice by {day(data.act_by)} · {data.renewal_type === 'auto' ? 'renews' : 'ends'} {day(data.ends_on)}</p>}
              </div>
              <Button size="sm" variant="link" href={`/vendor-risk/vendors/${data.vendor.id}?stage=contracting`} rightIcon={<ExternalLink aria-hidden />}>Supplier</Button>
              {canEdit && data.status === 'active' && data.ends_on && <Button size="sm" leftIcon={<RefreshCw aria-hidden />} onClick={() => setRenewing(true)}>Record renewal</Button>}
              {canEdit && data.status === 'active' && <Button size="sm" onClick={() => setClosing(true)}>Close out</Button>}
            </div>
          )}

          {!id && !vendorId && <VendorPicker value={pickedVendor} onChange={setPickedVendor} />}

          {aiKeys.size > 0 && (
            <div role="status" className="flex items-start gap-[8px] rounded-ds-card border border-ds-border bg-ds-primary-soft px-[12px] py-[8px] text-ds-label text-ds-fg-body">
              <Sparkles aria-hidden className="mt-[2px] h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />
              <p className="text-ds-label text-ds-fg-body">The AI filled the fields marked AI from the signed copy. Check them against the contract, then save.
                {skipped.length > 0 && <> It could not read: {skipped.map((k) => FIELD_LABEL[k] || k).join(', ')}.</>}</p>
            </div>
          )}

          <SectionCard id="agreement" title="Agreement">
            <div className={GRID}>
              <FormField label={lab('Title', 'title')} required className="sm:col-span-2">
                <TextInput value={form.title} onChange={set('title')} disabled={!editable} placeholder="e.g. Master services agreement" />
              </FormField>
              <FormField label={lab('Type', 'contract_type')}>
                <Select value={form.contract_type} onChange={set('contract_type')} disabled={!editable}>
                  {Object.entries(CONTRACT_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
              </FormField>
              <FormField label="Status">
                <Select value={form.status} onChange={set('status')} disabled={!editable}>
                  {Object.entries(STATUS_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
              </FormField>
              {uses.length > 0 && (
                <FormField label="Applies to" info="The whole supplier, unless the contract covers one engagement only." className="sm:col-span-2">
                  <Select value={form.engagement_id} onChange={set('engagement_id')} disabled={!editable}>
                    <option value="">Whole supplier</option>
                    {uses.map((e) => <option key={e.id} value={String(e.id)}>{e.name}{e.status === 'ended' ? ' (ended)' : ''}</option>)}
                  </Select>
                </FormField>
              )}
              <FormField label={lab('Reference', 'reference')} hint="Contract, order or purchase-order number">
                <TextInput value={form.reference} onChange={set('reference')} disabled={!editable} />
              </FormField>
              <FormField label={lab('Where it is held', 'record_link')} hint="A link to the contract system, if there is one">
                <TextInput type="url" value={form.record_link} onChange={set('record_link')} disabled={!editable} placeholder="https://" />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard id="dates" title="Dates and renewal">
            <div className={GRID3}>
              {([['effective_date', 'Starts'], ['renewal_date', 'Renews'], ['expiry_date', 'Ends']] as const).map(([k, label]) => (
                <FormField key={k} label={lab(label, k)}><TextInput type="date" value={form[k]} onChange={set(k)} disabled={!editable} /></FormField>
              ))}
              <FormField label={lab('How it renews', 'renewal_type')}>
                <Select value={form.renewal_type} onChange={set('renewal_type')} disabled={!editable}>
                  <option value="">Not stated</option>
                  {(Object.keys(RENEWAL_LABEL) as RenewalType[]).map((k) => <option key={k} value={k}>{RENEWAL_LABEL[k]}</option>)}
                </Select>
              </FormField>
              <FormField label={lab('Notice needed (days)', 'notice_days')} className="sm:col-span-2"
                hint={by ? `Last day to give notice: ${day(by)}` : 'Add a renewal or end date to see the last day to give notice.'}>
                <TextInput type="number" min={0} max={3650} value={form.notice_days} onChange={set('notice_days')} disabled={!editable} />
              </FormField>
            </div>
          </SectionCard>

          <SectionCard id="money" title="Money">
            <div className="flex flex-col gap-[12px]">
              <div className={GRID3}>
                <FormField label={lab('Value per year', 'annual_value')}><TextInput type="number" min={0} step="0.01" value={form.annual_value} onChange={set('annual_value')} disabled={!editable} /></FormField>
                <FormField label={lab('Currency', 'currency')}><TextInput maxLength={3} className="uppercase" value={form.currency} onChange={set('currency')} disabled={!editable} placeholder="USD" /></FormField>
                <FormField label={lab('Billed', 'billing')}>
                  <Select value={form.billing} onChange={set('billing')} disabled={!editable}>
                    <option value="">Not stated</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option>
                  </Select>
                </FormField>
              </div>
              <Disclosure label="Pricing detail" level={3} defaultOpen={pricingOpen}>
                <div className={`${GRID3} pt-[4px]`}>
                  {PRICE_KEYS.map((k) => (
                    <FormField key={k} label={lab(PRICE_LABEL[k], k)}><TextInput type="number" min={0} step={k === 'included_units' ? 1 : 0.01} value={form[k]} onChange={set(k)} disabled={!editable} /></FormField>
                  ))}
                  <FormField label={lab('Price rises at renewal', 'uplift')}>
                    <Select value={form.uplift} onChange={set('uplift')} disabled={!editable}>
                      <option value="">Not stated</option><option value="yes">Yes</option><option value="no">No</option>
                    </Select>
                  </FormField>
                </div>
              </Disclosure>
            </div>
          </SectionCard>

          <SectionCard id="exit" title="Getting out">
            <div className="flex flex-col gap-[12px]">
              <FormField label={lab('Termination rights', 'termination')}><Textarea rows={2} value={form.termination} onChange={set('termination')} disabled={!editable} placeholder="How either side can end it, and the notice needed" /></FormField>
              <FormField label="Notes" optional><Textarea rows={2} value={form.terms} onChange={set('terms')} disabled={!editable} /></FormField>
            </div>
          </SectionCard>

          {id && data && (
            <SectionCard id="clauses" title="Clauses">
              <div className={GRID}>
                {CLAUSES.map(({ key, label, tip }) => (
                  <FormField key={key} label={label} info={tip}>
                    <Select value={form[key]} onChange={set(key)} disabled={!editable}>
                      <option value="">Not checked</option><option value="yes">Yes</option><option value="no">No</option>
                    </Select>
                  </FormField>
                ))}
                <FormField label="Breach notice (hours)" info={BREACH_TIP}>
                  <TextInput type="number" min={0} max={8760} value={form.breach_notification_hours} onChange={set('breach_notification_hours')} disabled={!editable} />
                </FormField>
              </div>
            </SectionCard>
          )}

          {id && data && (
            <SectionCard id="signed-copy" title="Signed copy" actions={canEdit && data.file ? <Button leftIcon={<Sparkles aria-hidden />} loading={read.isPending} onClick={() => read.mutate()}>{read.isPending ? 'Reading…' : 'Read the terms with AI'}</Button> : undefined}>
              <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Signed copy of the contract"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate(f); e.target.value = ''; }} />
              {data.file ? (
                <div className="flex flex-wrap items-center gap-[12px] rounded-ds-card border border-ds-border px-[12px] py-[8px]">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{data.file.name}</p>
                    <p className={`text-ds-label ${MUTED}`}>Added {formatDate(data.file.uploaded_at)} · kept in the evidence library</p>
                  </div>
                  <EvidencePreviewButton evidenceId={data.file.evidence_id} label="View" />
                  {canEdit && <Button size="sm" loading={attach.isPending} onClick={() => fileRef.current?.click()}>Replace</Button>}
                </div>
              ) : canEdit ? (
                <button type="button" disabled={attach.isPending} onClick={() => fileRef.current?.click()}
                  className="flex min-h-ds-control w-full flex-col items-center gap-[4px] rounded-ds-card border border-dashed border-ds-border-strong px-[16px] py-[20px] text-ds-body text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring disabled:opacity-60">
                  <FileUp aria-hidden className="h-[20px] w-[20px] text-ds-fg-muted" strokeWidth={1.75} />
                  Attach the signed copy
                  <span className={`text-ds-label ${MUTED}`}>PDF, Word, text or a scan, up to 25 MB. The AI can then read its terms.</span>
                </button>
              ) : <p className={`text-ds-body ${MUTED}`}>No signed copy attached.</p>}
            </SectionCard>
          )}

          {id && data && <SectionCard id="obligations" title="What it binds the supplier to"><Obligations contract={data} canEdit={canEdit} /></SectionCard>}
          {id && data && data.history.length > 0 && <SectionCard id="history" title="History"><History rows={data.history} /></SectionCard>}
        </form>
      )}
      {renewing && data && <RenewDialog contract={data} onClose={() => setRenewing(false)} />}
      {closing && data && <CloseOutDialog contract={data} onClose={() => setClosing(false)} />}
      {confirmDialog}
    </Sheet>
  );
}
