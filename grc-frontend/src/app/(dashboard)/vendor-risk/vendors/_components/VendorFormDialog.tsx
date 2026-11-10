'use client';

// The add / edit vendor sheet (alternative B of the revamp): ONE sheet from the right (a bottom sheet on a phone), the same payload as ever (vendorSave.ts, vendorFormModel.ts are untouched).
// Essentials are open: the name (with a live warning about a vendor we may already have), what the vendor is, where it sits, who owns it, and for a new vendor its first engagement and whether
// to start the lifecycle now. The rest is a closed section each, with how many of its fields are filled: Data, Contract and contacts, Notes and tags, and the organisation's own fields.
// The Tier is asked only for a vendor that has been tiered (a new or untiered vendor's "medium" is a placeholder the tiering overwrites); changing a tiered vendor's tier needs a reason.
// The organisation's settings still rule: a field an admin hid is not asked, a list they set is offered. Typed input is guarded (Discard changes?), a refused save says why at the top with a Retry.
// The component keeps its name and props: the vendor record's Edit and the module's Add vendor mount it.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Checkbox, Disclosure, FormError, FormField, Select, Sheet, Textarea, TextInput, useReportedMutation,
} from '@/components/ui/ds';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import {
  CustomFieldsTab, builtinLabel, listOptions, liveFields, showBuiltin, statusChoices, useModuleSettings, valuesToSave,
  type CustomValues,
} from '@/components/settings/CustomFields';
import { vendorLifecycle } from '@/lib/statuses/vendor';
import { usePeople } from '../../_lib/actions/shared';
import { engagementsApi, engagementsKey } from '../../_lib/engagementsApi';
import { useDebounced, useDuplicates, useUnits } from '../../_lib/vendorRecordApi';
import { emptyForm, formFrom, problems, type VendorForm } from '../../_lib/vendorFormModel';
import { isTiered } from '../../_lib/vendorRegisterDef';
import { addVendor, editVendor, type VendorCalls } from '../../_lib/vendorSave';
import DuplicateBox from '../../intake/_components/DuplicateBox';

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
const GRID = 'grid gap-[12px] sm:grid-cols-2';
const filled = (...values: Array<string | boolean | undefined | null>): number => values.filter((v) => (typeof v === 'string' ? v.trim() !== '' : !!v)).length;

type Section = 'data' | 'contract' | 'notes' | 'custom';

/** One person's pick: Unassigned, or someone who signs in here. The one already on the record stays pickable. */
function PersonSelect({ value, onChange, people, current }: {
  value: string; onChange: (id: string) => void; people: Array<{ id: number; name: string }>; current?: { id: number; full_name: string } | null;
}) {
  const known = people.some((p) => String(p.id) === String(current?.id));
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unassigned</option>
      {current && !known && <option value={current.id}>{current.full_name}</option>}
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
}

