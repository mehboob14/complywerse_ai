'use client';

// A document's approval route on its Approvals view (backend: modules/governance/routes.py through GET .../signoff `route`):
// each stage with each person's state (signed with the date, waiting, not yet asked, asked for changes, delegated), the banner
// while changes asked for are being made, and the author's Resubmit and Withdraw. Shares the sign-off query (['doc-signoff', id]).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Loader2, MessageSquareWarning, RotateCcw, Send, UserRoundPlus } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import { dateTime, day } from '@/lib/documentLifecycle';
import { earlierLine, type PersonState, type RouteStage, type RouteView } from '@/lib/approvalRoutes';
import { useSignoff } from './_SignoffControl';

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
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Its approval route</h3>
        {prepared && <span className="text-xs text-gray-600">prepared by {prepared}</span>}
      </div>
      <ol className="divide-y divide-gray-100">
        {route.stages.map((s) => (
          <li key={s.position} className={`px-4 py-3 ${s.status === 'current' || s.status === 'on_hold' ? 'bg-[#f6fbfa]' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                s.status === 'done' || s.status === 'informed' ? 'bg-primary-600 text-white' : s.status === 'current' || s.status === 'on_hold' ? 'border-2 border-primary-600 text-primary-700' : 'border border-gray-300 text-gray-500'}`}>
                {s.status === 'done' || s.status === 'informed' ? <Check className="h-3 w-3" aria-label="done" /> : s.position}
              </span>
              <span className="text-sm font-semibold text-gray-900">{s.name}</span>
              <span className="text-[11px] text-gray-500">{[how(s), s.due_days ? `${s.due_days} days each` : '', STAGE_NOTE[s.status],
                s.restarted && s.status !== 'done' ? 'started again after changes' : ''].filter(Boolean).join(' · ')}</span>
              {s.progress && s.progress.required > 0 && <span className="ml-auto text-[11px] font-medium text-gray-700">{s.progress.signed}/{s.progress.required} signed</span>}
            </div>
            <ul className="mt-2 space-y-1.5 pl-7">
              {s.people.map((p) => {
                const st = STATE[p.state];
                return (
                  <li key={p.assignment_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-medium text-gray-900">{p.display}</span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium ${st.tone}`}>{st.label}</span>
                    {p.state === 'signed' && (
                      <span className="text-gray-600">{p.signer && p.signer !== p.display ? `${p.signer}${p.on_behalf_of ? ` for ${p.on_behalf_of}` : ''}, ` : ''}{dateTime(p.at)}</span>
                    )}
                    {p.state === 'waiting' && p.due_date && <span className="inline-flex items-center gap-1 text-gray-600"><Clock className="h-3 w-3" aria-hidden />due {day(p.due_date)}</span>}
                    {p.state === 'delegated' && p.delegated_to && <span className="inline-flex items-center gap-1 text-gray-600"><UserRoundPlus className="h-3 w-3" aria-hidden />to {p.delegated_to}</span>}
                    {p.comment && <span className="basis-full italic text-gray-700">“{p.comment}”</span>}
                    {p.earlier && (
                      <span className="basis-full text-[11px] text-gray-600">
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
        ))}
      </ol>
    </section>
  );
}

/** While changes asked for are being made: who asked, what, and (for whoever may change it) Resubmit and Withdraw. */
export function HoldBanner({ documentId, onResubmit }: { documentId: number; onResubmit?: () => void }) {
  const { data } = useSignoff(documentId);
  const [open, setOpen] = useState(false);
  const hold = data?.route?.hold;
  if (!hold) return null;
  const where = data?.route?.stages.find((s) => s.position === hold.stage_position)?.name;
  return (
    <section className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3" role="status">
      <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
      <div className="min-w-[14rem] flex-1 text-sm text-amber-950">
        <p>
          <span className="font-semibold">{hold.requested_by || 'Someone'} asked for changes{hold.requested_at ? ` on ${day(hold.requested_at)}` : ''}</span>
          {where ? ` at ${where}` : ''}: {hold.comment}
        </p>
        <p className="mt-0.5 text-xs text-amber-900">
          Nobody signs until the changes are made and it is resubmitted. Then everyone {where ? `at ${where}` : 'at this stage'} signs it again, {hold.requested_by || 'they'} among them, and sees what changed; the stages before stand. A major change starts again from the first stage.
        </p>
      </div>
      {data?.can_resubmit && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => (onResubmit ? onResubmit() : setOpen(true))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58]">
            <Send className="h-4 w-4" aria-hidden /> Resubmit
          </button>
        </div>
      )}
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
          <button type="button" onClick={onClose} className="rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#26323d] hover:bg-[#f3f6f8]">Cancel</button>
          <button type="button" onClick={() => resubmit.mutate()} disabled={resubmit.isPending || !hold}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50">
            {resubmit.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Resubmit
          </button>
        </div>
      )}>
      <div className="space-y-3 px-5 py-4">
        <label className="block text-xs font-medium text-[#26323d]" htmlFor={`resubmit-note-${documentId}`}>What you changed (they read it)</label>
        <textarea id={`resubmit-note-${documentId}`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
          className="w-full rounded-lg border border-[#b8c4c8] px-3 py-2 text-sm focus:border-[#0f766e] focus:outline-none" placeholder="Section 2 now names who approves exceptions." />
        <label className="flex items-start gap-2 text-sm text-[#26323d]">
          <input type="checkbox" checked={major} onChange={(e) => setMajor(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#b8c4c8]" />
          <span>It is a major change: everyone signs again from the first stage.
            <span className="block text-[11px] text-[#586472]">Otherwise the size of the change decides: after a minor one everyone {where ? `at ${where}` : 'at that stage'} signs it again, {hold?.requested_by || 'the person who asked'} among them; the stages before stand.</span>
          </span>
        </label>
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
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 ${className}`}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Withdraw from review
      </button>
      <AnimatedModal isOpen={open} onClose={() => setOpen(false)} size="md" title="Withdraw from review?"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#26323d] hover:bg-[#f3f6f8]">Cancel</button>
            <button type="button" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#9b1c1c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#7f1d1d] disabled:opacity-50">
              {withdraw.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Withdraw
            </button>
          </div>
        )}>
        <div className="space-y-2 px-5 py-4">
          <p className="text-sm text-[#26323d]">It becomes a draft again and what was asked of its reviewers and approvers ends; they are told. Sending it again starts from the first stage.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why (optional, they read it)"
            className="w-full rounded-lg border border-[#b8c4c8] px-3 py-2 text-sm focus:border-[#0f766e] focus:outline-none" />
        </div>
      </AnimatedModal>
    </>
  );
}
