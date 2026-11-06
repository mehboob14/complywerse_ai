'use client';

// Send a questionnaire to a vendor contact (480px), then show the personal link once (600px). Sending the questionnaire that is
// already out resends it with a fresh link; a different one goes out as well. Backend: POST /questionnaires/send and
// /questionnaire-responses/{id}/resend, which email the contact and give the link back once.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Copy, Info } from 'lucide-react';
import { BTN, BTN_PRIMARY, Dialog, fmt, tierLabel } from '@/app/(dashboard)/vendor-risk/_ui';
import { inDays } from '@/app/(dashboard)/governance/regulatory-changes/_ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { assessmentsApi, type AssessmentCard, type CardsScope, type SentLink } from '../../../_lib/assessmentsApi';
import { dueInDays, linkDays, reachable, resendTarget, sendHint, WAITING } from '../../../_lib/assessmentsLogic';
import { absoluteLink, type SupplierContact } from '../../../_lib/portalApi';

const FIELD = 'h-9 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 text-sm text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] disabled:bg-[#f3f6f8] disabled:text-[#64707e]';
const LABEL = 'mb-1 flex items-center gap-1 text-[13px] font-medium text-[#26323d]';

interface Template { id: number; name: string; question_count: number; archived_at?: string | null; archived?: boolean }
interface Certificate { id: number; name: string; expiry_date: string; read: boolean }

const keyOf = (c: Pick<SupplierContact, 'id'>) => String(c.id ?? 'record');

