'use client';

// "Send a questionnaire": the questionnaire, the supplier (any supplier in use: the picker holds all of them, not the first hundred), an assessment to link it to, and who answers. The contact is emailed a
// personal link to the supplier portal and the link is shown here once. A certificate the supplier has on file can answer the questions the questionnaire lets it. The rights and the payload are the old
// send panel's; the words are the person's (an assessment is "Annual assessment, in progress", never a number).
import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2 } from 'lucide-react';
import { Button, Combobox, FormError, FormField, Notice, Select, Sheet, TextInput, useReportedMutation, type ListOption } from '@/components/ui/ds';
import { vendorRiskApi } from '@/lib/api';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDate, statusLabel } from '@/lib/format';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { absoluteLink, portalApi } from '../../_lib/portalApi';
import { SENT_REFRESH, useVendorOptions } from './sentApi';
import { plural } from '../../_lib/questionnaires/hubModel';
import { pickerNote, vendorChoices } from '../../_lib/questionnaires/sharedModel';
import { assessmentKind } from '@/lib/statuses/vendorQuestionnaires';
import type { Template } from '../../_lib/questionnaires/types';

interface AssessmentOption { id: number; assessment_type: string; status: string; created_at?: string | null }
interface Certificate { id: number; name: string; expiry_date: string; read: boolean }
type Sent = { link: string | null; emailed: boolean; contact: { name: string; email: string | null } | null; vendorId: number };

const FRESH = { template: '', vendor: '', assessment: null as string | null, name: '', email: '', due: 14, expires: 30, certificate: '', mode: 'off' as 'off' | 'prefill' | 'skip' };

/** "Annual assessment, in progress, started 3 Nov 2026": what a person tells assessments apart by. */
export const assessmentChoice = (a: AssessmentOption): string => `${assessmentKind.label(a.assessment_type)} assessment · ${statusLabel(a.status)}${a.created_at ? ` · started ${formatDate(a.created_at)}` : ''}`;

