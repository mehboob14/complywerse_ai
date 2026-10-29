'use client';

// The dialogs of a finding: raise one, accept the risk, close it, reopen it (the kit's centred Dialog), and the two side panels that
// were always there: share it with the vendor, and plan a remediation task by hand. Used by FindingCard, FindingsPanel and FindingsTab.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BTN, BTN_PRIMARY, Dialog, fmt } from '@/app/(dashboard)/vendor-risk/_ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { RightSlidePanel } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { acceptNeedsDate, closeNeeds, isoDay } from '../../../_lib/findingsModel';
import type { FindingRow, RaiseInput } from '../../../_lib/findingsApi';
import { requestsApi, sentNote } from '../../../_lib/requestsApi';
import { DOMAIN_KEYS, DOMAIN_LABELS, SEVERITIES, TREATMENT_TYPES } from './constants';
import { ContactSelect } from './PortalPanel';
import { useUnsavedGuard } from './useUnsavedGuard';

// Explicit hex: the platform CSS repaints slate/white and sizes bare form controls (PITFALLS 31, 100).
export const FIELD = 'w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 py-2 text-sm text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
export const LABEL = 'mb-1 flex items-center gap-1 text-[13px] font-medium text-[#26323d]';
const OPTIONAL = <span className="font-normal text-[#64707e]">(optional)</span>;

/** A labelled field; `tip` is the (i) that holds the explanation. */
export function Field({ id, label, optional, tip, children }: { id: string; label: string; optional?: boolean; tip?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label} {optional && OPTIONAL}
        {tip && <InfoTip text={tip} label={`About ${label}`} />}
      </label>
      {children}
    </div>
  );
}

/** A tick in a card: a choice that deserves a line of its own ("Holds the approval gate"). */
export function CheckCard({ checked, onChange, title, note, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; title: string; note: string; disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#d5dbe1] bg-[#f7f9fa] px-3 py-2.5">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#0f766e]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-[13px] font-medium text-[#1f2933]">{title}</span>
        <span className="block text-[12px] leading-4 text-[#586472]">{note}</span>
      </span>
    </label>
  );
}

const Footer = ({ formId, onClose, busy, disabled, go }: { formId: string; onClose: () => void; busy: boolean; disabled: boolean; go: string }) => (
  <>
    <button type="button" className={BTN} onClick={onClose}>Cancel</button>
    <button type="submit" form={formId} className={BTN_PRIMARY} disabled={busy || disabled}>{go}</button>
  </>
);

// ── raise ────────────────────────────────────────────────────────────────────

const BLANK = { title: '', description: '', severity: 'medium', domain: 'cybersecurity', owner: '' as number | '', blocking: false, engagement: '' as number | '' };
const blank = (engagement?: number | null): typeof BLANK => ({ ...BLANK, engagement: engagement ?? '' });

