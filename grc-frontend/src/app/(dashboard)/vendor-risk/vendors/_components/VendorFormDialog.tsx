'use client';

// The add / edit vendor dialog (Verity's 1080px one): name with a live warning about a vendor we may already have, what the vendor
// does and where it sits on the left, who owns it on the right, and a "First engagement" when adding. What the old add and edit
// forms held stays, under "More details": description, tier and its reason, status, data access, contacts, contract, notes; and the
// tenant's own fields on their tab. The tenant's settings still rule: a field an admin hid is not asked, a list they set is offered.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import {
  CustomFieldsTab, CustomFieldsTabBar, builtinLabel, listOptions, showBuiltin, statusChoices, tabOf, useModuleSettings, valuesToSave,
  type CustomValues,
} from '@/components/settings/CustomFields';
import { BTN, BTN_PRIMARY, Dialog } from '../../_ui';
import { usePeople } from '../../_lib/actions/shared';
import { engagementsApi, engagementsKey } from '../../_lib/engagementsApi';
import { useDebounced, useDuplicates, useUnits } from '../../_lib/vendorRecordApi';
import { emptyForm, formFrom, problems, type VendorForm } from '../../_lib/vendorFormModel';
import { isTiered } from '../../_lib/vendorRecordModel';
import { addVendor, editVendor, type VendorCalls } from '../../_lib/vendorSave';
import DuplicateBox from '../../intake/_components/DuplicateBox';
import { AREA, FIELD, GROUP, HINT, LABEL } from './formStyles';

export type VendorFormDialogProps = {
  open: boolean;
  mode: 'add' | 'edit';
  /** The vendor being edited (mode 'edit'). */
  vendor?: Record<string, any>;
  onClose: () => void;
  /** Called with the saved vendor (as the API returns it) after a successful save. */
  onSaved?: (vendor: Record<string, any>) => void;
};

// The calls the save flow (_lib/vendorSave.ts) makes, as the server has them.
const CALLS: VendorCalls = {
  createVendor: async (body) => (await vendorRiskApi.createVendor(body)).data,
  updateVendor: async (id, body) => (await vendorRiskApi.updateVendor(id, body)).data,
  addEngagement: async (vendorId, name) => (await engagementsApi.create(vendorId, { name })).data.id ?? null,
  startLifecycle: (vendorId, engagementId) => tpraApi.initLifecycle(vendorId, engagementId),
};

const TIERS = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['active', 'under_review', 'onboarding', 'offboarded', 'suspended'];
const ACCESS = ['confidential', 'restricted', 'internal', 'public', 'none'];
const CLASSES = ['public', 'internal', 'confidential', 'restricted'];
const words = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function Field({ id, label, hint, tip, className, children }: { id: string; label: string; hint?: string; tip?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={LABEL}>
        {label}
        {hint && <> <span className={HINT}>({hint})</span></>}
        {tip && <InfoTip text={tip} label={`About ${label.toLowerCase()}`} className="ml-1" />}
      </label>
      {children}
    </div>
  );
}