export default function VendorFormDialog({ open, mode, vendor, onClose, onSaved }: VendorFormDialogProps) {
  const qc = useQueryClient();
  const uid = useId();
  const { data: settings } = useModuleSettings('vendors');
  const people = usePeople();
  const { data: units } = useUnits();

  // The form starts from the vendor it was mounted with and is made fresh each time the sheet opens (below).
  const start = (): VendorForm => (mode === 'edit' && vendor ? formFrom(vendor) : emptyForm());
  const [form, setForm] = useState<VendorForm>(start);
  const [was, setWas] = useState<VendorForm | null>(() => (mode === 'edit' && vendor ? formFrom(vendor) : null));
  const [first, setFirst] = useState('');
  const [startLifecycle, setStartLifecycle] = useState(true);
  const [custom, setCustom] = useState<CustomValues>(() => (mode === 'edit' ? (vendor?.custom_values ?? {}) : {}));
  const [initialCustom, setInitialCustom] = useState<CustomValues>(() => (mode === 'edit' ? (vendor?.custom_values ?? {}) : {}));
  const [opened, setOpened] = useState<Record<Section, boolean>>({ data: false, contract: false, notes: false, custom: false });
  const [problem, setProblem] = useState<unknown>(null);
  const [again, setAgain] = useState(false);                                        // asking again can help: the server failed, or a duplicate was warned about
  const [retryAnyway, setRetryAnyway] = useState(false);

  // A fresh form each time the sheet opens (or opens on another vendor): a refetch of the vendor while it is open must not wipe typing.
  useEffect(() => {
    if (!open) return;
    const next = mode === 'edit' && vendor ? formFrom(vendor) : emptyForm();
    const values = mode === 'edit' ? (vendor?.custom_values ?? {}) : {};
    setForm(next);
    setWas(mode === 'edit' ? next : null);
    setFirst('');
    setStartLifecycle(true);
    setCustom(values);
    setInitialCustom(values);
    setOpened({ data: false, contract: false, notes: false, custom: false });
    setProblem(null);
    setAgain(false);
    setRetryAnyway(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which vendor is open, not on every refetch of it
  }, [open, mode, vendor?.id]);

  const add = mode === 'add';
  const set = <K extends keyof VendorForm>(key: K, value: VendorForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const tiered = isTiered(vendor ?? {});
  const show = (key: string) => showBuiltin(settings, key);
  const reference = was ?? emptyForm();
  const dirty = open && (JSON.stringify(form) !== JSON.stringify(reference) || first.trim() !== '' || JSON.stringify(custom) !== JSON.stringify(initialCustom));

  // The check waits for the typing to pause; only a new vendor is checked (editing a vendor does not make a second one).
  const name = useDebounced(form.name);
  const site = useDebounced(form.website);
  const matches = useDuplicates(add && open && form.name.trim() ? name : '', site).data ?? [];

  const save = useReportedMutation({
    // The tenant's own fields go with the vendor, a new vendor's lifecycle starts when asked, an edit sends only what changed (vendorSave.ts).
    mutationFn: () => (!add && vendor
      ? editVendor(CALLS, vendor, { form, was: was as VendorForm, customValues: valuesToSave(settings, custom, vendor.custom_values) })
      : addVendor(CALLS, {
        form, customValues: valuesToSave(settings, custom), firstEngagement: first, startLifecycle,
        allowDuplicate: matches.length > 0 || retryAnyway,                       // it was warned about, and chose to add it
      })),
    success: ({ note }) => (note ? { title: add ? 'Vendor added' : 'Saved', message: note } : add ? 'Vendor added' : 'Saved'),
    failure: add ? "Couldn't add the vendor" : "Couldn't save the vendor",
    toast: 'success',                                                              // a failure is said once, at the top of the form
    retryable: false,
    invalidate: [['vendors'], ['vendors-select'], ['vendor-dashboard'], ['vendor-assessments-all'], ['tprm-vendor-duplicates']],
    onSuccess: ({ saved }) => {
      void qc.invalidateQueries({ queryKey: ['vendor', saved.id] });
      void qc.invalidateQueries({ queryKey: engagementsKey(saved.id) });
      onSaved?.(saved);
      onClose();
    },
    onError: (e) => {
      if ((e as { response?: { status?: number } })?.response?.status === 409) {
        setRetryAnyway(true);                                                    // a vendor with this name or website exists: the next try adds it
        void qc.invalidateQueries({ queryKey: ['tprm-vendor-duplicates'] });
        setProblem(`${apiErrorText(e, 'It may already be on record.')} Add it again to keep it as a new vendor.`);
        setAgain(true);
      } else {
        setProblem(e);
        setAgain(true);
      }
    },
  });

  const submit = () => {
    const found = problems(form, was, tiered);
    if (found.length) { setProblem(found.join(' ')); setAgain(false); return; }
    setProblem(null);
    if (!save.isPending) save.mutate();
  };

  // a field the browser refuses (a bad email) opens the section it is in
  const reveal = (target: EventTarget) => {
    const at = (target as HTMLElement).closest?.('[data-section]')?.getAttribute('data-section') as Section | null | undefined;
    if (at) setOpened((o) => ({ ...o, [at]: true }));
  };

  const typeOptions = listOptions(settings, 'vendor_type', form.vendor_type);
  const industryOptions = listOptions(settings, 'industry', form.industry);
  const statusItems = statusChoices(settings, STATUSES.map((s) => ({ value: s, label: vendorLifecycle.label(s) })));
  const tierChanged = !!was && form.tier !== was.tier;
  const section = (key: Section, label: string, count: number, body: ReactNode) => (
    <Disclosure label={label} count={count} countLabel="filled" level={3} open={opened[key]} onOpenChange={(o) => setOpened((s) => ({ ...s, [key]: o }))}>
      <div data-section={key} className="flex flex-col gap-[12px] pt-[4px]">{body}</div>
    </Disclosure>
  );
  const customFilled = liveFields(settings).filter((f) => { const v = custom[f.key]; return v !== undefined && v !== null && String(v).trim() !== ''; }).length;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={add ? 'Add vendor' : 'Edit vendor'}
      subtitle={add ? 'Tiering follows on the engagement' : 'Tier and score come from the lifecycle'}
      width="lg"
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} variant="primary" loading={save.isPending}>{add ? 'Add vendor' : 'Save'}</Button>
        </div>
      )}
    >
      <form id={`${uid}-form`} className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); submit(); }} onInvalidCapture={(e) => reveal(e.target)}>
        <FormError title={add ? "Couldn't add the vendor" : "Couldn't save the vendor"} error={problem} onRetry={again ? () => submit() : undefined} />

        <div className="flex flex-col gap-[12px]">
          <FormField label="Name" required>
            <TextInput autoComplete="off" maxLength={255} value={form.name} placeholder="Acme Analytics" onChange={(e) => set('name', e.target.value)} />
          </FormField>
          {add && matches.length > 0 && (
            <DuplicateBox
              title={matches.length === 1 ? 'A vendor with a similar name or website already exists' : `${matches.length} vendors with a similar name or website already exist`}
              matches={matches}
              footnote="You can still add it. Check it is not the same organisation first."
            />
          )}
          <div className={GRID}>
            {show('vendor_type') && (
              <FormField label={builtinLabel(settings, 'vendor_type', 'Type')}>
                <TextInput list={`${uid}-types`} maxLength={100} placeholder="Choose or type" value={form.vendor_type} onChange={(e) => set('vendor_type', e.target.value)} />
                <datalist id={`${uid}-types`}>{typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
              </FormField>
            )}
            {show('industry') && (
              <FormField label={builtinLabel(settings, 'industry', 'Industry')} optional>
                <TextInput list={`${uid}-industries`} maxLength={100} placeholder="Marketing analytics" value={form.industry} onChange={(e) => set('industry', e.target.value)} />
                <datalist id={`${uid}-industries`}>{industryOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</datalist>
              </FormField>
            )}
            {show('website') && (
              <FormField label={builtinLabel(settings, 'website', 'Website')} optional>
                <TextInput maxLength={500} placeholder="https://acme.example" value={form.website} onChange={(e) => set('website', e.target.value)} />
              </FormField>
            )}
            <FormField label="Business unit" optional>
              <Select value={form.business_unit_id} onChange={(e) => set('business_unit_id', e.target.value)}>
                <option value="">None</option>
                {vendor?.business_unit && !(units ?? []).some((u) => u.id === vendor.business_unit.id) && <option value={vendor.business_unit.id}>{vendor.business_unit.name}</option>}
                {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </FormField>
          </div>
          {show('services') && (
            <FormField label="Services provided" optional hint="Separate with commas.">
              <TextInput placeholder="Campaign attribution, reporting" value={form.services_provided} onChange={(e) => set('services_provided', e.target.value)} />
            </FormField>
          )}
          <div className={GRID}>
            {show('business_owner') && (
              <FormField label={builtinLabel(settings, 'business_owner', 'Business owner')} info="Needed to pass the Intake stage.">
                <PersonSelect value={form.owner_id} onChange={(v) => set('owner_id', v)} people={people} current={vendor?.owner} />
              </FormField>
            )}
            <FormField label="Security owner">
              <PersonSelect value={form.security_owner_id} onChange={(v) => set('security_owner_id', v)} people={people} current={vendor?.security_owner} />
            </FormField>
            <FormField label="Relationship owner">
              <PersonSelect value={form.relationship_owner_id} onChange={(v) => set('relationship_owner_id', v)} people={people} current={vendor?.relationship_owner} />
            </FormField>
            {!add && (
              <FormField label="Status">
                <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {statusItems.some((s) => s.value === form.status) ? null : <option value={form.status}>{words(form.status)}</option>}
                  {statusItems.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </FormField>
            )}
            {!add && tiered && show('tier') && (
              <FormField label={builtinLabel(settings, 'tier', 'Tier')} info="Worked out when the engagement is tiered. Change it only to override: a tier that was worked out needs a reason.">
                <Select value={form.tier} onChange={(e) => set('tier', e.target.value)}>
                  {TIERS.map((t) => <option key={t} value={t}>{words(t)}</option>)}
                </Select>
              </FormField>
            )}
          </div>
          {!add && tiered && tierChanged && (
            <FormField label="Why the tier changes" required hint="At least 10 characters.">
              <Textarea rows={2} value={form.tier_justification} onChange={(e) => set('tier_justification', e.target.value)} placeholder="Holds all payroll data for 4,000 staff." />
            </FormField>
          )}
          {add && (
            <>
              <FormField label="First engagement" optional hint="Needed before tiering. You can add it later.">
                <TextInput maxLength={255} placeholder="Campaign attribution" value={first} onChange={(e) => setFirst(e.target.value)} />
              </FormField>
              <div>
                <Checkbox checked={startLifecycle} onChange={(e) => setStartLifecycle(e.target.checked)} label="Start the lifecycle now" />
                <p className="mt-[4px] pl-[24px] text-ds-label text-ds-fg-muted">Opens an assessment at the first stage, for the first engagement if you name one. You can also start it later from the vendor&apos;s page.</p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col">
          {section('data', 'Data', filled(form.holds_personal_data, form.data_classification, form.data_location, form.systems_in_scope, form.data_types_accessed) + (form.data_access_level && form.data_access_level !== 'internal' ? 1 : 0), (
            <>
              <Checkbox checked={form.holds_personal_data} onChange={(e) => set('holds_personal_data', e.target.checked)} label="This vendor holds personal data" />
              <div className={GRID}>
                {show('data_classification') && (
                  <FormField label="Classification" optional>
                    <Select value={form.data_classification} onChange={(e) => set('data_classification', e.target.value)}>
                      <option value="">Not classified</option>
                      {CLASSES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
                    </Select>
                  </FormField>
                )}
                {show('data_classification') && (
                  <FormField label="Data access">
                    <Select value={form.data_access_level} onChange={(e) => set('data_access_level', e.target.value)}>
                      {ACCESS.includes(form.data_access_level) ? null : <option value={form.data_access_level}>{words(form.data_access_level)}</option>}
                      {ACCESS.map((a) => <option key={a} value={a}>{words(a)}</option>)}
                    </Select>
                  </FormField>
                )}
              </div>
              <FormField label="Data location" optional>
                <TextInput maxLength={255} placeholder="EU (Frankfurt)" value={form.data_location} onChange={(e) => set('data_location', e.target.value)} />
              </FormField>
              <FormField label="Systems in scope" optional hint="Separate with commas.">
                <TextInput placeholder="Salesforce, AWS production" value={form.systems_in_scope} onChange={(e) => set('systems_in_scope', e.target.value)} />
              </FormField>
              {show('data_types') && (
                <FormField label={builtinLabel(settings, 'data_types', 'Data types in scope')} optional hint="Separate with commas.">
                  <TextInput placeholder="PII, PHI, financial" value={form.data_types_accessed} onChange={(e) => set('data_types_accessed', e.target.value)} />
                </FormField>
              )}
            </>
          ))}

          {section('contract', 'Contract and contacts', filled(form.contract_start_date, form.contract_end_date, form.contract_value, form.primary_contact_name, form.primary_contact_email, form.primary_contact_phone), (
            <>
              <div className={GRID}>
                {show('contract_start') && (
                  <FormField label={builtinLabel(settings, 'contract_start', 'Contract start')} optional>
                    <TextInput type="date" value={form.contract_start_date} onChange={(e) => set('contract_start_date', e.target.value)} />
                  </FormField>
                )}
                {show('contract_end') && (
                  <FormField label={builtinLabel(settings, 'contract_end', 'Contract end')} optional>
                    <TextInput type="date" value={form.contract_end_date} onChange={(e) => set('contract_end_date', e.target.value)} />
                  </FormField>
                )}
                {show('annual_spend') && (
                  <FormField label={builtinLabel(settings, 'annual_spend', 'Annual value')} optional>
                    <TextInput type="number" min="0" step="any" placeholder="42000" value={form.contract_value} onChange={(e) => set('contract_value', e.target.value)} />
                  </FormField>
                )}
              </div>
              <div className={GRID}>
                {show('contact_name') && (
                  <FormField label={builtinLabel(settings, 'contact_name', 'Contact name')} optional>
                    <TextInput maxLength={255} value={form.primary_contact_name} onChange={(e) => set('primary_contact_name', e.target.value)} />
                  </FormField>
                )}
                {show('contact_email') && (
                  <FormField label={builtinLabel(settings, 'contact_email', 'Contact email')} optional>
                    <TextInput type="email" maxLength={255} value={form.primary_contact_email} onChange={(e) => set('primary_contact_email', e.target.value)} />
                  </FormField>
                )}
                {show('contact_phone') && (
                  <FormField label={builtinLabel(settings, 'contact_phone', 'Contact phone')} optional>
                    <TextInput maxLength={100} value={form.primary_contact_phone} onChange={(e) => set('primary_contact_phone', e.target.value)} />
                  </FormField>
                )}
              </div>
            </>
          ))}

          {section('notes', 'Notes and tags', filled(form.description, form.notes, form.tags), (
            <>
              {show('description') && (
                <FormField label={builtinLabel(settings, 'description', 'Description')} optional>
                  <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
                </FormField>
              )}
              <FormField label="Tags" optional hint="Separate with commas.">
                <TextInput placeholder="preferred, EU only" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
              </FormField>
              <FormField label="Notes" optional>
                <Textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </FormField>
            </>
          ))}

          {section('custom', 'Your fields', customFilled, <CustomFieldsTab moduleKey="vendors" values={custom} onChange={setCustom} />)}
        </div>
      </form>
    </Sheet>
  );
}
