'use client';

// Assessments tab of the vendor record. Owner: B4.
// One card per questionnaire sent for the engagement the page picked, each opening the questionnaire in full; Send questionnaire
// and Reassess; then the vendor's requests and messages, its contacts and links, its exposure, and the old assessments list.
import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Upload } from 'lucide-react';
import { BTN, BTN_PRIMARY, Dialog, ErrorState, Panel, Skeleton, TONE } from '@/app/(dashboard)/vendor-risk/_ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi } from '@/lib/api';
import { CARDS_KEY, useAssessmentCards, type SentLink } from '../../../_lib/assessmentsApi';
import { reachable, reassessBlocked, sendBlocked } from '../../../_lib/assessmentsLogic';
import { engagementsKey, useEngagements } from '../../../_lib/engagementsApi';
import { portalApi } from '../../../_lib/portalApi';
import AssessmentCard from '../_assessments/AssessmentCard';
import AssessmentDialog from '../_assessments/AssessmentDialog';
import LegacyAssessments from '../_assessments/LegacyAssessments';
import { LinkDialog, SendDialog } from '../_assessments/SendDialog';
import ExposurePanel from '../_tpra/ExposurePanel';
import PortalPanel from '../_tpra/PortalPanel';
import type { TabProps } from './tabProps';

/** A heading over panels that bring their own frames (the portal's, the exposure's). */
function Section({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <h2 id={id} className="text-[15px] font-semibold leading-6 text-[#1f2933]">{title}</h2>
        {info && <InfoTip text={info} label={`About ${title}`} />}
      </div>
      {children}
    </section>
  );
}

