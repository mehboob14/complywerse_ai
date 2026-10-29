'use client';

// Add or edit a vendor's contact (the same fields and the same calls as the Contacts section of the portal panel): who it is, which
// parts of the relationship they answer for, and whether they get portal links. The contact on the vendor's own record, not written
// yet, becomes a contact of its own when it is saved here.
import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { BTN, BTN_PRIMARY, Dialog, ToggleChip, fmt } from '../../../_ui';
import { CONTACT_ROLES, portalApi, type ContactFields, type ContactRole, type SupplierContact } from '../../../_lib/portalApi';
import { AREA, FIELD, HINT, LABEL } from '../../_components/formStyles';

const BLANK: ContactFields = { name: '', email: '', phone: '', job_title: '', roles: [], is_primary: false, portal_access: true, notes: '' };

const fieldsOf = (c: SupplierContact | 'new' | null): ContactFields =>
  c && c !== 'new'
    ? { name: c.name || '', email: c.email || '', phone: c.phone || '', job_title: c.job_title || '', roles: c.roles.filter((r) => r !== 'primary'),
        is_primary: c.is_primary, portal_access: c.portal_access, notes: c.notes || '' }
    : BLANK;

export default function ContactDialog({ vendorId, contact, onClose }: {
  vendorId: number;
  /** the contact to edit, 'new' to add one; null keeps the dialog shut */
  contact: SupplierContact | 'new' | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useId();
  const [f, setF] = useState<ContactFields>(() => fieldsOf(contact));
  const open = contact !== null;
  const editing = contact !== null && contact !== 'new';

  // A fresh form each time the dialog opens on a contact (a refetch of the list while it is open must not wipe typing).
  const which = contact === 'new' ? 'new' : contact ? String(contact.id ?? 'record') : null;
  useEffect(() => {
    if (which !== null) setF(fieldsOf(contact));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which contact is open, not on every refetch of it
  }, [which]);
  const set = (patch: ContactFields) => setF((prev) => ({ ...prev, ...patch }));
  const toggle = (role: ContactRole) => set({ roles: f.roles?.includes(role) ? f.roles.filter((r) => r !== role) : [...(f.roles ?? []), role] });

  const save = useMutation({
    mutationFn: () => {
      const body: ContactFields = { ...f, name: (f.name ?? '').trim(), email: f.email?.trim() || null, phone: f.phone?.trim() || null,
        job_title: f.job_title?.trim() || null, notes: f.notes?.trim() || null };
      return contact === 'new' || contact?.id == null ? portalApi.addContact(vendorId, body) : portalApi.updateContact(vendorId, contact.id, body);
    },
    onSuccess: () => {
      ['tprm-contacts', 'tprm-portal-links'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));
      toast({ type: 'success', title: editing ? 'Contact saved' : 'Contact added' });
      onClose();
    },
    onError: (e) => toast({ type: 'error', title: 'Not saved', message: apiErrorText(e, 'Try again.') }),
  });
  const ready = !!(f.name ?? '').trim();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size={600}
      title={editing ? 'Edit contact' : 'Add contact'}
      description="Questionnaires go to the portal contact."
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={!ready || save.isPending} className={BTN_PRIMARY}>
            {save.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </>
      )}
    >
      <form id={form} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready && !save.isPending) save.mutate(); }}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${form}-name`} className={LABEL}>Name</label>
            <input id={`${form}-name`} data-autofocus required maxLength={255} value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} className={FIELD} />
          </div>
          <div>
            <label htmlFor={`${form}-email`} className={LABEL}>Email <InfoTip text="Needed to send a questionnaire." label="About the email" className="ml-0.5" /></label>
            <input id={`${form}-email`} type="email" maxLength={255} value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} className={FIELD} />
          </div>
          <div>
            <label htmlFor={`${form}-title`} className={LABEL}>Job title <span className={HINT}>(optional)</span></label>
            <input id={`${form}-title`} maxLength={255} value={f.job_title ?? ''} onChange={(e) => set({ job_title: e.target.value })} className={FIELD} />
          </div>
          <div>
            <label htmlFor={`${form}-phone`} className={LABEL}>Phone <span className={HINT}>(optional)</span></label>
            <input id={`${form}-phone`} maxLength={100} value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} className={FIELD} />
          </div>
        </div>
        <fieldset>
          <legend className={LABEL}>Roles <span className={HINT}>(optional)</span></legend>
          <div className="flex flex-wrap gap-1.5">
            {CONTACT_ROLES.filter((r) => r !== 'primary').map((role) => (
              <ToggleChip key={role} on={!!f.roles?.includes(role)} onClick={() => toggle(role)}>{fmt.status(role)}</ToggleChip>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] leading-5 text-[#26323d]">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={!!f.is_primary} onChange={(e) => set({ is_primary: e.target.checked })} className="h-4 w-4 accent-[#0f766e]" /> Primary
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={!!f.portal_access} onChange={(e) => set({ portal_access: e.target.checked })} className="h-4 w-4 accent-[#0f766e]" /> Portal access
            <InfoTip text="Without it the contact gets no links, and links already sent stop working." label="About portal access" />
          </label>
        </div>
        <div>
          <label htmlFor={`${form}-notes`} className={LABEL}>Notes <span className={HINT}>(optional)</span></label>
          <textarea id={`${form}-notes`} rows={2} maxLength={4000} value={f.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} className={AREA} />
        </div>
      </form>
    </Dialog>
  );
}
