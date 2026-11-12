'use client';

// One proposal. The risk owner confirms it applies and drafts the score before controls ("Send for challenge"), or declines it with
// a reason; the risk team reviews the library's text beside the owner's draft and accepts it into the register or returns it with
// comments. What the person looking may do comes from the server (`you`): the person who drafted it never accepts it.

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { errorText } from '@/components/settings/CustomFields';
import { riskLibraryApi } from '../_lib/api';
import {
  IMPACT, LIKELIHOOD, STATUS_LABEL, draftBody, draftProblem, sideBySide, startDraft, type DraftForm, type Proposal,
} from '../_lib/model';
import { AREA, BTN, BTN_PRIMARY, FIELD, LABEL, Score } from './AddToRegisterDialog';

type Act = 'draft' | 'decline' | 'accept' | 'return';
const DONE: Record<Act, string> = {
  draft: 'Sent for challenge', decline: 'Declined', accept: 'Accepted into the register', return: 'Returned to the owner',
};

interface ProposalDialogProps {
  id: number | null;
  onClose: () => void;
  onDone: (p: Proposal, what: string) => void;
}

export default function ProposalDialog({ id, onClose, onDone }: ProposalDialogProps) {
  const query = useQuery({ queryKey: ['risk-library-proposal', id], queryFn: () => riskLibraryApi.proposal(id!), enabled: id != null });
  const p = query.data;
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [comment, setComment] = useState('');
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(p ? startDraft(p, p.library_risk) : null); setComment(''); setDeclining(false); setError(null);
  }, [p?.id, p?.status]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = useMutation({
    mutationFn: (kind: Act) => {
      if (kind === 'draft') return riskLibraryApi.draft(p!.id, draftBody(draft!));
      if (kind === 'decline') return riskLibraryApi.decline(p!.id, comment);
      if (kind === 'accept') return riskLibraryApi.accept(p!.id, comment);
      return riskLibraryApi.sendBack(p!.id, comment);
    },
    onSuccess: (done, kind) => onDone(done, DONE[kind]),
    onError: (e) => setError(errorText(e, 'Could not save the proposal.')),
  });
  if (id == null) return null;

  const mode = !p ? 'loading' : p.you.may_draft ? 'draft' : p.you.may_challenge ? 'review' : 'view';
  const blocked = mode === 'draft' && draft ? (declining ? (comment.trim() ? null : 'Say why it does not apply') : draftProblem(draft)) : null;
  const set = (change: Partial<DraftForm>) => { setError(null); setDraft((f) => (f ? { ...f, ...change } : f)); };
  const run = (kind: Act) => { if (!act.isPending) act.mutate(kind); };

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span role="status" className="min-w-0 truncate text-[13px] text-[#9b1c1c]">{error || ''}</span>
      <div className="flex shrink-0 gap-2">
        <button type="button" className={BTN} onClick={onClose}>{mode === 'view' ? 'Close' : 'Cancel'}</button>
        {mode === 'draft' && p?.you.may_decline && !declining && (
          <button type="button" className={BTN} onClick={() => { setDeclining(true); setComment(''); }}>Decline</button>
        )}
        {mode === 'draft' && (
          <button type="button" className={BTN_PRIMARY} disabled={!!blocked || act.isPending} title={blocked || undefined}
            onClick={() => run(declining ? 'decline' : 'draft')}>
            {act.isPending ? 'Sending…' : declining ? 'Decline' : 'Send for challenge'}
          </button>
        )}
        {mode === 'review' && (
          <>
            <button type="button" className={BTN} disabled={!comment.trim() || act.isPending}
              title={comment.trim() ? undefined : 'Write what the owner should look at again'} onClick={() => run('return')}>Return</button>
            <button type="button" className={BTN_PRIMARY} disabled={act.isPending} onClick={() => run('accept')}>
              {act.isPending ? 'Saving…' : 'Accept into register'}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="xl"
      title={p?.title || 'Proposal'}
      subtitle={p ? `${p.unit_name || 'No unit'} · Risk owner ${p.owner_name || '—'} · ${STATUS_LABEL[p.status]}` : undefined}
      footer={footer}
    >
      {!p ? (
        <p className="px-1 py-6 text-[14px] text-[#586472]">{query.isError ? 'The proposal could not be loaded.' : 'Loading…'}</p>
      ) : (
        <div className="space-y-4 px-1 py-1">
          {p.note && <p className="text-[13px] leading-5 text-[#26323d]"><span className="font-medium">Note from {p.proposed_by_name || 'the risk team'}:</span> {p.note}</p>}
          {p.status === 'returned' && p.review_comment && (
            <p className="rounded-lg bg-[#fef3c7] px-3 py-2 text-[13px] leading-5 text-[#92400e]">
              <span className="font-medium">Returned by {p.reviewed_by_name || 'the risk team'}:</span> {p.review_comment}
            </p>
          )}
          {p.decline_reason && <p className="text-[13px] leading-5 text-[#26323d]"><span className="font-medium">Declined:</span> {p.decline_reason}</p>}

          {mode === 'draft' && draft ? (
            declining ? (
              <div>
                <label htmlFor="rd-reason" className={LABEL}>Why it does not apply <span aria-hidden className="text-[#9b1c1c]">*</span></label>
                <textarea id="rd-reason" rows={3} maxLength={2000} className={AREA} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            ) : (
              <>
                {p.library_risk && (
                  <div className="rounded-lg bg-[#e6f6f3] px-3 py-2">
                    <p className="text-[13px] leading-5 text-[#115e59]">
                      <span className="font-medium">{p.library_risk.objective_id} {p.library_risk.objective_title}.</span> {p.library_risk.objective}
                    </p>
                  </div>
                )}
                <div>
                  <label htmlFor="rd-title" className={LABEL}>Risk <span aria-hidden className="text-[#9b1c1c]">*</span></label>
                  <input id="rd-title" className={FIELD} maxLength={255} value={draft.title} onChange={(e) => set({ title: e.target.value })} required />
                </div>
                <div>
                  <label htmlFor="rd-description" className={LABEL}>Description</label>
                  <textarea id="rd-description" rows={3} className={AREA} value={draft.description} onChange={(e) => set({ description: e.target.value })} />
                </div>
                <fieldset className="rounded-lg border border-[#d8dee4] px-3 pb-3 pt-2">
                  <legend className="px-1 text-[13px] font-medium text-[#26323d]">Before controls (1 to 5)</legend>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div>
                      <label htmlFor="rd-l" className={LABEL}>Likelihood <span aria-hidden className="text-[#9b1c1c]">*</span></label>
                      <select id="rd-l" className={FIELD} value={draft.inherent_likelihood} onChange={(e) => set({ inherent_likelihood: e.target.value })} required>
                        <option value="">Choose</option>
                        {LIKELIHOOD.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="rd-i" className={LABEL}>Impact <span aria-hidden className="text-[#9b1c1c]">*</span></label>
                      <select id="rd-i" className={FIELD} value={draft.inherent_impact} onChange={(e) => set({ inherent_impact: e.target.value })} required>
                        <option value="">Choose</option>
                        {IMPACT.map((l, i) => <option key={l} value={i + 1}>{i + 1} · {l}</option>)}
                      </select>
                    </div>
                    <div className="flex h-10 items-center"><Score likelihood={draft.inherent_likelihood} impact={draft.inherent_impact} /></div>
                  </div>
                </fieldset>
              </>
            )
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-[#d8dee4]">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[#d8dee4] bg-[#f4f6f8]">
                      <th scope="col" className="w-36 px-3 py-2 text-[12px] font-semibold text-[#586472]"><span className="sr-only">Field</span></th>
                      <th scope="col" className="px-3 py-2 text-[12px] font-semibold text-[#586472]">Library</th>
                      <th scope="col" className="px-3 py-2 text-[12px] font-semibold text-[#586472]">Owner&apos;s draft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sideBySide(p).map((r) => (
                      <tr key={r.label} className="border-b border-[#eef1f4] align-top last:border-0">
                        <th scope="row" className="px-3 py-2 text-[13px] font-medium text-[#26323d]">
                          {r.label}
                          {r.changed && <span className="ml-1.5 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-medium text-[#92400e]">Changed</span>}
                        </th>
                        <td className="px-3 py-2 text-[13px] leading-5 text-[#26323d]">{r.library || '—'}</td>
                        <td className="px-3 py-2 text-[13px] leading-5 text-[#1f2933]">{r.draft || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mode === 'review' && (
                <div>
                  <label htmlFor="rd-comment" className={LABEL}>Comments for the owner</label>
                  <textarea id="rd-comment" rows={3} maxLength={4000} className={AREA} value={comment} onChange={(e) => setComment(e.target.value)} />
                  <p className="mt-1 text-[12px] text-[#586472]">Needed to return it. Accepting links the library item&apos;s requirements and controls to the risk.</p>
                </div>
              )}
              {mode === 'view' && p.status === 'drafted' && (
                <p className="text-[13px] leading-5 text-[#586472]">Waiting for the risk team. Someone other than the person who drafted it accepts it into the register.</p>
              )}
            </>
          )}
        </div>
      )}
    </AnimatedModal>
  );
}
