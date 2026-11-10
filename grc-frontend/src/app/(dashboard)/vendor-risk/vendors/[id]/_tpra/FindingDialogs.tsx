'use client';

// The sheets of a finding: raise one, accept the risk, close it, reopen it, share it with the vendor, and plan a remediation task by hand. Used by the one finding card and the one finding list
// (the register's drawer, the vendor record's Findings tab, the lifecycle's Findings stage). Rebuilt on the kit (vendor-intake-findings, 2026-11-10): each is a Sheet that asks before typed words
// are thrown away; a failed save is said in the sheet, once, with what the server said and a Retry, and the confirmation is a toast. `FIELD`, `LABEL`, `Field` and `CheckCard` stay as they were
// (findingFields.tsx): the Signals panel (another group's) draws its forms with them.
import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, FormError, FormField, Select, Sheet, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { acceptNeedsDate, closeNeeds, isoDay } from '../../../_lib/findingCardModel';
import type { FindingRow, RaiseInput } from '../../../_lib/findingsApi';
import { portalApi } from '../../../_lib/portalApi';
import { requestsApi, sentNote } from '../../../_lib/requestsApi';
import { DOMAIN_KEYS, DOMAIN_LABELS, SEVERITIES, TREATMENT_TYPES } from './constants';

export { CheckCard, FIELD, Field, LABEL } from './findingFields';

function Footer({ form, onClose, busy, disabled, go }: { form: string; onClose: () => void; busy: boolean; disabled: boolean; go: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-[8px]">
      <Button onClick={onClose}>Cancel</Button>
      <Button type="submit" form={form} variant="primary" disabled={disabled} loading={busy}>{go}</Button>
    </div>
  );
}

const Subject = ({ finding }: { finding: Pick<FindingRow, 'title'> }) => <p className="text-ds-body text-ds-fg-muted">{finding.title || 'Untitled finding'}</p>;

// ── raise ────────────────────────────────────────────────────────────────────

const BLANK = { title: '', description: '', severity: 'medium', domain: 'cybersecurity', owner: '' as number | '', blocking: false, engagement: '' as number | '' };
const blank = (engagement?: number | null): typeof BLANK => ({ ...BLANK, engagement: engagement ?? '' });
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

