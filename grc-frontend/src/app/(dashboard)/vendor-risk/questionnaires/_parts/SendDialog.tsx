'use client';

// "Send to a vendor": pick the supplier, an assessment to link it to and who answers; the contact is emailed a personal link to
// the supplier portal. A certificate the supplier has on file can answer the questions the questionnaire lets it. This is the
// send panel the questionnaires page has always had, moved here as it was.
import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2 as LinkIcon, Loader2 } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import { fmt } from '@/app/(dashboard)/vendor-risk/_ui';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { absoluteLink, portalApi } from '../../_lib/portalApi';

interface VendorOption { id: number; name: string; primary_contact_email: string | null; primary_contact_name: string | null }
interface AssessmentOption { id: number; vendor_id: number; assessment_type: string; status: string }

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelClass = 'block text-sm font-medium text-gray-800 mb-1';

const FRESH = { vendor_id: '', assessment_id: '', respondent_email: '', respondent_name: '', due_in_days: 14, expires_in_days: 30,
  certificate_evidence_id: '', certificate_mode: 'off' as 'off' | 'prefill' | 'skip' };

const formatAssessmentType = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function SendDialog({ templateId, templateName, onClose }: { templateId: number | null; templateName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const open = templateId !== null;
  const [form, setForm] = useState(FRESH);
  // A send emails the contact a personal link, shown here once.
  const [sent, setSent] = useState<{ link: string | null; emailed: boolean; contact: { name: string; email: string | null } | null; vendorId: number } | null>(null);
  // '' = the supplier's primary contact, 'new' = someone typed in now, else a contact's id ('record': the supplier record's).
  const [contact, setContact] = useState('');
  const [copied, setCopied] = useState(false);

  const close = () => { setSent(null); setForm(FRESH); setContact(''); onClose(); };
  const copyLink = (value: string) => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const { data: vendors } = useQuery({
    queryKey: ['vendors-select'],
    queryFn: async () => {
      const data = (await vendorRiskApi.getVendors()).data;
      return (Array.isArray(data) ? data : data.items ?? []) as VendorOption[];
    },
    placeholderData: keepPreviousData,
    enabled: open,
    ...TPRM_QUERY_OPTS,
  });
  const { data: assessments } = useQuery({
    queryKey: ['vendor-assessments-for-questionnaires'],
    queryFn: async () => {
      const data = (await vendorRiskApi.getAssessments({ limit: 1000 })).data;
      return (Array.isArray(data) ? data : data.items ?? []) as AssessmentOption[];
    },
    placeholderData: keepPreviousData,
    enabled: open,
    ...TPRM_QUERY_OPTS,
  });
  const { data: certificates } = useQuery({
    queryKey: ['vendor-certificates', form.vendor_id],
    queryFn: async () => (await vendorRiskApi.vendorCertificates(Number(form.vendor_id))).data as
      Array<{ id: number; name: string; expiry_date: string; read: boolean }>,
    enabled: open && !!form.vendor_id,
    ...TPRM_QUERY_OPTS,
  });
  // Who at the supplier it can go to: contacts a personal link can reach.
  const { data: contacts } = useQuery({
    queryKey: ['tprm-contacts', Number(form.vendor_id), false],
    queryFn: async () => (await portalApi.contacts(Number(form.vendor_id))).data.items,
    enabled: open && !!form.vendor_id,
    ...TPRM_QUERY_OPTS,
  });
  const reachable = (contacts || []).filter((c) => c.email && c.portal_access && !c.archived_at);
  const primary = reachable.find((c) => c.is_primary);
  const choice = contact || (primary ? String(primary.id ?? 'record') : reachable[0] ? String(reachable[0].id ?? 'record') : 'new');

  const send = useMutation({
    mutationFn: async (data: Parameters<typeof vendorRiskApi.sendQuestionnaire>[0] & { contact_id?: number }) =>
      (await vendorRiskApi.sendQuestionnaire(data)).data,
    onSuccess: (data: { link?: string; emailed?: boolean; contact?: { name: string; email: string | null } }, body) => {
      setSent({ link: data.link ? absoluteLink(data.link) : null, emailed: !!data.emailed, contact: data.contact || null, vendorId: Number(body.vendor_id) });
      queryClient.invalidateQueries({ queryKey: ['questionnaire-responses'] });
      queryClient.invalidateQueries({ queryKey: ['tprm-contacts'] });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send.mutate({
      template_id: templateId,
      vendor_id: Number(form.vendor_id),
      assessment_id: form.assessment_id ? Number(form.assessment_id) : undefined,
      // Nothing named: the server sends it to the supplier's primary contact.
      ...(choice === 'new'
        ? { respondent_email: form.respondent_email || undefined, respondent_name: form.respondent_name || undefined }
        : choice === 'record' ? {} : { contact_id: Number(choice) }),
      due_in_days: form.due_in_days,
      expires_in_days: Math.max(form.expires_in_days, form.due_in_days),
      ...(form.certificate_mode !== 'off' && form.certificate_evidence_id
        ? { certificate_evidence_id: Number(form.certificate_evidence_id), certificate_mode: form.certificate_mode }
        : {}),
    });
  };

  const vendorItems = (vendors ?? []).map((v) => ({ value: String(v.id), label: v.name, subLabel: v.primary_contact_email || undefined }));
  const assessmentItems = (assessments || []).filter((a) => a.vendor_id === Number(form.vendor_id)).map((a) => ({
    value: String(a.id), label: `#${a.id} - ${formatAssessmentType(a.assessment_type)} (${a.status.replace(/_/g, ' ')})`,
  }));

  return (
    <RightSlidePanel
      isOpen={open}
      onClose={close}
      title={`Send ${templateName}`}
      subtitle="The contact is emailed a personal link to the supplier portal."
      width="w-full max-w-3xl"
      footer={sent ? (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close} className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium">Done</button>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={close}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
          <button type="submit" form="send-questionnaire-form" disabled={send.isPending}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {send.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending...</> : <><LinkIcon className="h-4 w-4" strokeWidth={1.75} /> Send</>}
          </button>
        </div>
      )}
    >
      {sent ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 text-center">
            <LinkIcon className="mx-auto mb-2 h-8 w-8 text-primary-600" strokeWidth={1.75} />
            <p className="text-sm font-medium text-primary-800">
              {!sent.link ? 'Questionnaire saved' : sent.emailed ? `Sent to ${sent.contact?.name || 'the contact'}` : 'Email not sent'}
            </p>
            <p className="mt-1 text-xs text-primary-700">
              {!sent.link ? (
                <>No contact to send it to. Add one on the{' '}
                  <Link href={`/vendor-risk/vendors/${sent.vendorId}`} className="font-medium underline">supplier’s page</Link>.</>
              ) : sent.emailed ? sent.contact?.email : 'Copy the link and send it yourself.'}
            </p>
          </div>
          {sent.link && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Personal link</label>
              <div className="flex items-center gap-2">
                <input type="text" readOnly value={sent.link} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-xs`} />
                <button type="button" onClick={() => copyLink(sent.link as string)} aria-label="Copy the personal link"
                  className="cw-btn-primary inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-2 text-sm">
                  {copied ? <Check className="h-4 w-4" strokeWidth={1.75} /> : <Copy className="h-4 w-4" strokeWidth={1.75} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Shown once. It opens the supplier’s portal, with this questionnaire, for 30 days.</p>
            </div>
          )}
        </div>
      ) : (
        <form id="send-questionnaire-form" onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass}>Vendor *</label>
              <MultiSelectDropdown
                title="Vendor"
                items={vendorItems}
                selectedValues={form.vendor_id ? [form.vendor_id] : []}
                onApply={(values) => {
                  const vendorId = values[0] || '';
                  const own = (assessments || []).filter((a) => String(a.vendor_id) === vendorId);
                  setContact('');                // the new supplier's primary contact, unless changed
                  setForm({ ...form, vendor_id: vendorId, assessment_id: own[0] ? String(own[0].id) : '', respondent_email: '', respondent_name: '' });
                }}
                multiSelect={false}
                triggerVariant="input"
                size="md"
                placeholder="Select vendor..."
                forceSearch
              />
              {/* Hidden required input to keep native form validation */}
              <input type="text" required value={form.vendor_id} onChange={() => {}} className="sr-only" tabIndex={-1} aria-hidden="true" />
            </div>
            <div>
              <label className={labelClass}>Link to Assessment (optional)</label>
              <MultiSelectDropdown
                title="Assessment"
                items={assessmentItems}
                selectedValues={form.assessment_id ? [form.assessment_id] : []}
                onApply={(values) => setForm({ ...form, assessment_id: values[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                size="md"
                placeholder={form.vendor_id ? 'No linked assessment' : 'Select vendor first'}
              />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="send-contact">Send to</label>
              <select id="send-contact" value={choice} disabled={!form.vendor_id} onChange={(e) => setContact(e.target.value)} className={inputClass}>
                {reachable.map((c) => (
                  <option key={c.id ?? 'record'} value={String(c.id ?? 'record')}>{c.name} · {c.email}{c.is_primary ? ' (primary)' : ''}</option>
                ))}
                <option value="new">New contact…</option>
              </select>
            </div>
            {choice === 'new' && (
              <>
                <div>
                  <label className={labelClass} htmlFor="send-new-name">Name</label>
                  <input id="send-new-name" type="text" value={form.respondent_name} onChange={(e) => setForm({ ...form, respondent_name: e.target.value })} className={inputClass} placeholder="Contact name" />
                </div>
                <div>
                  <label className={labelClass} htmlFor="send-new-email">Email</label>
                  <input id="send-new-email" type="email" required value={form.respondent_email} onChange={(e) => setForm({ ...form, respondent_email: e.target.value })} className={inputClass} placeholder="contact@supplier.com" />
                </div>
              </>
            )}
            <div>
              <label className={labelClass} htmlFor="send-due-days">Answers due in (days)</label>
              <input id="send-due-days" type="number" min={1} max={365} value={form.due_in_days}
                onChange={(e) => setForm({ ...form, due_in_days: Math.max(1, Number(e.target.value) || 1) })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="send-expiry-days">Link expires in (days)</label>
              <input id="send-expiry-days" type="number" min={1} max={365} value={form.expires_in_days}
                onChange={(e) => setForm({ ...form, expires_in_days: Math.max(1, Number(e.target.value) || 1) })} className={inputClass} />
              <p className="mt-1 text-[11px] text-gray-500">The vendor is reminded before and after the due date until the link expires.</p>
            </div>
            {form.vendor_id && (
              <div className="md:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <p className="text-xs font-medium text-gray-700">Answer questions from a certificate on file</p>
                {(certificates || []).length === 0 ? (
                  <p className="text-[11px] text-gray-500">
                    No in-date certificate is held for this vendor. Add its SOC 2 report or ISO 27001 certificate, with
                    the expiry date, to the vendor&apos;s evidence to use one.
                  </p>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    <select
                      aria-label="Certificate"
                      value={form.certificate_evidence_id}
                      onChange={(e) => setForm({ ...form, certificate_evidence_id: e.target.value,
                        certificate_mode: e.target.value ? (form.certificate_mode === 'off' ? 'prefill' : form.certificate_mode) : 'off' })}
                      className={inputClass}
                    >
                      <option value="">No certificate</option>
                      {(certificates || []).map((c) => (
                        <option key={c.id} value={c.id} disabled={!c.read}>
                          {c.name} (valid until {fmt.date(c.expiry_date)}){c.read ? '' : ' - not read yet'}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="How the certificate answers"
                      value={form.certificate_mode}
                      disabled={!form.certificate_evidence_id}
                      onChange={(e) => setForm({ ...form, certificate_mode: e.target.value as 'off' | 'prefill' | 'skip' })}
                      className={inputClass}
                    >
                      <option value="off">Do not use it</option>
                      <option value="prefill">Prefill: answered Yes, the vendor can change them</option>
                      <option value="skip">Skip: answered Yes and not asked</option>
                    </select>
                  </div>
                )}
                <p className="text-[11px] text-gray-500">
                  Only questions the questionnaire marks &ldquo;a certificate can answer this&rdquo;. The certificate must be in date and
                  name the vendor; the AI review of it must not find that it fails to.
                </p>
              </div>
            )}
            {send.isError && (
              <div className="text-xs text-red-600 bg-red-50 p-2 rounded-lg md:col-span-2">
                {(send.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to send questionnaire'}
              </div>
            )}
          </div>
        </form>
      )}
    </RightSlidePanel>
  );
}
