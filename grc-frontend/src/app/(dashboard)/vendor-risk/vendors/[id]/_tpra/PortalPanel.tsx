'use client';

// Supplier portal tab of a supplier: its contacts and their personal links to the portal.
// Built as sections; requests and messages join below as sections of their own.

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Archive, Check, Copy, Loader2, Mail, Pencil, Plus, RotateCcw, Star } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import { InfoTip } from '@/components/ui/InfoTip';
import { parseUtc } from '@/lib/serverTime';
import {
  CONTACT_ROLES, absoluteLink, portalApi, type ContactFields, type ContactRole, type PortalLink, type SupplierContact,
} from '../../../_lib/portalApi';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const quiet = 'inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
const day = (v: string | null | undefined) =>
  parseUtc(v)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) ?? '';
const ROLE_LABEL: Record<ContactRole, string> = {
  primary: 'Primary', security: 'Security', privacy: 'Privacy', commercial: 'Commercial', legal: 'Legal',
  technical: 'Technical', billing: 'Billing',
};
const PURPOSE: Record<PortalLink['purpose'], string> = {
  invite: 'Sent', reminder: 'Reminder', request: 'Requested', questionnaire: 'Questionnaire',
};

function Section({ title, tip, action, children }: { title: string; tip?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}{tip && <InfoTip text={tip} />}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function ContactForm({ contact, onSave, onCancel, saving }: {
  contact: SupplierContact | null; onSave: (data: ContactFields) => void; onCancel: () => void; saving: boolean;
}) {
  const [f, setF] = useState<ContactFields>({
    name: contact?.name || '', email: contact?.email || '', phone: contact?.phone || '', job_title: contact?.job_title || '',
    roles: (contact?.roles || []).filter((r) => r !== 'primary'), is_primary: contact?.is_primary || false,
    portal_access: contact?.portal_access ?? true, notes: contact?.notes || '',
  });
  const set = (patch: ContactFields) => setF((prev) => ({ ...prev, ...patch }));
  const toggle = (role: ContactRole) =>
    set({ roles: f.roles?.includes(role) ? f.roles.filter((r) => r !== role) : [...(f.roles || []), role] });
  const submit = (e: FormEvent) => { e.preventDefault(); onSave({ ...f, email: f.email || null, phone: f.phone || null, job_title: f.job_title || null, notes: f.notes || null }); };
  return (
    <form onSubmit={submit} className="space-y-3 border-b border-slate-100 bg-primary-50/40 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600">Name
          <input className={clsx(input, 'mt-1')} required maxLength={255} value={f.name || ''} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="block text-xs font-medium text-slate-600">Email
          <input className={clsx(input, 'mt-1')} type="email" maxLength={255} value={f.email || ''} onChange={(e) => set({ email: e.target.value })} />
        </label>
        <label className="block text-xs font-medium text-slate-600">Job title
          <input className={clsx(input, 'mt-1')} maxLength={255} value={f.job_title || ''} onChange={(e) => set({ job_title: e.target.value })} />
        </label>
        <label className="block text-xs font-medium text-slate-600">Phone
          <input className={clsx(input, 'mt-1')} maxLength={100} value={f.phone || ''} onChange={(e) => set({ phone: e.target.value })} />
        </label>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-slate-600">Roles</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {CONTACT_ROLES.filter((r) => r !== 'primary').map((role) => {
            const on = !!f.roles?.includes(role);
            return (
              <button key={role} type="button" aria-pressed={on} onClick={() => toggle(role)}
                className={clsx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs',
                  on ? 'border-primary-300 bg-primary-50 font-medium text-[#0f766e]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
                {on && <Check className="h-3 w-3" aria-hidden />} {ROLE_LABEL[role]}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-4 text-xs text-slate-700">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={!!f.is_primary} onChange={(e) => set({ is_primary: e.target.checked })} /> Primary
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={!!f.portal_access} onChange={(e) => set({ portal_access: e.target.checked })} /> Portal access
          <InfoTip text="Without it the contact gets no links, and links already sent stop working." />
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-600">Notes
        <textarea className={clsx(input, 'mt-1')} rows={2} maxLength={4000} value={f.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </form>
  );
}

function FreshLink({ link, onDone }: { link: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(link); setCopied(true); };
  return (
    <div className="mt-2 rounded-lg border border-primary-200 bg-primary-50/50 p-2.5">
      <div className="flex items-center gap-2">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Personal link"
          className={clsx(input, 'min-w-0 flex-1 font-mono text-xs')} />
        <button type="button" onClick={copy} className={quiet}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-slate-500 hover:underline">Hide</button>
      </div>
      <p className="mt-1 text-[11px] text-slate-600">Shown once. It opens this supplier’s portal until it expires.</p>
    </div>
  );
}

function ContactRow({ vendorId, contact, canEdit, onEdit }: {
  vendorId: number; contact: SupplierContact; canEdit: boolean; onEdit: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [fresh, setFresh] = useState<string | null>(null);
  const refresh = () => ['tprm-contacts', 'tprm-portal-links'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));
  // The contact on the supplier record becomes a contact on first use.
  const idOf = async () => contact.id ?? (await portalApi.addContact(vendorId, {
    name: contact.name, email: contact.email, phone: contact.phone, is_primary: true })).data.id as number;
  const issue = useMutation({
    mutationFn: async (send: boolean) => (await portalApi.issueLink(vendorId, await idOf(), { send_email: send })).data,
    onSuccess: (data, send) => {
      refresh();
      if (send && data.emailed) {
        toast({ type: 'success', title: `Link emailed to ${contact.name}` });
      } else {
        setFresh(absoluteLink(data.link));
        navigator.clipboard?.writeText(absoluteLink(data.link));
        toast({ type: send ? 'warning' : 'success', title: send ? 'Email not sent' : 'Link copied',
          message: send ? 'Copy the link and send it yourself.' : undefined });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'No link', message: errText(e, 'Try again.') }),
  });
  const archive = useMutation({
    mutationFn: () => (contact.archived_at ? portalApi.restoreContact : portalApi.archiveContact)(vendorId, contact.id as number),
    onSuccess: refresh,
    onError: (e) => toast({ type: 'error', title: 'Could not change it', message: errText(e, 'Try again.') }),
  });
  const reachable = !!contact.email && contact.portal_access && !contact.archived_at;
  return (
    <li className={clsx('px-4 py-3', contact.archived_at && 'opacity-70')}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900">
            {contact.name}
            {contact.is_primary && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-[#0f766e]">
                <Star className="h-3 w-3" aria-hidden /> Primary
              </span>
            )}
            {contact.id === null && (
              <span className="rounded-full bg-[#f1f3f5] px-2 py-0.5 text-[11px] font-normal text-[#4b5563]">Supplier record</span>
            )}
            {!contact.portal_access && (
              <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-normal text-[#92400e]">No portal access</span>
            )}
            {contact.archived_at && (
              <span className="rounded-full bg-[#f1f3f5] px-2 py-0.5 text-[11px] font-normal text-[#4b5563]">Archived</span>
            )}
          </p>
          <p className="text-xs text-slate-600">
            {[contact.job_title, contact.email, contact.phone].filter(Boolean).join(' · ') || 'No details'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {contact.roles.filter((r) => r !== 'primary').map((r) => ROLE_LABEL[r]).join(', ')}
            {contact.roles.some((r) => r !== 'primary') && ' · '}
            {contact.last_portal_at ? `Last visit ${day(contact.last_portal_at)}` : 'No visit yet'}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-1.5">
            {!contact.archived_at && (
              <>
                <button type="button" className={quiet} disabled={!reachable || issue.isPending} onClick={() => issue.mutate(true)}
                  title={reachable ? 'Email a personal link' : 'Needs an email and portal access'}>
                  <Mail className="h-3.5 w-3.5" /> Send link
                </button>
                <button type="button" className={quiet} disabled={!reachable || issue.isPending} onClick={() => issue.mutate(false)}
                  title={reachable ? 'A personal link to copy' : 'Needs an email and portal access'}>
                  <Copy className="h-3.5 w-3.5" /> Copy link
                </button>
                <button type="button" className={quiet} onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</button>
              </>
            )}
            {contact.id !== null && (
              <button type="button" className={quiet} disabled={archive.isPending}
                onClick={() => (contact.archived_at || window.confirm(`Archive ${contact.name}? Their links stop working.`)) && archive.mutate()}>
                {contact.archived_at ? <><RotateCcw className="h-3.5 w-3.5" /> Restore</> : <><Archive className="h-3.5 w-3.5" /> Archive</>}
              </button>
            )}
          </div>
        )}
      </div>
      {fresh && <FreshLink link={fresh} onDone={() => setFresh(null)} />}
    </li>
  );
}

function ContactsSection({ vendorId, canEdit }: { vendorId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<SupplierContact | 'new' | null>(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tprm-contacts', vendorId, archived],
    queryFn: async () => (await portalApi.contacts(vendorId, archived)).data.items,
  });
  const save = useMutation({
    mutationFn: (fields: ContactFields) => (editing === 'new' || editing?.id == null
      ? portalApi.addContact(vendorId, fields)
      : portalApi.updateContact(vendorId, editing.id, fields)),
    onSuccess: () => {
      ['tprm-contacts', 'tprm-portal-links'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));
      setEditing(null);
    },
    onError: (e) => toast({ type: 'error', title: 'Could not save', message: errText(e, 'Try again.') }),
  });
  const contacts = data || [];
  return (
    <Section title={`Contacts (${contacts.filter((c) => !c.archived_at).length})`}
      tip="Each contact with an email and portal access can be sent a personal link. It opens this supplier’s portal, with everything waiting on the supplier, for 30 days."
      action={(
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
          </label>
          {canEdit && editing === null && (
            <button type="button" onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700">
              <Plus className="h-3.5 w-3.5" /> Add contact
            </button>
          )}
        </div>
      )}>
      {editing !== null && (
        <ContactForm key={editing === 'new' ? 'new' : String(editing.id)} contact={editing === 'new' ? null : editing}
          onSave={(fields) => save.mutate(fields)} onCancel={() => setEditing(null)} saving={save.isPending} />
      )}
      {isLoading && <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {isError && <p className="px-4 py-4 text-sm text-rose-700">Could not load the contacts.</p>}
      {!isLoading && !isError && (contacts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">No contacts yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {contacts.map((c) => (
            <ContactRow key={c.id ?? 'record'} vendorId={vendorId} contact={c} canEdit={canEdit} onEdit={() => setEditing(c)} />
          ))}
        </ul>
      ))}
    </Section>
  );
}

