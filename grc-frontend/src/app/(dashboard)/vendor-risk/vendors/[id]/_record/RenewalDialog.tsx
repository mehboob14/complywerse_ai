'use client';

// "Request renewal" on a document that has expired or is about to: the vendor is asked for the current one through its portal, the
// same request the Requests & messages section makes (the vendor gets a personal link by email), with the words filled in and
// shown first so nothing goes out unread.
import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { inDays } from '@/app/(dashboard)/governance/regulatory-changes/_ui';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN, BTN_PRIMARY, Dialog } from '../../../_ui';
import type { PaperDoc } from '../../../_lib/paperworkApi';
import { requestsApi, sentNote } from '../../../_lib/requestsApi';
import { errText } from '../../../_lib/intake/types';
import { renewalNote } from '../../../_lib/vendorRecordModel';
import { AREA, FIELD, HINT, LABEL } from '../../_components/formStyles';
import { ContactSelect } from '../_tpra/PortalPanel';

export default function RenewalDialog({ vendorId, doc, onClose }: { vendorId: number; doc: PaperDoc | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useId();
  const [title, setTitle] = useState(() => (doc ? `Renewal: ${doc.name}` : ''));
  const [detail, setDetail] = useState(() => (doc ? renewalNote(doc) : ''));
  const [due, setDue] = useState(() => inDays(14));
  const [contact, setContact] = useState<number | null>(null);

  // The words are filled in each time the dialog opens on a document.
  const which = doc?.link_id ?? null;
  useEffect(() => {
    if (!doc) return;
    setTitle(`Renewal: ${doc.name}`);
    setDetail(renewalNote(doc));
    setDue(inDays(14));
    setContact(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which document is open, not on every refetch of it
  }, [which]);

  const send = useMutation({
    mutationFn: () => requestsApi.create(vendorId, { kind: 'document', title: title.trim(), detail: detail.trim() || null, due_date: due || null, contact_id: contact }),
    onSuccess: (res) => {
      ['tprm-supplier-requests', 'tprm-portal-links', 'tprm-contacts'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));
      const note = sentNote(res.data.sent);
      toast({ type: note.ok ? 'success' : 'warning', title: 'Renewal requested', message: note.text });
      onClose();
    },
    onError: (e) => toast({ type: 'error', title: 'Not sent', message: errText(e, 'Try again.') }),
  });
  const ready = title.trim().length > 0;

  return (
    <Dialog
      open={doc !== null}
      onClose={onClose}
      title="Request renewal"
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="submit" form={form} disabled={!ready || send.isPending} className={BTN_PRIMARY}>
            {send.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Send
          </button>
        </>
      )}
    >
      <form id={form} className="space-y-3.5" onSubmit={(e) => { e.preventDefault(); if (ready && !send.isPending) send.mutate(); }}>
        <div>
          <label htmlFor={`${form}-title`} className={LABEL}>Title</label>
          <input id={`${form}-title`} data-autofocus required maxLength={255} className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${form}-detail`} className={LABEL}>Note <span className={HINT}>(the vendor reads this)</span></label>
          <textarea id={`${form}-detail`} rows={3} maxLength={8000} className={AREA} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label htmlFor={`${form}-due`} className={LABEL}>Due</label>
            <input id={`${form}-due`} type="date" min={inDays(0)} className={FIELD} value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${form}-to`} className={LABEL}>Send to</label>
            <ContactSelect id={`${form}-to`} vendorId={vendorId} value={contact} onChange={setContact} className="!h-10" />
          </div>
        </div>
      </form>
    </Dialog>
  );
}
