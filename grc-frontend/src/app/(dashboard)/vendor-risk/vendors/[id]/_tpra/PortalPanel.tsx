'use client';

// Supplier portal tab of a supplier: its contacts, what we asked it for and its answers,
// our messages with it (internal or shared), and the personal links sent to it.

import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Archive, Check, Copy, Loader2, Mail, Paperclip, Pencil, Plus, RotateCcw, Send, Star, Undo2 } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import { InfoTip } from '@/components/ui/InfoTip';
import { RightSlidePanel } from '@/components/ui';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';
import { Segmented, fmtDate, inDays } from '@/app/(dashboard)/governance/regulatory-changes/_ui';
import { parseUtc } from '@/lib/serverTime';
import {
  CONTACT_ROLES, absoluteLink, portalApi, type ContactFields, type ContactRole, type PortalLink, type SupplierContact,
} from '../../../_lib/portalApi';
import {
  REQUEST_STATUS, requestsApi, sentNote, type FindingAction, type RequestFile, type RequestKind, type RequestStatus,
  type SupplierRequest, type ThreadType,
} from '../../../_lib/requestsApi';

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
  supplier_request: 'Request', message: 'Message',
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

// ── requests and messages ────────────────────────────────────────────────────

const ON = 'bg-primary-50 text-[#0f766e]';
const KIND_LABEL: Record<RequestKind, string> = { document: 'Document', information: 'Information', finding: 'Finding' };
const KIND_OPTIONS = [{ value: 'document', label: 'Document', tone: ON }, { value: 'information', label: 'Information', tone: ON }];
const WHO_OPTIONS = [
  { value: 'internal', label: 'Internal', tone: 'bg-[#fffbeb] text-[#92400e]' }, { value: 'shared', label: 'Shared', tone: ON },
];
const FINDING_OPTIONS = [
  { value: 'keep', label: 'Leave it', tone: ON }, { value: 'plan', label: 'Record plan', tone: ON },
  { value: 'close', label: 'Close it', tone: ON },
];
const LIVE: RequestStatus[] = ['open', 'submitted', 'returned'];
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50';
const coverage = (f: RequestFile) => [
  f.coverage_from || f.coverage_to ? `Covers ${f.coverage_from ? fmtDate(f.coverage_from) : '…'} to ${f.coverage_to ? fmtDate(f.coverage_to) : '…'}` : '',
  f.expiry_date ? `expires ${fmtDate(f.expiry_date)}` : '',
].filter(Boolean).join(' · ') || 'No dates given';

function StatusChip({ status }: { status: RequestStatus }) {
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', REQUEST_STATUS[status].tone)}>{REQUEST_STATUS[status].label}</span>;
}

/** Who a request or a shared message goes to: one contact, or all who can get a link. */
export function ContactSelect({ vendorId, value, onChange, className, id }: {
  vendorId: number; value: number | null; onChange: (id: number | null) => void; className?: string; id?: string;
}) {
  const { data } = useQuery({
    queryKey: ['tprm-contacts', vendorId, false],
    queryFn: async () => (await portalApi.contacts(vendorId, false)).data.items,
  });
  const reachable = (data || []).filter((c) => c.id !== null && c.email && c.portal_access && !c.archived_at);
  return (
    <select id={id} className={clsx(input, className)} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">All contacts</option>
      {reachable.map((c) => <option key={c.id} value={c.id as number}>{c.name}</option>)}
    </select>
  );
}