function LinksSection({ vendorId, canEdit }: { vendorId: number; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tprm-portal-links', vendorId],
    queryFn: async () => (await portalApi.links(vendorId)).data.items,
  });
  const done = () => qc.invalidateQueries({ queryKey: ['tprm-portal-links', vendorId] });
  const fail = (e: unknown) => toast({ type: 'error', title: 'Could not revoke', message: errText(e, 'Try again.') });
  const revoke = useMutation({ mutationFn: (id: number) => portalApi.revokeLink(id), onSuccess: done, onError: fail });
  const revokeAll = useMutation({
    mutationFn: () => portalApi.revokeAll(vendorId),
    onSuccess: (res) => { done(); toast({ type: 'success', title: `${res.data.revoked} link${res.data.revoked === 1 ? '' : 's'} revoked` }); },
    onError: fail,
  });
  const links = data || [];
  const live = links.filter((l) => l.active);
  return (
    <Section title={`Links (${live.length} active)`}
      tip="Every personal link sent to this supplier's contacts, newest first. Only a fingerprint of each is kept, so a lost link cannot be shown again: send a new one."
      action={canEdit && live.length > 0 ? (
        <button type="button" className={quiet} disabled={revokeAll.isPending}
          onClick={() => window.confirm(`Revoke all ${live.length} active links? The supplier's contacts will need new ones.`) && revokeAll.mutate()}>
          Revoke all
        </button>
      ) : undefined}>
      {isLoading && <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {isError && <p className="px-4 py-4 text-sm text-rose-700">Could not load the links.</p>}
      {!isLoading && !isError && (links.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">No links sent yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-900">
                  {l.contact.name || 'Contact'} <span className="text-xs text-slate-500">· {PURPOSE[l.purpose] || l.purpose}</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  {day(l.created_at)}{l.created_by ? ` by ${l.created_by}` : ''} · {l.revoked_at
                    ? `revoked ${day(l.revoked_at)}` : `${l.active ? 'until' : 'expired'} ${day(l.expires_at)}`}
                  {' · '}{l.last_used_at ? `last used ${day(l.last_used_at)} (${l.use_count}×)` : 'not used'}
                </p>
              </div>
              <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium',
                l.active ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#f1f3f5] text-[#4b5563]')}>
                {l.active ? 'Active' : l.revoked_at ? 'Revoked' : 'Expired'}
              </span>
              {canEdit && l.active && (
                <button type="button" className={quiet} disabled={revoke.isPending} onClick={() => revoke.mutate(l.id)}>Revoke</button>
              )}
            </li>
          ))}
        </ul>
      ))}
    </Section>
  );
}

export default function PortalPanel({ vendorId }: { vendorId: number }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit');
  return (
    <div className="space-y-4">
      <ContactsSection vendorId={vendorId} canEdit={canEdit} />
      <LinksSection vendorId={vendorId} canEdit={canEdit} />
    </div>
  );
}
