'use client';

// "Submit for review": choose the reviewers and approvers, save them and send the document in one step.
// Backend: /governance/documents/{id}/signoff/participants and /signoff/send-for-review.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import { sentToast } from '@/lib/signoffTargets';
import { AssigneeMultiSelect, useAssigneeOptions, useSignoff, type Participant } from '../_SignoffControl';

const detailOf = (e: any, fallback: string) => {
  const d = e?.response?.data?.detail;
  return typeof d === 'string' && d ? d : fallback;
};
const ids = (list: Participant[]) => list.map(({ target_type, target_id }) => ({ target_type, target_id }));

export default function SubmitDialog({ documentId, doc, open, onClose }: { documentId: number; doc: any; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const options = useAssigneeOptions(doc?.tenant_id);
  const { data } = useSignoff(documentId);
  const [reviewers, setReviewers] = useState<Participant[]>([]);
  const [approvers, setApprovers] = useState<Participant[]>([]);
  const [filled, setFilled] = useState(false);

  // fill from the saved participants once per opening, so a background refetch never wipes a choice being made
  useEffect(() => {
    if (!open) { setFilled(false); return; }
    if (!filled && data) {
      setReviewers(data.participants?.reviewer || []);
      setApprovers(data.participants?.approver || []);
      setFilled(true);
    }
  }, [open, data, filled]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['doc-signoff', documentId] });
    qc.invalidateQueries({ queryKey: ['governance-document', documentId] });
    qc.invalidateQueries({ queryKey: ['document-lifecycle'] });
    qc.invalidateQueries({ queryKey: ['document-access', documentId] });
  };

  const send = useMutation({
    mutationFn: async () => {
      await governanceApi.setSignoffParticipants(documentId, {
        prepared_by: ids(data?.participants?.prepared_by || []), reviewers: ids(reviewers), approvers: ids(approvers),
      });
      try {
        return (await governanceApi.sendDocumentForReview(documentId)).data;
      } catch (e: any) {
        throw Object.assign(e ?? {}, { participantsSaved: true });
      }
    },
    onSuccess: (sent: any) => {
      // the server names reviewers or approvers nobody can sign for (a role or team without users of this platform)
      const said = sentToast(sent, reviewers.length ? 'Reviewers were asked' : 'Approvers were asked');
      toast({ ...said, title: said.title === 'Sent' ? 'Sent for review' : said.title });
      refresh();
      if (said.title !== 'Not sent') onClose();          // still a draft: it stays open to choose others
    },
    onError: (e: any) => {
      if (e?.participantsSaved) refresh();
      toast({
        type: 'error',
        title: 'Not sent',
        message: e?.participantsSaved
          ? `Reviewers and approvers were saved, but sending failed: ${detailOf(e, 'please try again.')}`
          : detailOf(e, 'Could not save the reviewers and approvers.'),
      });
    },
  });

  const empty = !reviewers.length && !approvers.length;
  const version = doc?.version ?? data?.version;

  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      size="lg"
      title="Submit for review"
      subtitle={[doc?.title, version ? `version ${version}` : ''].filter(Boolean).join(' · ')}
      className="max-sm:max-h-[100dvh] max-sm:h-[100dvh] max-sm:rounded-none"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#26323d] hover:bg-[#f3f6f8]">
            Cancel
          </button>
          <button type="button" onClick={() => send.mutate()} disabled={send.isPending || empty || !data}
            title={empty ? 'Choose at least one reviewer or approver' : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Send for review
          </button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <AssigneeMultiSelect label="Reviewers" value={reviewers} onChange={setReviewers} options={options} />
          <AssigneeMultiSelect label="Approvers" value={approvers} onChange={setApprovers} options={options} />
        </div>
        <p className="text-[11px] text-[#586472]">Reviewers sign first, then approvers. A role or team is signed by its first member.</p>
      </div>
    </AnimatedModal>
  );
}