function Thread({ vendorId, subjectType, subjectId, canEdit }: {
  vendorId: number; subjectType: ThreadType; subjectId?: number; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ['tprm-messages', vendorId, subjectType, subjectId ?? null];
  const [body, setBody] = useState('');
  const [who, setWho] = useState<'internal' | 'shared'>('internal');
  const { data, isLoading, isError } = useQuery({
    queryKey: key, queryFn: async () => (await requestsApi.messages(vendorId, subjectType, subjectId)).data.items,
  });
  const send = useMutation({
    mutationFn: () => requestsApi.sendMessage(vendorId, { subject_type: subjectType, subject_id: subjectId, visibility: who, body }),
    onSuccess: (res) => {
      setBody('');
      qc.invalidateQueries({ queryKey: key });
      if (who === 'shared') {
        const note = sentNote(res.data.sent);
        toast({ type: note.ok ? 'success' : 'warning', title: 'Sent to supplier', message: note.text });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'Not sent', message: errText(e, 'Try again.') }),
  });
  const messages = data || [];
  return (
    <div>
      {isLoading && <p className="flex items-center gap-2 px-4 py-3 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {isError && <p className="px-4 py-3 text-sm text-rose-700">Could not load the messages.</p>}
      {!isLoading && !isError && (messages.length === 0 ? (
        <p className="px-4 py-4 text-center text-sm text-slate-500">No messages yet.</p>
      ) : (
        <ul className="space-y-2 px-4 py-3">
          {messages.map((m) => (
            <li key={m.id} className={clsx('rounded-lg border px-3 py-2', m.from_supplier ? 'border-slate-200 bg-white'
              : m.visibility === 'internal' ? 'border-[#fde68a] bg-[#fffbeb]' : 'border-primary-100 bg-primary-50/40')}>
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-medium text-slate-700">{m.author || 'System'}</span>
                <span>{m.from_supplier ? 'Supplier' : m.visibility === 'internal' ? 'Internal' : 'Shared'}</span>
                <span>· {day(m.created_at)}</span>
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-800">{m.body}</p>
            </li>
          ))}
        </ul>
      ))}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }} className="space-y-2 border-t border-slate-100 px-4 py-3">
          <textarea className={input} rows={2} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)}
            aria-label="Message" placeholder={who === 'shared' ? 'The supplier reads this' : 'Only we read this'} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented label="Who reads it" value={who} options={WHO_OPTIONS} onChange={(v) => setWho(v as 'internal' | 'shared')} />
            <button type="submit" disabled={!body.trim() || send.isPending} className={primaryBtn}>
              {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {who === 'shared' ? 'Send' : 'Add note'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function NewRequestForm({ vendorId, kinds, onDone }: {
  vendorId: number; kinds: { key: string; label: string }[]; onDone: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [f, setF] = useState({
    kind: 'document' as 'document' | 'information', evidence_kind: '', title: '', detail: '', due_date: inDays(14),
    contact_id: null as number | null,
  });
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const create = useMutation({
    mutationFn: () => requestsApi.create(vendorId, {
      ...f, evidence_kind: f.kind === 'document' ? f.evidence_kind || null : null, title: f.title || null,
      detail: f.detail || null, due_date: f.due_date || null,
    }),
    onSuccess: (res) => {
      ['tprm-supplier-requests', 'tprm-portal-links', 'tprm-contacts'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));
      const note = sentNote(res.data.sent);
      toast({ type: note.ok ? 'success' : 'warning', title: 'Request sent', message: note.text });
      onDone();
    },
    onError: (e) => toast({ type: 'error', title: 'Not sent', message: errText(e, 'Try again.') }),
  });
  const typed = kinds.find((k) => k.key === f.evidence_kind)?.label;
  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3 border-b border-slate-100 bg-primary-50/40 px-4 py-4">
      <Segmented label="Ask for" value={f.kind} options={KIND_OPTIONS} onChange={(v) => set({ kind: v as 'document' | 'information' })} />
      <div className="grid gap-3 sm:grid-cols-2">
        {f.kind === 'document' && (
          <label className="block text-xs font-medium text-slate-600">Evidence type
            <select className={clsx(input, 'mt-1')} value={f.evidence_kind} onChange={(e) => set({ evidence_kind: e.target.value })}>
              <option value="">None</option>
              {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
        )}
        <label className={clsx('block text-xs font-medium text-slate-600', f.kind !== 'document' && 'sm:col-span-2')}>Title
          <input className={clsx(input, 'mt-1')} maxLength={255} required={!typed} placeholder={typed || ''}
            value={f.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
      </div>
      <label className="block text-xs font-medium text-slate-600">Details
        <textarea className={clsx(input, 'mt-1')} rows={3} maxLength={8000} value={f.detail} onChange={(e) => set({ detail: e.target.value })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600">Due
          <input type="date" className={clsx(input, 'mt-1')} min={inDays(0)} value={f.due_date} onChange={(e) => set({ due_date: e.target.value })} />
        </label>
        <label className="block text-xs font-medium text-slate-600">Send to
          <ContactSelect vendorId={vendorId} value={f.contact_id} onChange={(id) => set({ contact_id: id })} className="mt-1" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={create.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Send
        </button>
      </div>
    </form>
  );
}

function ReviewDrawer({ vendorId, r, canEdit, onClose }: {
  vendorId: number; r: SupplierRequest; canEdit: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [finding, setFinding] = useState<FindingAction>('keep');
  const done = () => {
    ['tprm-supplier-requests', 'tprm-paperwork'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));
    qc.invalidateQueries({ queryKey: ['tprm-messages', vendorId, 'request', r.id] });
    qc.invalidateQueries({ predicate: (q) => ['tpra-findings', 'tpra-finding', 'tpra-lifecycle'].includes(String(q.queryKey[0])) });
    setNote('');
  };
  const fail = (title: string) => (e: unknown) => toast({ type: 'error', title, message: errText(e, 'Try again.') });
  const accept = useMutation({
    mutationFn: () => requestsApi.accept(vendorId, r.id, { note: note.trim() || undefined, finding }),
    onSuccess: () => { done(); toast({ type: 'success', title: 'Accepted' }); }, onError: fail('Not accepted'),
  });
  const sendBack = useMutation({
    mutationFn: () => requestsApi.sendBack(vendorId, r.id, note),
    onSuccess: (res) => {
      done();
      const sent = sentNote(res.data.sent);
      toast({ type: sent.ok ? 'success' : 'warning', title: 'Returned', message: sent.text });
    },
    onError: fail('Not returned'),
  });
  const cancel = useMutation({
    mutationFn: () => requestsApi.cancel(vendorId, r.id),
    onSuccess: () => { done(); toast({ type: 'success', title: 'Request cancelled' }); }, onError: fail('Not cancelled'),
  });
  const busy = accept.isPending || sendBack.isPending || cancel.isPending;
  const settles = r.kind === 'finding' && !!r.finding && !r.finding.removed && ['open', 'in_remediation'].includes(r.finding.status);
  const footer = !canEdit || !LIVE.includes(r.status) ? undefined : r.status === 'submitted' ? (
    <div className="space-y-2">
      <textarea className={input} rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)}
        aria-label="Review note" placeholder="Note (needed to return it)" />
      {settles && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          Finding
          <Segmented label="What happens to the finding" value={finding} options={FINDING_OPTIONS}
            onChange={(v) => setFinding(v as FindingAction)} />
          <InfoTip text="Record plan adds the supplier's plan as a remediation due on its date. Close it also completes that remediation and closes the finding: only once the fix is verified." />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className={quiet} disabled={busy || !note.trim()} onClick={() => sendBack.mutate()}>
          <Undo2 className="h-3.5 w-3.5" /> Return
        </button>
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => accept.mutate()}>
          {accept.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accept
        </button>
      </div>
    </div>
  ) : (
    <div className="flex justify-end">
      <button type="button" className={quiet} disabled={busy}
        onClick={() => window.confirm('Cancel this request? The supplier will no longer be asked for it.') && cancel.mutate()}>
        Cancel request
      </button>
    </div>
  );
  return (
    <RightSlidePanel isOpen onClose={onClose} title={r.title} subtitle={`${KIND_LABEL[r.kind]} · ${REQUEST_STATUS[r.status].label}`}
      width="w-full max-w-lg" footer={footer}>
      <div className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">Asked</dt>
          <dd className="text-slate-800">{day(r.requested_at)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}</dd>
          <dt className="text-slate-500">Due</dt>
          <dd className={r.overdue ? 'font-medium text-[#b91c1c]' : 'text-slate-800'}>{r.due_date ? fmtDate(r.due_date) : 'No date'}{r.overdue ? ' · overdue' : ''}</dd>
          <dt className="text-slate-500">To</dt>
          <dd className="text-slate-800">{r.contact?.name || 'All contacts'}</dd>
          {r.evidence_label && <><dt className="text-slate-500">Type</dt><dd className="text-slate-800">{r.evidence_label}</dd></>}
          {r.finding && (
            <><dt className="text-slate-500">Finding</dt>
              <dd className="text-slate-800">{r.finding.title || 'Finding'} · {r.finding.severity} · {r.finding.removed ? 'removed' : r.finding.status.replace('_', ' ')}</dd></>
          )}
        </dl>
        {r.detail && <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{r.detail}</p>}
        {r.responded_at && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="text-[11px] text-slate-500"><span className="font-semibold uppercase tracking-wide">Answer</span> · {r.responded_by || 'Supplier'} · {day(r.responded_at)}</p>
            {r.response_text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{r.response_text}</p>}
            {r.plan_text && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800"><span className="font-medium">Plan: </span>{r.plan_text}</p>}
            {r.target_date && <p className="mt-1 text-xs text-slate-600">Fixed by {fmtDate(r.target_date)}</p>}
          </div>
        )}
        {r.files.length > 0 && (
          <ul className="space-y-1.5" aria-label="Files">
            {r.files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                <Paperclip className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-slate-800">{f.file_name}</span>
                  <span className="block text-[11px] text-slate-500">{coverage(f)}</span>
                </span>
                {f.link_id && <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#047857]">In paperwork</span>}
                <EvidencePreviewButton evidenceId={f.evidence_id} label="View" />
              </li>
            ))}
          </ul>
        )}
        {r.review_note && r.reviewed_at && (
          <p className="text-xs text-slate-600">
            <span className="font-medium">{r.status === 'returned' ? 'Returned' : 'Note'}:</span> {r.review_note}
            <span className="text-slate-500"> · {r.reviewed_by_name || 'Reviewer'}, {day(r.reviewed_at)}</span>
          </p>
        )}
        <div className="rounded-xl border border-slate-200">
          <h4 className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Messages</h4>
          <Thread vendorId={vendorId} subjectType="request" subjectId={r.id} canEdit={canEdit} />
        </div>
      </div>
    </RightSlidePanel>
  );
}

function RequestsSection({ vendorId, canEdit }: { vendorId: number; canEdit: boolean }) {
  const params = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(() => Number(params?.get('request')) || null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tprm-supplier-requests', vendorId], queryFn: async () => (await requestsApi.list(vendorId)).data,
  });
  const items = data?.items || [];
  const shown = items.find((r) => r.id === openId);
  return (
    <Section title={`Requests (${items.filter((r) => LIVE.includes(r.status)).length} open)`}
      tip="Documents and answers asked of this supplier, and findings shared with it. It answers in its portal; a sent document becomes its paperwork once you accept it."
      action={canEdit && !adding ? (
        <button type="button" onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700">
          <Plus className="h-3.5 w-3.5" /> New request
        </button>
      ) : undefined}>
      {adding && <NewRequestForm vendorId={vendorId} kinds={data?.evidence_kinds || []} onDone={() => setAdding(false)} />}
      {isLoading && <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {isError && <p className="px-4 py-4 text-sm text-rose-700">Could not load the requests.</p>}
      {!isLoading && !isError && (items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">No requests yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-900">{r.title}</span>
                  <span className="block text-[11px] text-slate-500">
                    {KIND_LABEL[r.kind]} · {r.contact?.name || 'All contacts'}{r.due_date ? ` · due ${fmtDate(r.due_date)}` : ''}
                    {r.files.length ? ` · ${r.files.length} file${r.files.length === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                {r.overdue && <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[11px] font-medium text-[#b91c1c]">Overdue</span>}
                <StatusChip status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      ))}
      {shown && <ReviewDrawer key={shown.id} vendorId={vendorId} r={shown} canEdit={canEdit} onClose={() => setOpenId(null)} />}
    </Section>
  );
}

export default function PortalPanel({ vendorId }: { vendorId: number }) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit');
  return (
    <div className="space-y-4">
      <ContactsSection vendorId={vendorId} canEdit={canEdit} />
      <RequestsSection vendorId={vendorId} canEdit={canEdit} />
      <Section title="Messages" tip="Notes stay internal unless you choose Shared. The supplier reads shared messages in its portal and is emailed a link.">
        <Thread vendorId={vendorId} subjectType="vendor" canEdit={canEdit} />
      </Section>
      <LinksSection vendorId={vendorId} canEdit={canEdit} />
    </div>
  );
}
