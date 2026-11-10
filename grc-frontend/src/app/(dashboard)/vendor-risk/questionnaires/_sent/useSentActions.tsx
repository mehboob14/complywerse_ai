'use client';

// What a person does to a questionnaire that was sent: copy its link, make a personal link for its contact and copy that, send a new link (asks first: the old link of its own stops working and the contact
// gets more time). Each reports in words (a toast that names what happened, a failure that stays with Retry where asking again can help). Which of them a row offers is sentModel.sentActions: the
// rights are the server's. Opening the answers and the assessment are links and a drawer, not requests: the caller does those.
import { useCallback, type ReactNode } from 'react';
import { useConfirm, useReportedMutation } from '@/components/ui/ds';
import { vendorRiskApi } from '@/lib/api';
import { absoluteLink, portalApi } from '../../_lib/portalApi';
import { questionnairesApi } from '../../_lib/questionnairesApi';
import { newLinkAsk, type SentAction, type SentRow } from '../../_lib/questionnaires/sentModel';
import { SENT_REFRESH } from './sentApi';

/** The address of a questionnaire's own link (a questionnaire sent before personal links, not yet accepted). */
export const questionnaireLink = (token: string): string => `${typeof window === 'undefined' ? '' : window.location.origin}/vendor-risk/questionnaires/${token}`;

async function copyText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('no clipboard');        // the person is told by the mutation's `fallback`: a plain Error carries no server words
  await navigator.clipboard.writeText(text);
}

export function useSentActions(): { run: (action: SentAction, row: SentRow) => void; busy: boolean; confirmDialog: ReactNode } {
  const { confirm, confirmDialog } = useConfirm();

  const copyOwn = useReportedMutation({
    mutationFn: async (r: SentRow) => {
      const token = (await questionnairesApi.sentOne(r.id)).data.token;
      if (!token) throw new Error('no link of its own');
      await copyText(questionnaireLink(token));
    },
    success: 'Link copied',
    failure: "Couldn't copy the link",
    fallback: "This questionnaire's link could not be copied from here. Open its details to copy it, or send a new link.",         // a plain Error carries no server words: this is what is said
  });
  const copyContact = useReportedMutation({
    // a questionnaire on personal links has no link of its own: a fresh one for its contact, opening at this questionnaire
    mutationFn: async (r: SentRow) => {
      const made = await portalApi.issueLink(r.vendor_id, r.contact_id as number, { send_email: false });
      await copyText(`${absoluteLink(made.data.link)}?q=${r.id}`);
    },
    success: "The contact's link was copied",
    failure: "Couldn't make a link",
    fallback: "The contact's link could not be made or copied. Try again.",
  });
  const resend = useReportedMutation({
    mutationFn: async (r: SentRow) => {
      const data = (await vendorRiskApi.resendQuestionnaire(r.id)).data as { link?: string | null; token?: string | null; emailed?: boolean };
      const link = data.link ? absoluteLink(data.link) : data.token ? questionnaireLink(data.token) : null;
      let copied = false;
      if (link) { try { await copyText(link); copied = true; } catch { copied = false; } }          // the link has been sent: a refused copy does not fail the send
      return { emailed: !!data.emailed, copied };
    },
    success: ({ emailed, copied }) => `${emailed ? 'A new link was emailed' : 'A new link was made'}${copied ? ' and copied' : ''}`,
    failure: "Couldn't send a new link",
    retryable: false,                                              // sending again would send a second e-mail
    invalidate: SENT_REFRESH,
  });

  const run = useCallback((action: SentAction, row: SentRow) => {
    if (action === 'copy_link') copyOwn.mutate(row);
    else if (action === 'copy_contact_link') copyContact.mutate(row);
    else if (action === 'send_new_link') {
      void confirm({ ...newLinkAsk(row) }).then((yes) => { if (yes) resend.mutate(row); });
    }
  }, [copyOwn, copyContact, resend, confirm]);

  return { run, busy: copyOwn.isPending || copyContact.isPending || resend.isPending, confirmDialog };
}
