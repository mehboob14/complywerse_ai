'use client';

/**
 * Add / edit a software-license ENTITLEMENT — what the tenant owns (quantity,
 * terms, cost, dates, PO / contract). Entitlements are procurement facts that no
 * scan can see, so this form is the only way they enter the system; the consumed /
 * position / status figures are computed server-side and are never sent back.
 *
 * Mounted fresh per open (the parent passes a `key`), so form state is initialised
 * lazily from props and never needs a reset effect.
 */
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import { RightSlidePanel } from '@/cyber-assurance/components/ui/RightSlidePanel';
import { licensesApi, type LicenseEntitlement, type LicenseEntitlementInput } from '@/cyber-assurance/lib/api';
import {
  CURRENCIES, LICENSE_METRICS, LICENSE_TYPES, METRIC_HINT, UNMEASURED_METRICS,
  apiErrorMessage, emptyForm, formFromEntitlement, formToInput, validateForm, withCurrent,
  type EntitlementForm, type FormErrors,
} from './lib';

const INPUT =
  'h-9 w-full rounded-lg border border-[#D8DEE8] bg-white px-3 text-[13px] text-[#0F172A] placeholder-[#94A3B8] ' +
  'focus:border-[#005B96] focus:outline-none focus:ring-1 focus:ring-[#005B96] ' +
  'disabled:cursor-not-allowed disabled:bg-[#F6F7FB] disabled:text-[#64748B]';
const INPUT_ERR = ' !border-[#B91C1C] focus:!border-[#B91C1C] focus:!ring-[#B91C1C]';

function Field({ label, required, error, hint, span, children }: {
  label: string; required?: boolean; error?: string; hint?: string; span?: boolean; children: ReactNode;
}) {
  return (
    <label className={`block ${span ? 'col-span-2' : ''}`}>
      <span className="mb-1 block text-[12px] font-semibold text-[#334155]">
        {label}{required && <span className="text-[#B91C1C]"> *</span>}
      </span>
      {children}
      {error
        ? <span className="mt-1 block text-[11.5px] text-[#B91C1C]">{error}</span>
        : hint && <span className="mt-1 block text-[11.5px] leading-[1.4] text-[#64748B]">{hint}</span>}
    </label>
  );
}

const Section = ({ children }: { children: ReactNode }) => (
  <p className="col-span-2 mb-0 mt-2 border-t border-[#EEF1F5] pt-3 text-[10.5px] font-semibold uppercase tracking-[.07em] text-[#64748B]">
    {children}
  </p>
);