export function SendSheet({ open, templates, templateId, onClose }: { open: boolean; templates: Template[]; templateId: number | null; onClose: () => void }) {
  const uid = useId();
  const qc = useQueryClient();
  const [form, setForm] = useState(FRESH);
  const [contact, setContact] = useState('');                  // '' = the supplier's primary contact, 'new' = someone typed in now, else a contact's id ('record': the supplier record's)
  const [problem, setProblem] = useState<unknown>(null);
  const [sent, setSent] = useState<Sent | null>(null);          // a send emails the contact a personal link, shown here once
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) { setForm({ ...FRESH, template: templateId ? String(templateId) : '' }); setContact(''); setProblem(null); setSent(null); setCopied(false); }
  }, [open, templateId]);

  const vendors = useVendorOptions(open);
  const vendorId = Number(form.vendor) || 0;
  const assessments = useQuery({
    queryKey: ['tprm-vendor-assessment-picker', vendorId],
    queryFn: async () => ((await vendorRiskApi.getAssessments({ vendor_id: vendorId, limit: 100 })).data.items ?? []) as AssessmentOption[],
    enabled: open && vendorId > 0,
    ...TPRM_QUERY_OPTS,
  });
  const certificates = useQuery({
    queryKey: ['vendor-certificates', vendorId],
    queryFn: async () => (await vendorRiskApi.vendorCertificates(vendorId)).data as Certificate[],
    enabled: open && vendorId > 0,
    ...TPRM_QUERY_OPTS,
  });
  // Who at the supplier it can go to: contacts a personal link can reach.
  const contacts = useQuery({
    queryKey: ['tprm-contacts', vendorId, false],
    queryFn: async () => (await portalApi.contacts(vendorId)).data.items,
    enabled: open && vendorId > 0,
    ...TPRM_QUERY_OPTS,
  });
  // an assessment the person did not choose is the supplier's newest (as the old panel did); choosing "No linked assessment" keeps it empty
  const assessmentValue = form.assessment ?? (assessments.data?.[0] ? String(assessments.data[0].id) : '');
  const reachable = (contacts.data || []).filter((c) => c.email && c.portal_access && !c.archived_at);
  const primary = reachable.find((c) => c.is_primary);
  const choice = contact || (primary ? String(primary.id ?? 'record') : reachable[0] ? String(reachable[0].id ?? 'record') : 'new');

  const sendable = useMemo(() => templates.filter((t) => !t.archived_at && t.question_count > 0), [templates]);
  const templateOptions: ListOption[] = sendable.map((t) => ({ value: String(t.id), label: t.name, description: plural(t.question_count, 'question', 'questions') }));
  const vendorOptions: ListOption[] = vendorChoices(vendors.data?.items ?? []);
  const note = vendors.data ? pickerNote(vendors.data.total, vendors.data.items.length) : null;
  const dirty = open && !sent && (form.vendor !== '' || form.email !== '' || form.name !== '' || form.due !== FRESH.due || form.expires !== FRESH.expires || form.template !== (templateId ? String(templateId) : ''));

  const send = useReportedMutation({
    mutationFn: async () => (await vendorRiskApi.sendQuestionnaire({
      template_id: Number(form.template),
      vendor_id: vendorId,
      assessment_id: assessmentValue ? Number(assessmentValue) : undefined,
      // Nothing named: the server sends it to the supplier's primary contact.
      ...(choice === 'new' ? { respondent_email: form.email || undefined, respondent_name: form.name || undefined } : choice === 'record' ? {} : { contact_id: Number(choice) }),
      due_in_days: form.due,
      expires_in_days: Math.max(form.expires, form.due),
      ...(form.mode !== 'off' && form.certificate ? { certificate_evidence_id: Number(form.certificate), certificate_mode: form.mode } : {}),
    } as Parameters<typeof vendorRiskApi.sendQuestionnaire>[0])).data as { link?: string; emailed?: boolean; contact?: { name: string; email: string | null } },
    success: (data) => (!data.link ? 'Questionnaire saved' : data.emailed ? `Sent to ${data.contact?.name || 'the contact'}` : 'Questionnaire ready: copy the link'),
    failure: "Couldn't send the questionnaire",
    toast: 'success',                                            // a failure is said once, at the top of the sheet
    retryable: false,                                            // a send is not safe to repeat: a second e-mail
    invalidate: SENT_REFRESH,
    onSuccess: (data) => {
      setSent({ link: data.link ? absoluteLink(data.link) : null, emailed: !!data.emailed, contact: data.contact || null, vendorId });
      void qc.invalidateQueries({ queryKey: ['tprm-contacts'] });
    },
    onError: (e) => setProblem(e),
  });

  const submit = () => {
    if (!form.template) { setProblem('Choose the questionnaire to send.'); return; }
    if (!vendorId) { setProblem('Choose the supplier it goes to.'); return; }
    if (choice === 'new' && !form.email.trim()) { setProblem("Add the contact's email, or choose someone from the list."); return; }
    setProblem(null);
    if (!send.isPending) send.mutate();
  };
  const copyLink = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }, () => undefined);
  };
  const chosenTemplate = sendable.find((t) => String(t.id) === form.template);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={sent ? 'Questionnaire sent' : 'Send a questionnaire'}
      subtitle={sent ? undefined : 'The contact is emailed a personal link to the supplier portal.'}
      width="lg"
      dirty={dirty}
      footer={sent ? (
        <div className="flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
      ) : (
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} variant="primary" loading={send.isPending} disabled={vendorId > 0 && (assessments.isPending || contacts.isPending)} leftIcon={<Link2 aria-hidden />}>Send</Button>
        </div>
      )}
    >
      {sent ? (
        <div className="flex flex-col gap-[16px]">
          <Notice tone={sent.link && sent.emailed ? 'info' : 'warning'} title={!sent.link ? 'Questionnaire saved' : sent.emailed ? `Sent to ${sent.contact?.name || 'the contact'}` : 'The email was not sent'}>
            {!sent.link ? (
              <>There is no contact to send it to. Add one on the <Link href={`/vendor-risk/vendors/${sent.vendorId}`} className="text-ds-primary-text underline">supplier&apos;s page</Link>.</>
            ) : sent.emailed ? sent.contact?.email : 'Copy the link and send it yourself.'}
          </Notice>
          {sent.link && (
            <div className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
              <FormField label="Personal link" hint="Shown once. It opens the supplier's portal, with this questionnaire, for 30 days.">
                <TextInput readOnly value={sent.link} onFocus={(e) => e.currentTarget.select()} />
              </FormField>
              <div className="mt-[8px]"><Button leftIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />} onClick={() => copyLink(sent.link as string)}>{copied ? 'Copied' : 'Copy the link'}</Button></div>
            </div>
          )}
        </div>
      ) : (
        <form id={`${uid}-form`} className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <FormError title="Couldn't send the questionnaire" error={problem} />
          <div className="grid gap-[16px] md:grid-cols-2">
            <FormField label="Questionnaire" required>
              <Combobox label="Questionnaire" options={templateOptions} value={form.template || null} onChange={(v) => setForm({ ...form, template: v ?? '' })} placeholder="Choose a questionnaire" />
            </FormField>
            <FormField label="Supplier" required hint={note ?? undefined}>
              <Combobox
                label="Supplier" searchable options={vendorOptions} value={form.vendor || null}
                placeholder={vendors.isPending ? 'Loading suppliers…' : 'Choose a supplier'} searchPlaceholder="Search suppliers" emptyText="No supplier matches"
                disabled={vendors.isPending || vendors.isError}
                onChange={(v) => { setContact(''); setForm({ ...form, vendor: v ?? '', assessment: null, email: '', name: '', certificate: '', mode: 'off' }); }}
              />
            </FormField>
          </div>
          {vendors.isError && (
            <Notice tone="danger" title="Couldn't load the suppliers" action={<Button size="sm" onClick={() => { void vendors.refetch(); }}>Retry</Button>}>{errorMessage(vendors.error)}</Notice>
          )}
          {vendorId > 0 && (
            <div className="grid gap-[16px] md:grid-cols-2">
              <FormField label="Linked assessment" optional hint={assessments.isError ? "The assessments could not be read, so none can be linked now." : undefined}>
                <Select
                  value={assessmentValue}
                  onChange={(e) => setForm({ ...form, assessment: e.target.value })}
                  disabled={assessments.isPending}
                >
                  <option value="">No linked assessment</option>
                  {(assessments.data ?? []).map((a) => <option key={a.id} value={a.id}>{assessmentChoice(a)}</option>)}
                </Select>
              </FormField>
              <FormField label="Send to" hint={contacts.isError ? "The supplier's contacts could not be read. Choose New contact to type one." : undefined}>
                <Select value={choice} disabled={contacts.isPending} onChange={(e) => setContact(e.target.value)}>
                  {reachable.map((c) => <option key={c.id ?? 'record'} value={String(c.id ?? 'record')}>{c.name} · {c.email}{c.is_primary ? ' (primary)' : ''}</option>)}
                  <option value="new">New contact…</option>
                </Select>
              </FormField>
              {choice === 'new' && !contacts.isPending && (
                <>
                  <FormField label="Contact name" optional><TextInput value={form.name} placeholder="Contact name" onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormField>
                  <FormField label="Contact email" required><TextInput type="email" value={form.email} placeholder="contact@supplier.com" onChange={(e) => setForm({ ...form, email: e.target.value })} /></FormField>
                </>
              )}
            </div>
          )}
          <div className="grid gap-[16px] md:grid-cols-2">
            <FormField label="Answers due in (days)">
              <TextInput type="number" min={1} max={365} value={form.due} onChange={(e) => setForm({ ...form, due: Math.max(1, Number(e.target.value) || 1) })} />
            </FormField>
            <FormField label="Link expires in (days)" hint="The supplier is reminded before and after the due day until the link expires.">
              <TextInput type="number" min={1} max={365} value={form.expires} onChange={(e) => setForm({ ...form, expires: Math.max(1, Number(e.target.value) || 1) })} />
            </FormField>
          </div>
          {vendorId > 0 && (
            <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
              <p className="text-ds-body font-[600] text-ds-fg">Answer questions from a certificate on file</p>
              {certificates.isError ? (
                <p className="text-ds-label text-ds-danger">The certificates could not be read, so none can be used now.</p>
              ) : (certificates.data ?? []).length === 0 ? (
                <p className="text-ds-label text-ds-fg-muted">No in-date certificate is held for this supplier. Add its SOC 2 report or ISO 27001 certificate, with the expiry date, to the supplier&apos;s evidence to use one.</p>
              ) : (
                <div className="grid gap-[12px] md:grid-cols-2">
                  <FormField label="Certificate">
                    <Select
                      value={form.certificate}
                      onChange={(e) => setForm({ ...form, certificate: e.target.value, mode: e.target.value ? (form.mode === 'off' ? 'prefill' : form.mode) : 'off' })}
                    >
                      <option value="">No certificate</option>
                      {(certificates.data ?? []).map((c) => <option key={c.id} value={c.id} disabled={!c.read}>{c.name} (valid until {formatDate(c.expiry_date, { calendar: true })}){c.read ? '' : ' · not read yet'}</option>)}
                    </Select>
                  </FormField>
                  <FormField label="How it answers">
                    <Select value={form.mode} disabled={!form.certificate} onChange={(e) => setForm({ ...form, mode: e.target.value as 'off' | 'prefill' | 'skip' })}>
                      <option value="off">Do not use it</option>
                      <option value="prefill">Prefill: answered Yes, the supplier can change them</option>
                      <option value="skip">Skip: answered Yes and not asked</option>
                    </Select>
                  </FormField>
                </div>
              )}
              <p className="text-ds-label text-ds-fg-muted">
                Only questions {chosenTemplate ? 'this questionnaire' : 'the questionnaire'} marks &ldquo;a certificate can answer this&rdquo;. The certificate must be in date and name the supplier; the AI review of it must not find that it fails to.
              </p>
            </div>
          )}
        </form>
      )}
    </Sheet>
  );
}
