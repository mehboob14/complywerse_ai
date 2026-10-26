'use client';

// A document's approval route on its Approvals view (backend: modules/governance/routes.py through GET .../signoff `route`):
// each stage with each person's state (signed with the date, waiting, not yet asked, asked for changes, delegated), the banner
// while changes asked for are being made, and the author's Resubmit and Withdraw. Shares the sign-off query (['doc-signoff', id]).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Loader2, MessageSquareWarning, RotateCcw, Send, UserRoundPlus } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN, BTN_PRIMARY } from '@/components/governance/docUi';
import { dateTime, day } from '@/lib/documentLifecycle';
import { earlierLine, type PersonState, type RouteStage, type RouteView } from '@/lib/approvalRoutes';
import type { Proposal } from '@/lib/proposals';
import { useSignoff } from './_SignoffControl';
import { ProposalHold } from './[id]/_ProposalsView';

const STATE: Record<PersonState, { label: string; tone: string }> = {
  signed: { label: 'Signed', tone: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  waiting: { label: 'Waiting', tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  not_yet: { label: 'Not yet asked', tone: 'border-gray-300 bg-white text-gray-600' },
  changes_requested: { label: 'Asked for changes', tone: 'border-amber-400 bg-amber-100 text-amber-950' },
  delegated: { label: 'Delegated', tone: 'border-sky-300 bg-sky-50 text-sky-900' },
  not_needed: { label: 'Not needed', tone: 'border-gray-300 bg-white text-gray-600' },
  informed: { label: 'Told', tone: 'border-gray-300 bg-white text-gray-700' },
};
const STAGE_NOTE: Partial<Record<RouteStage['status'], string>> = {
  done: 'Done', current: 'Now', on_hold: 'On hold', waiting: 'Next', not_started: 'Not started', informed: 'Told', skipped: 'Nobody chosen',
};
const how = (s: RouteStage) => (s.kind === 'information' ? 'told, nobody waits'
  : s.order === 'in_turn' && s.people.length > 1 ? 'one after another'
    : s.people.length < 2 ? '' : s.rule === 'any' ? 'any one signs' : s.rule === 'at_least' ? `at least ${s.min_count} sign` : 'everyone signs');
const CHIP = 'rounded-full border border-[#d5dbe1] bg-[#f3f6f8] px-2 py-px text-[11px] text-[#3f4b58]';

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['doc-signoff', 'governance-document', 'document-lifecycle', 'my-document-requests', 'document-chain', 'governance-documents']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Each stage of a route of its own, with each person's state this round. */
export function RouteStages({ route, prepared }: { route: RouteView; prepared?: string }) {
  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-[#fff]">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-[#e1e6eb] px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Approval route</h3>
        {prepared && <span className="text-xs text-[#586472]">prepared by {prepared}</span>}
      </div>
      <ol className="divide-y divide-[#e1e6eb]">
        {route.stages.map((s) => {
          const rule = how(s);
          // "3 d each": the days a person has to act (each of them, when there are several)
          const meta = [s.due_days ? `${s.due_days} d${s.people.length > 1 ? ' each' : ''}` : '', STAGE_NOTE[s.status]].filter(Boolean).join(' · ');
          return (
            <li key={s.position} className={`px-4 py-3 ${s.status === 'current' || s.status === 'on_hold' ? 'bg-[#f6fbfa]' : ''}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  s.status === 'done' || s.status === 'informed' ? 'bg-primary-600 text-white' : s.status === 'current' || s.status === 'on_hold' ? 'border-2 border-primary-600 text-primary-700' : 'border border-gray-300 text-gray-500'}`}>
                  {s.status === 'done' || s.status === 'informed' ? <Check className="h-3 w-3" aria-label="done" /> : s.position}
                </span>
                <span className="text-sm font-semibold text-gray-900">{s.name}</span>
                {rule && <span className={CHIP}>{rule}</span>}
                {meta && <span className="text-[11px] text-[#586472]">{meta}</span>}
                {s.restarted && s.status !== 'done' && <span className="text-[11px] text-[#586472]" title="Started again after changes">restarted</span>}
                {s.progress && s.progress.required > 0 && (
                  <span className="relative ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[#26323d]" title={`${s.progress.signed} of ${s.progress.required} signed`}>
                    <Check className="h-3 w-3" aria-hidden /> {s.progress.signed}/{s.progress.required}<span className="sr-only"> signed</span>
                  </span>
                )}
              </div>
              <ul className="mt-2 space-y-1.5 pl-7">
                {s.people.map((p) => {
                  const st = STATE[p.state];
                  return (
                    <li key={p.assignment_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-medium text-gray-900">{p.display}</span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium ${st.tone}`}>{st.label}</span>
                      {p.state === 'signed' && (
                        <span className="text-[#586472]">{p.signer && p.signer !== p.display ? `${p.signer}${p.on_behalf_of ? ` for ${p.on_behalf_of}` : ''}, ` : ''}{dateTime(p.at)}</span>
                      )}
                      {p.state === 'waiting' && p.due_date && <span className="inline-flex items-center gap-1 text-[#586472]"><Clock className="h-3 w-3" aria-hidden />due {day(p.due_date)}</span>}
                      {p.state === 'delegated' && p.delegated_to && <span className="inline-flex items-center gap-1 text-[#586472]"><UserRoundPlus className="h-3 w-3" aria-hidden />to {p.delegated_to}</span>}
                      {p.comment && <span className="basis-full italic text-[#26323d]">“{p.comment}”</span>}
                      {p.earlier && (
                        <span className="basis-full text-[11px] text-[#586472]">
                          {earlierLine(p.earlier)}{p.earlier.by && p.earlier.by !== p.display ? ` (${p.earlier.by}${p.earlier.on_behalf_of ? ` for ${p.earlier.on_behalf_of}` : ''})` : ''}
                          {p.earlier.at ? `, ${dateTime(p.earlier.at)}` : ''}
                          {p.earlier.kind === 'changes' && p.earlier.comment ? <span className="italic"> · “{p.earlier.comment}”</span> : null}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** While changes asked for are being made: who asked, what, and (for whoever may change it) Resubmit and Withdraw. A hold for a
 *  change someone proposed (kind "proposal") says who decides on it and, after a rejection, what the proposer does. */
export function HoldBanner({ documentId, onResubmit, onProposeAgain }: { documentId: number; onResubmit?: () => void; onProposeAgain?: (p: Proposal) => void }) {
  const { data } = useSignoff(documentId);
  const [open, setOpen] = useState(false);
  const hold = data?.route?.hold;
  if (!hold) return null;
  const where = data?.route?.stages.find((s) => s.position === hold.stage_position)?.name;
  if (hold.kind === 'proposal') return <ProposalHold documentId={documentId} hold={hold} stage={where} onProposeAgain={onProposeAgain} />;
  return (
    <section className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2" role="status">
      <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
      <p className="min-w-[14rem] flex-1 text-[13px] text-amber-950">
        <span className="font-semibold">{hold.requested_by || 'Someone'} asked for changes{hold.requested_at ? ` on ${day(hold.requested_at)}` : ''}</span>
        {where ? ` at ${where}` : ''}: {hold.comment}
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <InfoTip align="end" label="About the changes asked for"
          text={`Nobody signs until the changes are made and it is resubmitted. Then everyone ${where ? `at ${where}` : 'at this stage'} signs it again, ${hold.requested_by || 'they'} among them, and sees what changed; the stages before stand. A major change starts again from the first stage.`} />
        {data?.can_resubmit && (
          <button type="button" onClick={() => (onResubmit ? onResubmit() : setOpen(true))} className={BTN_PRIMARY}>
            <Send className="h-4 w-4" aria-hidden /> Resubmit
          </button>
        )}
      </div>
      {!onResubmit && <ResubmitDialog documentId={documentId} open={open} onClose={() => setOpen(false)} />}
    </section>
  );
}

/** The author says the changes are made, with a note for the person who asked. */
export function ResubmitDialog({ documentId, open, onClose }: { documentId: number; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const { data } = useSignoff(documentId);
  const [note, setNote] = useState('');
  const [major, setMajor] = useState(false);
  const hold = data?.route?.hold;
  const where = data?.route?.stages.find((s) => s.position === hold?.stage_position)?.name;
  const resubmit = useMutation({
    mutationFn: async () => (await governanceApi.resubmitSignoff(documentId, { note: note.trim() || undefined, major })).data,
    onSuccess: (out: { outcome?: string } | undefined) => {
      toast({ type: 'success', title: 'Resubmitted',
              message: out?.outcome === 'restarted' ? 'A major change: it is signed again from the first stage.'
                : `Everyone ${where ? `at ${where}` : 'at that stage'} is asked to sign it again, and told what changed.` });
      setNote(''); setMajor(false); onClose(); refresh();
    },
    onError: (e: any) => toast({ type: 'error', title: 'Not resubmitted', message: e?.response?.data?.detail || 'Could not resubmit it.' }),
  });
  return (
    <AnimatedModal isOpen={open} onClose={onClose} size="md" title="Resubmit"
      subtitle={hold ? `${hold.requested_by || 'Someone'} asked: ${hold.comment}` : undefined}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="button" onClick={() => resubmit.mutate()} disabled={resubmit.isPending || !hold} className={BTN_PRIMARY}>
            {resubmit.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Resubmit
          </button>
        </div>
      )}>
      <div className="space-y-3 px-5 py-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-[#26323d]" htmlFor={`resubmit-note-${documentId}`} title="The person who asked for changes reads it">What you changed</label>
          <textarea id={`resubmit-note-${documentId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
            className="w-full rounded-lg border border-[#b8c4c8] px-3 py-2 text-sm focus:border-[#0f766e] focus:outline-none" placeholder="Section 2 now names who approves exceptions." />
        </div>
        <div className="flex items-start justify-between gap-2">
          <label className="flex items-start gap-2 text-sm text-[#26323d]">
            <input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#b8c4c8]" />
            <span>Major change <span className="text-xs text-[#586472]">· everyone signs again from the first stage</span></span>
          </label>
          <InfoTip align="end" label="About major changes"
            text={`Otherwise the size of the change decides: after a minor one everyone ${where ? `at ${where}` : 'at that stage'} signs it again, ${hold?.requested_by || 'the person who asked'} among them; the stages before stand.`} />
        </div>
      </div>
    </AnimatedModal>
  );
}

/** The author takes it back from review: a draft again, and everyone still asked is told. */
export function WithdrawButton({ documentId, className = '' }: { documentId: number; className?: string }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const { data } = useSignoff(documentId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const withdraw = useMutation({
    mutationFn: async () => governanceApi.withdrawSignoff(documentId, { reason: reason.trim() || undefined }),
    onSuccess: () => { toast({ type: 'success', title: 'Withdrawn', message: 'It is a draft again; everyone still asked was told.' }); setOpen(false); setReason(''); refresh(); },
    onError: (e: any) => toast({ type: 'error', title: 'Not withdrawn', message: e?.response?.data?.detail || 'Could not withdraw it.' }),
  });
  if (!data?.can_withdraw) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Withdraw from review" className={`${BTN} ${className}`}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Withdraw
      </button>
      <AnimatedModal isOpen={open} onClose={() => setOpen(false)} size="md" title="Withdraw from review?"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={BTN}>Cancel</button>
            <button type="button" onClick={() => withdraw.mutate()} disabled={withdraw.isPending} className={`${BTN_PRIMARY} !bg-[#9b1c1c] hover:!bg-[#7f1d1d]`}>
              {withdraw.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Withdraw
            </button>
          </div>
        )}>
        <div className="space-y-2 px-5 py-4">
          <p className="text-sm text-[#26323d]">It goes back to draft and the open requests end; the people asked are told. Submitting again starts from the first stage.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional)" aria-label="Reason"
            className="w-full rounded-lg border border-[#b8c4c8] px-3 py-2 text-sm focus:border-[#0f766e] focus:outline-none" />
        </div>
      </AnimatedModal>
    </>
  );
}