export function RaiseFindingDialog({ open, onClose, onRaise, busy, people, engagements, defaultEngagementId }: {
  open: boolean; onClose: () => void; busy: boolean;
  onRaise: (input: RaiseInput) => void;
  people: Array<{ id: number; name: string }>;
  /** the vendor's other engagements; empty or left out: the finding is about the vendor itself */
  engagements?: Array<{ id: number; name: string }>;
  defaultEngagementId?: number | null;
}) {
  const formId = useId();
  const [form, setForm] = useState(blank(defaultEngagementId));
  useEffect(() => { if (!open) setForm(blank(defaultEngagementId)); }, [open, defaultEngagementId]);
  const set = <K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const about = engagements && engagements.length > 0;
  return (
    <Dialog open={open} onClose={onClose} title="Raise finding" size={600}
      footer={<Footer formId={formId} onClose={onClose} busy={busy} disabled={!form.title.trim()} go={busy ? 'Raising…' : 'Raise finding'} />}>
      <form id={formId} className="space-y-3.5" onSubmit={(e) => {
        e.preventDefault();
        if (!form.title.trim()) return;
        onRaise({
          title: form.title.trim(), description: form.description.trim() || undefined, severity: form.severity, domain: form.domain,
          owner_id: form.owner === '' ? null : form.owner, is_blocking: form.blocking,
          engagement_id: about && form.engagement !== '' ? form.engagement : undefined,
        });
      }}>
        <Field id={`${formId}-title`} label="What is wrong">
          <input id={`${formId}-title`} className={FIELD} value={form.title} maxLength={255} required data-autofocus
            onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field id={`${formId}-detail`} label="Detail" optional>
          <textarea id={`${formId}-detail`} className={FIELD} rows={3} maxLength={8000} value={form.description}
            onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field id={`${formId}-sev`} label="Severity" tip="The fix is due when the policy says for this severity.">
            <select id={`${formId}-sev`} className={FIELD} value={form.severity} onChange={(e) => set('severity', e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
          <Field id={`${formId}-domain`} label="Domain">
            <select id={`${formId}-domain`} className={FIELD} value={form.domain} onChange={(e) => set('domain', e.target.value)}>
              {DOMAIN_KEYS.map((d) => <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>)}
            </select>
          </Field>
          <Field id={`${formId}-owner`} label="Owner" optional>
            <select id={`${formId}-owner`} className={FIELD} value={form.owner} onChange={(e) => set('owner', e.target.value ? Number(e.target.value) : '')}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {about && (
            <Field id={`${formId}-for`} label="About" tip="The whole vendor, or one of its engagements. A finding on the vendor counts for every engagement.">
              <select id={`${formId}-for`} className={FIELD} value={form.engagement} onChange={(e) => set('engagement', e.target.value ? Number(e.target.value) : '')}>
                <option value="">The vendor (General)</option>
                {engagements!.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <CheckCard checked={form.blocking} onChange={(v) => set('blocking', v)} title="Holds the approval gate"
          note="The vendor cannot be approved until this is fixed, accepted or closed." />
      </form>
    </Dialog>
  );
}

// ── accept, close, reopen ────────────────────────────────────────────────────

type Subject = Pick<FindingRow, 'title' | 'severity'>;

const Heading = ({ f }: { f: Subject }) => <p className="mb-3 text-[13px] leading-5 text-[#586472]">{f.title || 'Untitled finding'}</p>;

export function AcceptDialog({ open, onClose, finding, busy, onAccept }: {
  open: boolean; onClose: () => void; finding: Subject; busy: boolean;
  onAccept: (input: { rationale: string; expiry?: string }) => void;
}) {
  const formId = useId();
  const [until, setUntil] = useState('');
  const [why, setWhy] = useState('');
  useEffect(() => { if (!open) { setUntil(''); setWhy(''); } }, [open]);
  const needsDate = acceptNeedsDate(finding.severity);
  const ready = !!why.trim() && (!needsDate || !!until);
  return (
    <Dialog open={open} onClose={onClose} title="Accept this risk?"
      footer={<Footer formId={formId} onClose={onClose} busy={busy} disabled={!ready} go={busy ? 'Saving…' : until ? `Accept until ${fmt.date(until)}` : 'Accept risk'} />}>
      <form id={formId} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready) onAccept({ rationale: why.trim(), expiry: until || undefined }); }}>
        <Heading f={finding} />
        <Field id={`${formId}-until`} label="Accepted until" optional={!needsDate}
          tip={needsDate ? 'The finding reopens when this date passes. Required for a critical or high finding.' : 'The finding reopens when this date passes. Leave it empty to accept it with no end date.'}>
          <input id={`${formId}-until`} type="date" className={FIELD} min={isoDay(1)} value={until} required={needsDate} data-autofocus
            onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Field id={`${formId}-why`} label="Rationale" tip="Compensating controls and when to look again. It is recorded with your sign-off.">
          <textarea id={`${formId}-why`} className={FIELD} rows={4} maxLength={4000} required value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

export function CloseDialog({ open, onClose, finding, busy, onCloseFinding }: {
  open: boolean; onClose: () => void; finding: Subject & Pick<FindingRow, 'is_blocking' | 'is_critical_control_fail' | 'fix_done'>; busy: boolean;
  onCloseFinding: (note: string) => void;
}) {
  const formId = useId();
  const [note, setNote] = useState('');
  useEffect(() => { if (!open) setNote(''); }, [open]);
  const needs = closeNeeds(finding);
  return (
    <Dialog open={open} onClose={onClose} title="Close this finding?" description="Close only if fixed. To live with it, accept the risk."
      footer={<Footer formId={formId} onClose={onClose} busy={busy} disabled={!!needs && !note.trim()} go={busy ? 'Closing…' : 'Close finding'} />}>
      <form id={formId} onSubmit={(e) => { e.preventDefault(); if (!needs || note.trim()) onCloseFinding(note.trim()); }}>
        <Heading f={finding} />
        <Field id={`${formId}-note`} label="What was done" optional={!needs}>
          <textarea id={`${formId}-note`} className={FIELD} rows={4} maxLength={4000} required={!!needs} value={note} data-autofocus
            placeholder="MFA enabled on the admin console, screenshot received" onChange={(e) => setNote(e.target.value)} />
        </Field>
        {needs && <p className="mt-1 text-[12px] leading-4 text-[#586472]">{needs}</p>}
      </form>
    </Dialog>
  );
}

export function ReopenDialog({ open, onClose, finding, busy, onReopen }: {
  open: boolean; onClose: () => void; finding: Subject; busy: boolean; onReopen: (reason: string) => void;
}) {
  const formId = useId();
  const [why, setWhy] = useState('');
  useEffect(() => { if (!open) setWhy(''); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title="Reopen this finding?" description="It goes back on the open list and counts again."
      footer={<Footer formId={formId} onClose={onClose} busy={busy} disabled={!why.trim()} go={busy ? 'Reopening…' : 'Reopen finding'} />}>
      <form id={formId} onSubmit={(e) => { e.preventDefault(); if (why.trim()) onReopen(why.trim()); }}>
        <Heading f={finding} />
        <Field id={`${formId}-why`} label="Why">
          <textarea id={`${formId}-why`} className={FIELD} rows={3} maxLength={4000} required value={why} data-autofocus
            placeholder="The fix was rolled back in the last release" onChange={(e) => setWhy(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

// ── share with the vendor, and plan a remediation task by hand (side panels, as they were) ──

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export function ShareFindingPanel({ finding, onClose }: { finding: Pick<FindingRow, 'id' | 'vendor_id' | 'title' | 'description'>; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: finding.title || '', note: finding.description || '', due_date: isoDay(30), contact_id: null as number | null,
  });
  useUnsavedGuard(form.title !== (finding.title || '') || form.note !== (finding.description || ''));
  const share = useMutation({
    mutationFn: () => requestsApi.shareFinding(finding.id, {
      title: form.title.trim() || undefined, note: form.note.trim() || undefined, due_date: form.due_date,
      contact_id: form.contact_id,
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tprm-supplier-requests', finding.vendor_id] });
      const sent = sentNote(res.data.sent);
      toast({ type: sent.ok ? 'success' : 'warning', title: 'Shared with the vendor', message: sent.text });
      onClose();
    },
    onError: (e) => toast({ type: 'error', title: 'Not shared', message: apiErrorText(e, 'Try again.') }),
  });
  return (
    <RightSlidePanel isOpen onClose={onClose} title="Share with vendor" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form={`tpra-share-form-${finding.id}`} type="submit" disabled={share.isPending}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {share.isPending ? 'Sharing…' : 'Share'}
          </button>
        </div>
      }>
      <form id={`tpra-share-form-${finding.id}`} onSubmit={(e) => { e.preventDefault(); share.mutate(); }} className="space-y-4">
        <div>
          <label htmlFor={`share-title-${finding.id}`} className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-700">
            Title <InfoTip text="The vendor sees this title and the text below, and is asked for a plan, a date and evidence. Never the severity or scores." />
          </label>
          <input id={`share-title-${finding.id}`} className={inputCls} maxLength={255} required value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`share-note-${finding.id}`} className="mb-1 block text-xs font-medium text-gray-700">What the vendor reads</label>
          <textarea id={`share-note-${finding.id}`} className={inputCls} rows={5} maxLength={8000} value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`share-due-${finding.id}`} className="mb-1 block text-xs font-medium text-gray-700">Due</label>
            <input id={`share-due-${finding.id}`} type="date" className={inputCls} required min={isoDay(0)} value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`share-to-${finding.id}`} className="mb-1 block text-xs font-medium text-gray-700">Send to</label>
            <ContactSelect id={`share-to-${finding.id}`} vendorId={finding.vendor_id} value={form.contact_id}
              onChange={(id) => setForm({ ...form, contact_id: id })} />
          </div>
        </div>
      </form>
    </RightSlidePanel>
  );
}

export function AddRemediationPanel({
  open, onClose, onSubmit, busy,
}: { open: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; busy: boolean }) {
  const [form, setForm] = useState({ title: '', plan: '', treatment_type: 'remediate', due_date: '' });
  useUnsavedGuard(open && (!!form.title || !!form.plan));
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title="Add remediation task" width="w-full max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button form="tpra-rem-form" type="submit" disabled={busy}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Adding…' : 'Add task'}
          </button>
        </div>
      }>
      <form id="tpra-rem-form" onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, due_date: form.due_date || undefined });
      }} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Task</label>
          <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Treatment</label>
            <select className={inputCls} value={form.treatment_type} onChange={(e) => setForm({ ...form, treatment_type: e.target.value })}>
              {TREATMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Due date</label>
            <input type="date" className={inputCls} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Plan</label>
          <textarea className={inputCls} rows={3} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
        </div>
      </form>
    </RightSlidePanel>
  );
}