export function SendDialog({ onClose, vendorId, scope, cards, contacts, onSent }: {
  onClose: () => void;
  vendorId: number;
  scope: CardsScope;
  cards: AssessmentCard[];
  contacts: SupplierContact[];
  onSent: (sent: SentLink) => void;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<number | null>(null);
  const [contact, setContact] = useState('');
  const [due, setDue] = useState('');
  const [cert, setCert] = useState('');
  const [certMode, setCertMode] = useState<'prefill' | 'skip'>('prefill');

  const templates = useQuery({
    queryKey: ['tprm-send-templates'],
    queryFn: async () => {
      const d = (await vendorRiskApi.getTemplates({ limit: 200 })).data as unknown;
      return (Array.isArray(d) ? d : (d as { items?: unknown[] })?.items ?? []) as Template[];
    },
  });
  // what the tier calls for, as the stage-4 panel reads it (the same query)
  const requirements = useQuery({
    queryKey: ['tier-requirements', scope.active_assessment_id],
    queryFn: async () => (await tpraApi.tierRequirements(scope.active_assessment_id as number)).data as { questionnaires: Array<{ template_id: number }> },
    enabled: !!scope.active_assessment_id,
  });
  const certificates = useQuery({
    queryKey: ['tprm-certificates', vendorId],
    queryFn: async () => (await vendorRiskApi.vendorCertificates(vendorId)).data as Certificate[],
  });

  const list = (templates.data ?? []).filter((t) => !(t.archived_at || t.archived));
  const tierIds = (requirements.data?.questionnaires ?? []).map((q) => q.template_id);
  const outNow = cards.find((c) => c.active && WAITING.includes(c.status));
  const templateId = picked ?? outNow?.template_id ?? tierIds.find((id) => list.some((t) => t.id === id)) ?? list[0]?.id ?? null;
  const chosen = list.find((t) => t.id === templateId);
  const resend = resendTarget(cards, templateId);
  const hint = sendHint({
    templateId, cards, tierLabel: scope.tier ? tierLabel(scope.tier) : null,
    isTierDefault: tierIds.length && templateId != null ? tierIds.includes(templateId) : null,
  });

  const choices = contacts.filter((c) => !c.archived_at);
  const first = choices.find((c) => c.is_primary && reachable(c)) ?? choices.find(reachable);
  const contactKey = contact || (first ? keyOf(first) : '');
  const certs = certificates.data ?? [];

  const submit = useMutation({
    mutationFn: async (): Promise<SentLink> => {
      const days = due ? { due_in_days: dueInDays(due), expires_in_days: linkDays(dueInDays(due)) } : {};
      if (resend) {
        const res = (await assessmentsApi.resend(resend.id, days)).data;
        return { link: res.link ? absoluteLink(res.link) : null, emailed: res.emailed, email: res.respondent_email, questions: resend.questions };
      }
      const to = choices.find((c) => keyOf(c) === contactKey);
      const res = (await assessmentsApi.send({
        vendor_id: vendorId, assessment_id: scope.active_assessment_id, template_id: templateId as number,
        contact_id: to?.id ?? undefined, ...days,
        ...(cert ? { certificate_evidence_id: Number(cert), certificate_mode: certMode } : {}),
      })).data;
      return { link: res.link ? absoluteLink(res.link) : null, emailed: res.emailed, email: res.contact?.email ?? to?.email ?? null, questions: chosen?.question_count ?? 0 };
    },
    onSuccess: (sent) => {
      if (!sent.link) toast({ type: 'warning', title: 'Saved, not sent', message: 'This vendor has no contact a link can go to.' });
      onSent(sent);
    },
    onError: (e) => toast({ type: 'error', title: 'Not sent', message: apiErrorText(e, 'Try again.') }),
  });

  const label = resend ? 'Resend questionnaire' : 'Send questionnaire';
  const ready = !!templateId && (resend != null || contactKey !== '');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Send questionnaire"
      footer={(
        <>
          <button type="button" className={BTN} onClick={onClose}>Cancel</button>
          <button type="submit" form="send-questionnaire" className={BTN_PRIMARY} disabled={!ready || submit.isPending}>
            {submit.isPending ? 'Sending…' : label}
          </button>
        </>
      )}
    >
      <form id="send-questionnaire" className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready) submit.mutate(); }}>
        <div>
          <label htmlFor="send-template" className={LABEL}>Questionnaire</label>
          <select id="send-template" className={FIELD} value={templateId ?? ''} onChange={(e) => setPicked(Number(e.target.value))}>
            {list.length === 0 && <option value="">{templates.isLoading ? 'Loading…' : 'No questionnaires yet'}</option>}
            {list.map((t) => (
              <option key={t.id} value={t.id} disabled={t.question_count === 0}>{t.name} · {t.question_count} questions</option>
            ))}
          </select>
          {hint && (
            <p className="mt-1.5 text-[12px] leading-4" style={{ color: hint.tone === 'warn' ? '#9a5007' : '#64707e' }}>{hint.text}</p>
          )}
        </div>

        <div>
          <label htmlFor="send-contact" className={LABEL}>
            Send to
            <InfoTip
              text={resend ? 'A resend goes to the contact it was sent to.' : 'The vendor opens the questionnaire from the emailed link. No sign-in needed.'}
              label="About sending"
            />
          </label>
          {resend ? (
            <input id="send-contact" className={FIELD} disabled value={[resend.contact?.name, resend.contact?.email].filter(Boolean).join(' · ') || 'The contact it was sent to'} readOnly />
          ) : (
            <select id="send-contact" className={FIELD} value={contactKey} onChange={(e) => setContact(e.target.value)}>
              {choices.length === 0 && <option value="">No contacts</option>}
              {choices.map((c) => (
                <option key={keyOf(c)} value={keyOf(c)} disabled={!reachable(c)}>
                  {c.name}{c.email ? ` · ${c.email}` : ' · No email'}{c.email && c.portal_access === false ? ' · No portal access' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label htmlFor="send-due" className={LABEL}>
            Due date <span className="font-normal text-[#64707e]">(optional)</span>
            <InfoTip text="Shown to the vendor. It does not close the link." label="About the due date" />
          </label>
          <input id="send-due" type="date" className={FIELD} min={inDays(0)} value={due} onChange={(e) => setDue(e.target.value)} />
        </div>

        {!resend && certs.length > 0 && (
          <details className="rounded-lg border border-[#d5dbe1] px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium text-[#26323d]">Answer from a certificate</summary>
            <div className="mt-2.5 space-y-2.5">
              <div>
                <label htmlFor="send-cert" className={LABEL}>
                  Certificate
                  <InfoTip text="Only questions the questionnaire marks as answerable by a certificate. It must be in date and name the vendor." label="About certificates" />
                </label>
                <select id="send-cert" className={FIELD} value={cert} onChange={(e) => setCert(e.target.value)}>
                  <option value="">None</option>
                  {certs.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.read}>{c.name} · until {fmt.date(c.expiry_date)}{c.read ? '' : ' · not read yet'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="send-cert-mode" className={LABEL}>It answers</label>
                <select id="send-cert-mode" className={FIELD} value={certMode} disabled={!cert} onChange={(e) => setCertMode(e.target.value as 'prefill' | 'skip')}>
                  <option value="prefill">Prefilled: the vendor can change them</option>
                  <option value="skip">Skipped: answered Yes and not asked</option>
                </select>
              </div>
            </div>
          </details>
        )}
      </form>
    </Dialog>
  );
}

/** The personal link, shown once: it was emailed, and a vendor who needs it another way gets it from here. */
export function LinkDialog({ sent, onClose }: { sent: SentLink; onClose: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sent.link ?? '');
      setCopied(true);
    } catch {
      toast({ type: 'error', title: 'Copy blocked', message: 'Select the link and copy it by hand.' });
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size={600}
      title={sent.emailed && sent.email ? `Questionnaire sent to ${sent.email}` : 'Questionnaire ready'}
      description={sent.emailed
        ? `${sent.questions} questions. We emailed the link, and it works for 30 days.`
        : 'The email did not go out. Copy the link and send it yourself. It works for 30 days.'}
      footer={<button type="button" className={BTN_PRIMARY} onClick={onClose}>Done</button>}
    >
      <div className="rounded-lg border border-[#d5dbe1] bg-[#f7f9fa] p-3">
        <p className="break-all font-mono text-[13px] leading-5 text-[#1f2933]">{sent.link}</p>
      </div>
      <button type="button" className={`${BTN} mt-3`} onClick={copy}>
        {copied ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-5 text-[#586472]">
        <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        Anyone with the link can answer, so share it only with this contact. You can revoke it under Contacts and links.
      </p>
    </Dialog>
  );
}