export function RaiseFindingDialog({ open, onClose, onRaise, busy, error, people, engagements, defaultEngagementId }: {
  open: boolean; onClose: () => void; busy: boolean;
  onRaise: (input: RaiseInput) => void;
  /** why the last try failed (what the request threw), said in the sheet */
  error?: unknown;
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
  const submit = () => {
    if (!form.title.trim()) return;
    onRaise({
      title: form.title.trim(), description: form.description.trim() || undefined, severity: form.severity, domain: form.domain,
      owner_id: form.owner === '' ? null : form.owner, is_blocking: form.blocking,
      engagement_id: about && form.engagement !== '' ? form.engagement : undefined,
    });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Raise finding" width="md" dirty={!busy && (form.title.trim() !== '' || form.description.trim() !== '')}
      footer={<Footer form={formId} onClose={onClose} busy={busy} disabled={!form.title.trim()} go="Raise finding" />}>
      <form id={formId} className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormError title="The finding could not be raised" error={error ?? null} onRetry={submit} />
        <FormField label="What is wrong" required>
          <TextInput maxLength={255} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </FormField>
        <FormField label="Detail" optional>
          <Textarea rows={3} maxLength={8000} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Severity" info="The fix is due when the policy says for this severity.">
            <Select value={form.severity} onChange={(e) => set('severity', e.target.value)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </Select>
          </FormField>
          <FormField label="Domain">
            <Select value={form.domain} onChange={(e) => set('domain', e.target.value)}>
              {DOMAIN_KEYS.map((d) => <option key={d} value={d}>{DOMAIN_LABELS[d]}</option>)}
            </Select>
          </FormField>
          <FormField label="Owner" optional>
            <Select value={form.owner} onChange={(e) => set('owner', e.target.value ? Number(e.target.value) : '')}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FormField>
          {about && (
            <FormField label="About" info="The whole vendor, or one of its engagements.">
              <Select value={form.engagement} onChange={(e) => set('engagement', e.target.value ? Number(e.target.value) : '')}>
                <option value="">The vendor (General)</option>
                {engagements!.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </FormField>
          )}
        </div>
        <label className="flex cursor-pointer items-start gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <Checkbox checked={form.blocking} onChange={(e) => set('blocking', e.target.checked)} />
          <span>
            <span className="block text-ds-body font-[600] text-ds-fg">Holds the approval gate</span>
            <span className="block text-ds-label text-ds-fg-muted">The vendor cannot be approved until this is fixed, accepted or closed.</span>
          </span>
        </label>
      </form>
    </Sheet>
  );
}

// ── accept, close, reopen ────────────────────────────────────────────────────

type Subj = Pick<FindingRow, 'title' | 'severity'>;

export function AcceptDialog({ open, onClose, finding, busy, error, onAccept }: {
  open: boolean; onClose: () => void; finding: Subj; busy: boolean; error?: unknown;
  onAccept: (input: { rationale: string; expiry?: string }) => void;
}) {
  const formId = useId();
  const [until, setUntil] = useState('');
  const [why, setWhy] = useState('');
  useEffect(() => { if (!open) { setUntil(''); setWhy(''); } }, [open]);
  const needsDate = acceptNeedsDate(finding.severity);
  const ready = !!why.trim() && (!needsDate || !!until);
  const submit = () => { if (ready) onAccept({ rationale: why.trim(), expiry: until || undefined }); };
  return (
    <Sheet open={open} onClose={onClose} title="Accept this risk?" width="sm" dirty={!busy && (why.trim() !== '' || until !== '')}
      footer={<Footer form={formId} onClose={onClose} busy={busy} disabled={!ready} go={until ? `Accept until ${formatDate(until, { calendar: true })}` : 'Accept risk'} />}>
      <form id={formId} className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Subject finding={finding} />
        <FormError title="The risk could not be accepted" error={error ?? null} onRetry={submit} />
        <FormField label="Accepted until" required={needsDate} optional={!needsDate}
          info={needsDate ? 'The finding reopens when this date passes. Required for a critical or high finding.' : 'The finding reopens when this date passes. Leave it empty to accept it with no end date.'}>
          <TextInput type="date" min={isoDay(1)} value={until} onChange={(e) => setUntil(e.target.value)} />
        </FormField>
        <FormField label="Rationale" required info="Compensating controls and when to look again. It is recorded with your sign-off.">
          <Textarea rows={4} maxLength={4000} value={why} onChange={(e) => setWhy(e.target.value)} />
        </FormField>
      </form>
    </Sheet>
  );
}

export function CloseDialog({ open, onClose, finding, busy, error, onCloseFinding }: {
  open: boolean; onClose: () => void; finding: Subj & Pick<FindingRow, 'is_blocking' | 'is_critical_control_fail' | 'fix_done'>; busy: boolean; error?: unknown;
  onCloseFinding: (note: string) => void;
}) {
  const formId = useId();
  const [note, setNote] = useState('');
  useEffect(() => { if (!open) setNote(''); }, [open]);
  const needs = closeNeeds(finding);
  const ready = !needs || !!note.trim();
  const submit = () => { if (ready) onCloseFinding(note.trim()); };
  return (
    <Sheet open={open} onClose={onClose} title="Close this finding?" subtitle="Close only if fixed. To live with it, accept the risk." width="sm" dirty={!busy && note.trim() !== ''}
      footer={<Footer form={formId} onClose={onClose} busy={busy} disabled={!ready} go="Close finding" />}>
      <form id={formId} className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Subject finding={finding} />
        <FormError title="The finding could not be closed" error={error ?? null} onRetry={submit} />
        <FormField label="What was done" required={!!needs} optional={!needs} hint={needs ?? undefined}>
          <Textarea rows={4} maxLength={4000} value={note} placeholder="MFA enabled on the admin console, screenshot received" onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </form>
    </Sheet>
  );
}

export function ReopenDialog({ open, onClose, finding, busy, error, onReopen }: {
  open: boolean; onClose: () => void; finding: Pick<FindingRow, 'title'>; busy: boolean; error?: unknown; onReopen: (reason: string) => void;
}) {
  const formId = useId();
  const [why, setWhy] = useState('');
  useEffect(() => { if (!open) setWhy(''); }, [open]);
  const submit = () => { if (why.trim()) onReopen(why.trim()); };
  return (
    <Sheet open={open} onClose={onClose} title="Reopen this finding?" subtitle="It goes back on the open list and counts again." width="sm" dirty={!busy && why.trim() !== ''}
      footer={<Footer form={formId} onClose={onClose} busy={busy} disabled={!why.trim()} go="Reopen finding" />}>
      <form id={formId} className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Subject finding={finding} />
        <FormError title="The finding could not be reopened" error={error ?? null} onRetry={submit} />
        <FormField label="Why" required>
          <Textarea rows={3} maxLength={4000} value={why} placeholder="The fix was rolled back in the last release" onChange={(e) => setWhy(e.target.value)} />
        </FormField>
      </form>
    </Sheet>
  );
}

// ── share with the vendor, and plan a remediation task by hand ──────────────────────────────────────────────────────

function ContactChoice({ vendorId, value, onChange }: { vendorId: number; value: number | null; onChange: (id: number | null) => void }) {
  const { data } = useQuery({ queryKey: ['tprm-contacts', vendorId, false], queryFn: async () => (await portalApi.contacts(vendorId, false)).data.items });
  const reachable = (data || []).filter((c) => c.id !== null && c.email && c.portal_access && !c.archived_at);
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">All contacts</option>
      {reachable.map((c) => <option key={c.id} value={c.id as number}>{c.name}</option>)}
    </Select>
  );
}

export function ShareFindingPanel({ finding, onClose }: { finding: Pick<FindingRow, 'id' | 'vendor_id' | 'title' | 'description'>; onClose: () => void }) {
  const qc = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState({ title: finding.title || '', note: finding.description || '', due_date: isoDay(30), contact_id: null as number | null });
  const [problem, setProblem] = useState<unknown>(null);
  const touched = form.title !== (finding.title || '') || form.note !== (finding.description || '');
  const share = useReportedMutation({
    mutationFn: async () => (await requestsApi.shareFinding(finding.id, {
      title: form.title.trim() || undefined, note: form.note.trim() || undefined, due_date: form.due_date, contact_id: form.contact_id,
    })).data,
    success: (made) => ({ title: 'Shared with the vendor', message: sentNote(made.sent).text }),
    failure: 'Not shared',
    toast: 'success',
    onError: (e) => setProblem(e),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tprm-supplier-requests', finding.vendor_id] }); onClose(); },
  });
  const ready = !!form.title.trim() && !!form.due_date;
  return (
    <Sheet open onClose={onClose} title="Share with vendor" width="md" dirty={touched && !share.isPending}
      footer={<Footer form={formId} onClose={onClose} busy={share.isPending} disabled={!ready} go="Share" />}>
      <form id={formId} className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (ready) { setProblem(null); share.mutate(); } }}>
        <FormError title="The finding could not be shared" error={problem} onRetry={() => { setProblem(null); share.mutate(); }} />
        <FormField label="Title" required info="The vendor sees this title and the text below, and is asked for a plan, a date and evidence. Never the severity or scores.">
          <TextInput maxLength={255} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </FormField>
        <FormField label="What the vendor reads">
          <Textarea rows={5} maxLength={8000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Due" required>
            <TextInput type="date" min={isoDay(0)} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </FormField>
          <FormField label="Send to">
            <ContactChoice vendorId={finding.vendor_id} value={form.contact_id} onChange={(id) => setForm({ ...form, contact_id: id })} />
          </FormField>
        </div>
      </form>
    </Sheet>
  );
}

export function AddRemediationPanel({
  open, onClose, onSubmit, busy, error,
}: { open: boolean; onClose: () => void; onSubmit: (p: Record<string, unknown>) => void; busy: boolean; error?: unknown }) {
  const formId = useId();
  const [form, setForm] = useState({ title: '', plan: '', treatment_type: 'remediate', due_date: '' });
  useEffect(() => { if (!open) setForm({ title: '', plan: '', treatment_type: 'remediate', due_date: '' }); }, [open]);
  const submit = () => { if (form.title.trim()) onSubmit({ ...form, title: form.title.trim(), due_date: form.due_date || undefined }); };
  return (
    <Sheet open={open} onClose={onClose} title="Add remediation task" width="md" dirty={!busy && (form.title.trim() !== '' || form.plan.trim() !== '')}
      footer={<Footer form={formId} onClose={onClose} busy={busy} disabled={!form.title.trim()} go="Add task" />}>
      <form id={formId} className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormError title="The task could not be added" error={error ?? null} onRetry={submit} />
        <FormField label="Task" required>
          <TextInput maxLength={255} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Treatment">
            <Select value={form.treatment_type} onChange={(e) => setForm({ ...form, treatment_type: e.target.value })}>
              {TREATMENT_TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </Select>
          </FormField>
          <FormField label="Due date" optional>
            <TextInput type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Plan" optional>
          <Textarea rows={3} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} />
        </FormField>
      </form>
    </Sheet>
  );
}