export function EntitlementDrawer({
  mode, entitlement, prefill, readOnly = false, canDelete = false,
  publishers, defaultCurrency, onClose, onSaved, onDeleted,
}: {
  mode: 'create' | 'edit';
  entitlement?: LicenseEntitlement | null;
  /** Create-mode starting values (e.g. from an unlicensed-software row). */
  prefill?: Partial<EntitlementForm>;
  readOnly?: boolean;
  canDelete?: boolean;
  /** Existing publishers, offered as suggestions so spellings stay consistent. */
  publishers: string[];
  defaultCurrency: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDeleted: (message: string) => void;
}) {
  const editing = mode === 'edit' && !!entitlement;
  const [form, setForm] = useState<EntitlementForm>(() =>
    editing ? formFromEntitlement(entitlement as LicenseEntitlement) : emptyForm({ currency: defaultCurrency, ...prefill }));
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const set = <K extends keyof EntitlementForm>(k: K, v: EntitlementForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const save = useMutation({
    mutationFn: async (body: LicenseEntitlementInput) =>
      editing ? licensesApi.update((entitlement as LicenseEntitlement).id, body) : licensesApi.create(body),
    onSuccess: () => onSaved(editing ? 'Entitlement updated' : 'Entitlement added'),
    onError: (e) => setServerError(apiErrorMessage(e, 'Could not save the entitlement. Try again.')),
  });
  const remove = useMutation({
    mutationFn: async () => licensesApi.delete((entitlement as LicenseEntitlement).id),
    onSuccess: () => onDeleted('Entitlement deleted'),
    onError: (e) => setServerError(apiErrorMessage(e, 'Could not delete the entitlement. Try again.')),
  });
  const busy = save.isPending || remove.isPending;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (readOnly || busy) return;
    // A line already stored with quantity 0 (e.g. from an import) must stay editable.
    const errs = validateForm(form, editing && entitlement?.total_quantity === 0 ? 0 : 1);
    setErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length) return;
    // Only send software_key when the record's current value was reported — an empty one would clear it.
    save.mutate(formToInput(form, !editing || entitlement?.software_key !== undefined));
  };

  const confirmDelete = () => {
    if (!entitlement || busy) return;
    const name = [entitlement.product, entitlement.edition].filter(Boolean).join(' ');
    if (window.confirm(`Delete the entitlement "${name}"?\n\nSoftware it covered will show as unlicensed again until another entitlement covers it.`)) {
      setServerError(null);
      remove.mutate();
    }
  };

  const cls = (k: keyof EntitlementForm) => INPUT + (errors[k] ? INPUT_ERR : '');
  const title = readOnly ? 'Entitlement' : editing ? 'Edit entitlement' : 'Add entitlement';
  const subtitle = editing
    ? [entitlement?.publisher, entitlement?.product].filter(Boolean).join(' · ')
    : 'Record a license you own. ComplyVerse compares it with the software found installed.';

  const footer = (
    <div className="flex items-center gap-2">
      {editing && canDelete && !readOnly && (
        <button type="button" onClick={confirmDelete} disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#F1C6C6] bg-white px-3 text-[13px] font-semibold text-[#B91C1C] hover:bg-[#FDECEC] disabled:opacity-60">
          {remove.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}Delete
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={onClose} disabled={busy}
          className="h-9 rounded-lg border border-[#D8DEE8] bg-white px-4 text-[13px] font-semibold text-[#334155] hover:bg-[#F6F7FB] disabled:opacity-60">
          {readOnly ? 'Close' : 'Cancel'}
        </button>
        {!readOnly && (
          <button type="submit" form="license-entitlement-form" disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#005B96] bg-[#005B96] px-4 text-[13px] font-semibold text-white hover:bg-[#014A81] disabled:opacity-60">
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            {editing ? 'Save changes' : 'Add entitlement'}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <RightSlidePanel isOpen onClose={busy ? () => {} : onClose} title={title} subtitle={subtitle} width="w-full max-w-xl" footer={footer}>
      <form id="license-entitlement-form" onSubmit={submit} noValidate>
        {serverError && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-[#F1C6C6] bg-[#FDECEC] px-3 py-2.5 text-[12.5px] text-[#991B1B]">
            <AlertCircle size={15} className="mt-px shrink-0" />
            <span>{serverError}</span>
          </div>
        )}
        {readOnly && (
          <p className="mb-4 rounded-lg bg-[#F6F7FB] px-3 py-2 text-[12px] text-[#64748B]">
            You can view this entitlement but not change it.
          </p>
        )}

        <fieldset disabled={readOnly || busy} className="m-0 grid min-w-0 grid-cols-2 gap-x-3 gap-y-3.5 border-0 p-0">
          <Field label="Publisher" required error={errors.publisher} span>
            <input className={cls('publisher')} value={form.publisher} onChange={(e) => set('publisher', e.target.value)}
              list="license-publishers" placeholder="e.g. Microsoft" autoFocus={!editing && !prefill?.publisher} />
            <datalist id="license-publishers">{publishers.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Product" required error={errors.product}>
            <input className={cls('product')} value={form.product} onChange={(e) => set('product', e.target.value)}
              placeholder="e.g. Microsoft 365 E3" />
          </Field>
          <Field label="Edition" error={errors.edition}>
            <input className={cls('edition')} value={form.edition} onChange={(e) => set('edition', e.target.value)}
              placeholder="e.g. Enterprise" />
          </Field>

          <Section>License terms</Section>
          <Field label="License type">
            <select className={INPUT} value={form.license_type} onChange={(e) => set('license_type', e.target.value)}>
              {withCurrent(LICENSE_TYPES, form.license_type).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Counted by (metric)">
            <select className={INPUT} value={form.license_metric} onChange={(e) => set('license_metric', e.target.value)}>
              {withCurrent(LICENSE_METRICS, form.license_metric).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <p className="col-span-2 -mt-1.5 mb-0 text-[11.5px] leading-[1.4] text-[#64748B]">
            {METRIC_HINT[form.license_metric] ?? 'How the vendor counts what you consume.'}
            {UNMEASURED_METRICS.includes(form.license_metric) && (
              <span className="mt-1 block font-medium text-[#92400E]">
                Installed-software scans can&rsquo;t count this metric, so ComplyVerse records the entitlement but can&rsquo;t compute a compliance position for it.
              </span>
            )}
          </p>
          <Field label="Quantity owned" required error={errors.total_quantity}
            hint="Seats, devices, cores or users — in the units of the metric above.">
            <input type="number" inputMode="numeric" min={1} step={1} className={cls('total_quantity')}
              value={form.total_quantity} onChange={(e) => set('total_quantity', e.target.value)} />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
            <Field label="Unit cost" error={errors.unit_cost}>
              <input type="number" inputMode="decimal" min={0} step="0.01" className={cls('unit_cost')}
                value={form.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Currency">
              <select className={INPUT} value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {withCurrent(CURRENCIES.map((c) => ({ value: c, label: c })), form.currency).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>

          <Section>Dates</Section>
          <Field label="Purchased">
            <input type="date" className={INPUT} value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
          </Field>
          <Field label="Term starts">
            <input type="date" className={INPUT} value={form.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="Expires" error={errors.expiry_date} hint="Leave blank for a perpetual license.">
            <input type="date" className={cls('expiry_date')} value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
          </Field>
          <Field label="Maintenance / support ends" hint="Software Assurance or support renewal.">
            <input type="date" className={INPUT} value={form.maintenance_expiry} onChange={(e) => set('maintenance_expiry', e.target.value)} />
          </Field>

          <Section>Procurement</Section>
          <Field label="PO reference">
            <input className={INPUT} value={form.po_reference} onChange={(e) => set('po_reference', e.target.value)} />
          </Field>
          <Field label="Contract reference">
            <input className={INPUT} value={form.contract_reference} onChange={(e) => set('contract_reference', e.target.value)} />
          </Field>
          <Field label="Reseller / vendor" span>
            <input className={INPUT} value={form.reseller} onChange={(e) => set('reseller', e.target.value)} />
          </Field>
          <Field label="Notes" span>
            <textarea rows={3} className={`${INPUT} h-auto min-h-[72px] py-2`} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>

          {/* Only reported for records that carry one, or when starting from an unlicensed-software row. */}
          {(!editing || entitlement?.software_key !== undefined) && (
            <>
              <Section>Matching (advanced)</Section>
              <Field label="Software key" span
                hint="Optional. When set, this license matches ONLY installed software with these detected keys (comma-separated; a trailing * matches a prefix) and name matching is switched off for it. Leave blank to match on publisher and product name.">
                <input className={`${INPUT} font-mono`} value={form.software_key} onChange={(e) => set('software_key', e.target.value)}
                  placeholder="e.g. microsoft-365-apps*" spellCheck={false} />
              </Field>
            </>
          )}
        </fieldset>
      </form>
    </RightSlidePanel>
  );
}