export default function AssessmentsTab({ vendorId, engagementId, onChanged }: TabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  // as the server holds them: sending and reassessing open an assessment, reviewing edits one, comments are the vendor's
  const canCreate = hasPermission('vendor_risk:assessments:create') || hasPermission('erm:risks:edit');
  const canReview = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');
  const canMessage = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');

  const cards = useAssessmentCards(vendorId, engagementId);
  const { data: engagements } = useEngagements(vendorId);
  const contacts = useQuery({
    queryKey: ['tprm-contacts', vendorId, false],
    queryFn: async () => (await portalApi.contacts(vendorId, false)).data.items,
  });

  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<SentLink | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [reassessing, setReassessing] = useState(false);
  const [why, setWhy] = useState('');
  const [more, setMore] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [CARDS_KEY] });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle', vendorId] });
    qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
    ['tprm-contacts', 'tprm-portal-links'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));   // a send adds a contact and a link
    onChanged?.();
  };

  const reassess = useMutation({
    mutationFn: () => tpraApi.reassess(vendorId, { reason: why.trim() || 'Reassessment opened from the Assessments tab', engagement_id: engagementId }),
    onSuccess: () => {
      refresh();
      setReassessing(false);
      setWhy('');
      toast({ type: 'success', title: 'New review opened. Re-tier the engagement to set its depth.' });
    },
    onError: (e) => toast({ type: 'error', title: 'Not opened', message: apiErrorText(e, 'Try again.') }),
  });

  const scope = cards.data?.scope;
  const items = cards.data?.items ?? [];
  const engagement = (engagements?.items ?? []).find((e) => (engagementId ? e.id === engagementId : e.is_general));
  const noSend = sendBlocked(scope, contacts.data);
  const noReassess = reassessBlocked(scope);
  const noContact = !!contacts.data && !contacts.data.some(reachable);
  const opened = items.find((c) => c.id === openId);

  let body: ReactNode;
  if (cards.isLoading) {
    body = <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  } else if (!scope) {
    body = <ErrorState title="Couldn't load the assessments" message={apiErrorText(cards.error, 'Try again in a moment.')} onRetry={() => cards.refetch()} />;
  } else {
    body = (
      <div className="space-y-3">
        {scope.closed && <p className="text-[13px] leading-5 text-[#64707e]">{scope.closed}</p>}
        {!scope.tiered && items.length === 0 && (
          <p className="text-[13px] leading-5 text-[#586472]">Tier the engagement first. The tier sets which questions apply.</p>
        )}
        {scope.tiered && noContact && (
          <div className="rounded-lg border p-3.5" style={{ background: TONE.warning.tint, borderColor: TONE.warning.border }}>
            <p className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: TONE.warning.text }}>
              <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" /> No contact to send to
            </p>
            <p className="mt-1 text-[13px] leading-5 text-[#586472]">Add a vendor contact with an email address first.</p>
          </div>
        )}
        {scope.tiered && !noContact && items.length === 0 && <p className="text-[13px] leading-5 text-[#64707e]">No questionnaires sent yet.</p>}
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((c) => <li key={c.id}><AssessmentCard card={c} onOpen={() => setOpenId(c.id)} /></li>)}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Assessments"
        count={items.length || undefined}
        description={engagement?.name ?? 'General'}
        action={canCreate ? (
          <>
            <span title={noReassess ?? undefined}>
              <button type="button" className={BTN} disabled={!!noReassess} onClick={() => setReassessing(true)}>Reassess</button>
            </span>
            <span title={noSend ?? undefined}>
              <button type="button" className={BTN_PRIMARY} disabled={!!noSend} onClick={() => setSending(true)}>
                <Upload aria-hidden className="h-4 w-4" /> Send questionnaire
              </button>
            </span>
          </>
        ) : undefined}
      >
        {body}
      </Panel>

      <Section title="Requests & messages" info="Documents and answers asked of the vendor, and what has been said to it. The vendor answers in its portal.">
        <PortalPanel vendorId={vendorId} sections={['requests', 'messages']} />
      </Section>

      <details className="rounded-xl border border-[#d5dbe1] bg-[#fff]" onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer rounded-xl px-5 py-3.5 text-[15px] font-semibold leading-6 text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
          Contacts and links
        </summary>
        <div className="px-5 pb-5">{more && <PortalPanel vendorId={vendorId} sections={['contacts', 'links']} />}</div>
      </details>

      <Section title="Exposure">
        <ExposurePanel vendorId={vendorId} />
      </Section>

      <LegacyAssessments vendorId={vendorId} />

      {sending && scope && (
        <SendDialog
          onClose={() => setSending(false)}
          vendorId={vendorId}
          scope={scope}
          cards={items}
          contacts={contacts.data ?? []}
          onSent={(sent) => { setSending(false); refresh(); if (sent.link) setLink(sent); }}
        />
      )}
      {link && <LinkDialog sent={link} onClose={() => setLink(null)} />}
      {opened && (
        <AssessmentDialog
          key={opened.id}
          card={opened}
          canReview={canReview}
          canMessage={canMessage}
          onClose={() => setOpenId(null)}
          onScored={refresh}
        />
      )}
      <Dialog
        open={reassessing}
        onClose={() => setReassessing(false)}
        title="Reassess"
        footer={(
          <>
            <button type="button" className={BTN} onClick={() => setReassessing(false)}>Cancel</button>
            <button type="submit" form="reassess-form" className={BTN_PRIMARY} disabled={reassess.isPending}>{reassess.isPending ? 'Opening…' : 'Reassess'}</button>
          </>
        )}
      >
        <form id="reassess-form" onSubmit={(e) => { e.preventDefault(); reassess.mutate(); }}>
          <label htmlFor="reassess-why" className="mb-1 flex items-center gap-1 text-[13px] font-medium text-[#26323d]">
            Why <span className="font-normal text-[#64707e]">(optional)</span>
            <InfoTip text="Opens the next review. The current one is kept as history, and its questionnaires stay here." label="About reassessing" />
          </label>
          <textarea
            id="reassess-why"
            rows={3}
            maxLength={2000}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            className="w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 py-2 text-sm text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          />
        </form>
      </Dialog>
    </div>
  );
}