/** One person's pick: Unassigned, or someone who signs in here. The one already on the record stays pickable. */
function PersonSelect({ id, value, onChange, people, current }: {
  id: string; value: string; onChange: (id: string) => void; people: Array<{ id: number; name: string }>; current?: { id: number; full_name: string } | null;
}) {
  const known = people.some((p) => String(p.id) === String(current?.id));
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
      <option value="">Unassigned</option>
      {current && !known && <option value={current.id}>{current.full_name}</option>}
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

export default function VendorFormDialog({ open, mode, vendor, onClose, onSaved }: VendorFormDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const fid = (key: string) => `${uid}-${key}`;
  const { data: settings } = useModuleSettings('vendors');
  const people = usePeople();
  const { data: units } = useUnits();

  // The form starts from the vendor it was mounted with and is made fresh each time the dialog opens (below).
  const [form, setForm] = useState<VendorForm>(() => (mode === 'edit' && vendor ? formFrom(vendor) : emptyForm()));
  const [was, setWas] = useState<VendorForm | null>(() => (mode === 'edit' && vendor ? formFrom(vendor) : null));
  const [first, setFirst] = useState('');
  const [startLifecycle, setStartLifecycle] = useState(true);
  const [custom, setCustom] = useState<CustomValues>(() => (mode === 'edit' ? (vendor?.custom_values ?? {}) : {}));
  const [tab, setTab] = useState<'details' | 'custom'>('details');
  const [error, setError] = useState<string | null>(null);
  const [retryAnyway, setRetryAnyway] = useState(false);

  // A fresh form each time the dialog opens (or opens on another vendor): a refetch of the vendor while it is open must not wipe typing.
  useEffect(() => {
    if (!open) return;
    const next = mode === 'edit' && vendor ? formFrom(vendor) : emptyForm();
    setForm(next);
    setWas(mode === 'edit' ? next : null);
    setFirst('');
    setStartLifecycle(true);
    setCustom(mode === 'edit' ? (vendor?.custom_values ?? {}) : {});
    setTab('details');
    setError(null);
    setRetryAnyway(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which vendor is open, not on every refetch of it
  }, [open, mode, vendor?.id]);

  const add = mode === 'add';
  const set = <K extends keyof VendorForm>(key: K, value: VendorForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const tiered = isTiered(vendor);
  const show = (key: string) => showBuiltin(settings, key);

  // The check waits for the typing to pause; only a new vendor is checked (editing a vendor does not make a second one).
  const name = useDebounced(form.name);
  const site = useDebounced(form.website);
  const matches = useDuplicates(add && open && form.name.trim() ? name : '', site).data ?? [];

  const save = useMutation({
    // The tenant's own fields go with the vendor, a new vendor's lifecycle starts when asked, an edit sends only what changed (vendorSave.ts).
    mutationFn: () => (!add && vendor
      ? editVendor(CALLS, vendor, { form, was: was as VendorForm, customValues: valuesToSave(settings, custom, vendor.custom_values) })
      : addVendor(CALLS, {
        form, customValues: valuesToSave(settings, custom), firstEngagement: first, startLifecycle,
        allowDuplicate: matches.length > 0 || retryAnyway,                       // it was warned about, and chose to add it
      })),
    onSuccess: ({ saved, note }) => {
      ['vendors', 'vendors-select', 'vendor-dashboard', 'vendor-assessments-all', 'tprm-vendor-duplicates'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ['vendor', saved.id] });
      qc.invalidateQueries({ queryKey: engagementsKey(saved.id) });
      toast(note ? { type: 'warning', title: add ? 'Vendor added' : 'Saved', message: note } : { type: 'success', title: add ? 'Vendor added' : 'Saved' });
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => {
      if ((e as { response?: { status?: number } })?.response?.status === 409) {
        setRetryAnyway(true);                                                    // a vendor with this name or website exists: the next try adds it
        qc.invalidateQueries({ queryKey: ['tprm-vendor-duplicates'] });
        setError(`${apiErrorText(e, 'It may already be on record.')} Add it again to keep it as a new vendor.`);
      } else {
        setError(apiErrorText(e, 'The vendor could not be saved. Check the form and try again.'));
      }
    },
  });

  const submit = () => {
    const found = problems(form, was, tiered);
    if (found.length) { setError(found.join(' ')); return; }
    setError(null);
    if (!save.isPending) save.mutate();
  };

  const typeOptions = listOptions(settings, 'vendor_type', form.vendor_type);
  const industryOptions = listOptions(settings, 'industry', form.industry);
  // The lifecycle moves the status (approval, reactivation): an edit keeps it, or takes the vendor out of use.
  const statusItems = statusChoices(settings, STATUSES.map((s) => ({ value: s, label: words(s) })))
    .filter((s) => s.value === was?.status || s.value === 'offboarded' || (s.value === 'suspended' && was?.status !== 'offboarded'));
  const tierChanged = !!was && form.tier !== was.tier;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={1080}
      title={add ? 'Add vendor' : 'Edit vendor'}
      description={add ? 'Tiering follows on the engagement.' : 'Tier and score come from the lifecycle.'}
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={fid('form')} disabled={save.isPending} className={BTN_PRIMARY}>
            {save.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {add ? 'Add vendor' : 'Save'}
          </button>
        </>
      )}
    >
      <form id={fid('form')} onSubmit={(e) => { e.preventDefault(); submit(); }} onInvalidCapture={(e) => setTab(tabOf(e.target))}>
        <CustomFieldsTabBar tab={tab} onTab={setTab} settings={settings} />

        <div data-tab="details" className={tab === 'details' ? 'space-y-4' : 'hidden'}>
          <div>
            <Field id={fid('name')} label="Name">
              <input id={fid('name')} data-autofocus required maxLength={255} value={form.name} placeholder="Acme Analytics" autoComplete="off"
                onChange={(e) => set('name', e.target.value)} className={FIELD} />
            </Field>
            {add && matches.length > 0 && (
              <DuplicateBox
                title={matches.length === 1 ? 'A vendor with a similar name or website already exists' : `${matches.length} vendors with a similar name or website already exist`}
                matches={matches}
                footnote="You can still add it. Check it is not the same organisation first."
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {show('vendor_type') && (
                  <Field id={fid('type')} label={builtinLabel(settings, 'vendor_type', 'Type')}>
                    <input id={fid('type')} list={fid('types')} maxLength={100} placeholder="Choose or type" value={form.vendor_type}
                      onChange={(e) => set('vendor_type', e.target.value)} className={FIELD} />
                    <datalist id={fid('types')}>{typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
                  </Field>
                )}
                {show('industry') && (
                  <Field id={fid('industry')} label={builtinLabel(settings, 'industry', 'Industry')} hint="optional">
                    <input id={fid('industry')} list={fid('industries')} maxLength={100} placeholder="Marketing analytics" value={form.industry}
                      onChange={(e) => set('industry', e.target.value)} className={FIELD} />
                    <datalist id={fid('industries')}>{industryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
                  </Field>
                )}
                {show('website') && (
                  <Field id={fid('website')} label={builtinLabel(settings, 'website', 'Website')} hint="optional">
                    <input id={fid('website')} maxLength={500} placeholder="https://acme.example" value={form.website}
                      onChange={(e) => set('website', e.target.value)} className={FIELD} />
                  </Field>
                )}
                <Field id={fid('unit')} label="Business unit" hint="optional">
                  <select id={fid('unit')} value={form.business_unit_id} onChange={(e) => set('business_unit_id', e.target.value)} className={FIELD}>
                    <option value="">None</option>
                    {vendor?.business_unit && !(units ?? []).some((u) => u.id === vendor.business_unit.id) && (
                      <option value={vendor.business_unit.id}>{vendor.business_unit.name}</option>
                    )}
                    {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Field>
              </div>
              {show('services') && (
                <Field id={fid('services')} label="Services provided" hint="optional">
                  <input id={fid('services')} placeholder="Campaign attribution, reporting" value={form.services_provided}
                    onChange={(e) => set('services_provided', e.target.value)} className={FIELD} />
                </Field>
              )}

              <fieldset className="rounded-xl border border-[#d5dbe1] p-4">
                <legend className="sr-only">Data</legend>
                <p aria-hidden className={GROUP}>Data</p>
                <label className="flex items-center gap-2 text-[13px] leading-5 text-[#26323d]">
                  <input type="checkbox" checked={form.holds_personal_data} onChange={(e) => set('holds_personal_data', e.target.checked)}
                    className="h-4 w-4 accent-[#0f766e]" />
                  This vendor holds personal data
                </label>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {show('data_classification') && (
                    <Field id={fid('class')} label="Classification" hint="optional">
                      <select id={fid('class')} value={form.data_classification} onChange={(e) => set('data_classification', e.target.value)} className={FIELD}>
                        <option value="">Not classified</option>
                        {CLASSES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field id={fid('where')} label="Data location" hint="optional">
                    <input id={fid('where')} maxLength={255} placeholder="EU (Frankfurt)" value={form.data_location}
                      onChange={(e) => set('data_location', e.target.value)} className={FIELD} />
                  </Field>
                </div>
                <Field id={fid('systems')} label="Systems in scope" hint="optional" className="mt-3">
                  <input id={fid('systems')} placeholder="Salesforce, AWS production" value={form.systems_in_scope}
                    onChange={(e) => set('systems_in_scope', e.target.value)} className={FIELD} />
                </Field>
                {show('data_types') && (
                  <Field id={fid('datatypes')} label={builtinLabel(settings, 'data_types', 'Data types in scope')} hint="optional" className="mt-3">
                    <input id={fid('datatypes')} placeholder="PII, PHI, financial" value={form.data_types_accessed}
                      onChange={(e) => set('data_types_accessed', e.target.value)} className={FIELD} />
                  </Field>
                )}
                <p className="mt-1.5 text-[12px] leading-4 text-[#64707e]">Separate systems and data types with commas.</p>
              </fieldset>
            </div>

            <fieldset className="self-start rounded-xl border border-[#d5dbe1] bg-[#f7f9fa] p-4">
              <legend className="sr-only">Ownership</legend>
              <p aria-hidden className={GROUP}>Ownership</p>
              <div className="space-y-3">
                {show('business_owner') && (
                  <Field id={fid('owner')} label={builtinLabel(settings, 'business_owner', 'Business owner')} tip="Needed to pass the Intake stage.">
                    <PersonSelect id={fid('owner')} value={form.owner_id} onChange={(v) => set('owner_id', v)} people={people} current={vendor?.owner} />
                  </Field>
                )}
                <Field id={fid('security')} label="Security owner">
                  <PersonSelect id={fid('security')} value={form.security_owner_id} onChange={(v) => set('security_owner_id', v)} people={people} current={vendor?.security_owner} />
                </Field>
                <Field id={fid('relationship')} label="Relationship owner">
                  <PersonSelect id={fid('relationship')} value={form.relationship_owner_id} onChange={(v) => set('relationship_owner_id', v)} people={people} current={vendor?.relationship_owner} />
                </Field>
                {add && (
                  <div>
                    <Field id={fid('first')} label="First engagement" hint="optional">
                      <input id={fid('first')} maxLength={255} placeholder="Campaign attribution" value={first} onChange={(e) => setFirst(e.target.value)} className={FIELD} />
                    </Field>
                    <p className="mt-1 text-[12px] leading-4 text-[#64707e]">Needed before tiering. You can add it later.</p>
                  </div>
                )}
              </div>
            </fieldset>
          </div>

          <details className="rounded-xl border border-[#d5dbe1]">
            <summary className="cursor-pointer select-none rounded-xl px-4 py-3 text-[13px] font-semibold leading-5 text-[#26323d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
              More details
            </summary>
            <div className="grid gap-4 border-t border-[#e1e6eb] p-4 sm:grid-cols-2">
              {show('description') && (
                <Field id={fid('description')} label={builtinLabel(settings, 'description', 'Description')} className="sm:col-span-2">
                  <textarea id={fid('description')} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} className={AREA} />
                </Field>
              )}
              {show('tier') && !add && (
                <Field id={fid('tier')} label={builtinLabel(settings, 'tier', 'Tier')}
                  tip="Worked out when the engagement is tiered. Change it only to override: a tier that was worked out needs a reason.">
                  <select id={fid('tier')} value={form.tier} onChange={(e) => set('tier', e.target.value)} className={FIELD}>
                    {TIERS.map((t) => <option key={t} value={t}>{words(t)}</option>)}
                  </select>
                </Field>
              )}
              {!add && (
                <Field id={fid('status')} label="Status">
                  <select id={fid('status')} value={form.status} onChange={(e) => set('status', e.target.value)} className={FIELD}>
                    {statusItems.some((s) => s.value === form.status) ? null : <option value={form.status}>{words(form.status)}</option>}
                    {statusItems.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
              )}
              {tierChanged && tiered && (
                <Field id={fid('why')} label="Why the tier changes" className="sm:col-span-2">
                  <textarea id={fid('why')} rows={2} value={form.tier_justification} onChange={(e) => set('tier_justification', e.target.value)}
                    placeholder="Holds all payroll data for 4,000 staff." className={AREA} />
                </Field>
              )}
              {show('data_classification') && (
                <Field id={fid('access')} label="Data access">
                  <select id={fid('access')} value={form.data_access_level} onChange={(e) => set('data_access_level', e.target.value)} className={FIELD}>
                    {ACCESS.includes(form.data_access_level) ? null : <option value={form.data_access_level}>{words(form.data_access_level)}</option>}
                    {ACCESS.map((a) => <option key={a} value={a}>{words(a)}</option>)}
                  </select>
                </Field>
              )}
              <Field id={fid('tags')} label="Tags">
                <input id={fid('tags')} placeholder="preferred, EU only" value={form.tags} onChange={(e) => set('tags', e.target.value)} className={FIELD} />
              </Field>
              <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
                {show('contact_name') && (
                  <Field id={fid('cname')} label={builtinLabel(settings, 'contact_name', 'Contact name')}>
                    <input id={fid('cname')} maxLength={255} value={form.primary_contact_name} onChange={(e) => set('primary_contact_name', e.target.value)} className={FIELD} />
                  </Field>
                )}
                {show('contact_email') && (
                  <Field id={fid('cemail')} label={builtinLabel(settings, 'contact_email', 'Contact email')}>
                    <input id={fid('cemail')} type="email" maxLength={255} value={form.primary_contact_email} onChange={(e) => set('primary_contact_email', e.target.value)} className={FIELD} />
                  </Field>
                )}
                {show('contact_phone') && (
                  <Field id={fid('cphone')} label={builtinLabel(settings, 'contact_phone', 'Contact phone')}>
                    <input id={fid('cphone')} maxLength={100} value={form.primary_contact_phone} onChange={(e) => set('primary_contact_phone', e.target.value)} className={FIELD} />
                  </Field>
                )}
              </div>
              <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
                {show('contract_start') && (
                  <Field id={fid('start')} label={builtinLabel(settings, 'contract_start', 'Contract start')}>
                    <input id={fid('start')} type="date" value={form.contract_start_date} onChange={(e) => set('contract_start_date', e.target.value)} className={FIELD} />
                  </Field>
                )}
                {show('contract_end') && (
                  <Field id={fid('end')} label={builtinLabel(settings, 'contract_end', 'Contract end')}>
                    <input id={fid('end')} type="date" value={form.contract_end_date} onChange={(e) => set('contract_end_date', e.target.value)} className={FIELD} />
                  </Field>
                )}
                {show('annual_spend') && (
                  <Field id={fid('value')} label={builtinLabel(settings, 'annual_spend', 'Annual value')}>
                    <input id={fid('value')} type="number" min="0" step="any" placeholder="42000" value={form.contract_value}
                      onChange={(e) => set('contract_value', e.target.value)} className={FIELD} />
                  </Field>
                )}
              </div>
              <Field id={fid('notes')} label="Notes" className="sm:col-span-2">
                <textarea id={fid('notes')} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={AREA} />
              </Field>
              {add && (
                <label className="flex items-start gap-2 text-[13px] leading-5 text-[#26323d] sm:col-span-2">
                  <input type="checkbox" checked={startLifecycle} onChange={(e) => setStartLifecycle(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0f766e]" />
                  <span>
                    Start the lifecycle now
                    <InfoTip text="Opens a versioned assessment at the first stage, for the first engagement if you name one. You can also start it later from the vendor's page." label="About starting the lifecycle" className="ml-1" />
                  </span>
                </label>
              )}
            </div>
          </details>
        </div>

        <div data-tab="custom" className={tab === 'custom' ? '' : 'hidden'}>
          <CustomFieldsTab moduleKey="vendors" values={custom} onChange={setCustom} />
        </div>

        {error && <p role="alert" className="mt-4 rounded-lg bg-[#fdeef1] px-3 py-2 text-[13px] leading-5 text-[#c01741]">{error}</p>}
      </form>
    </Dialog>
  );
}
