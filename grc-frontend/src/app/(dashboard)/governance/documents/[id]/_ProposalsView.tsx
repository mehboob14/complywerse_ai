'use client';

/**
 * Proposed changes (D35): a change to the document's text, file or statements made by someone who may edit it but is not its owner or
 * author waits here for the owner's (or the author's) decision. The view lists them (who, when, what, its status, the proposer's
 * message); the one chosen shows the message, the library's text beside the proposed one (two Word or PDF panes and the changes for a
 * file), a statement's fields before and after, and Accept / Reject for the person who decides, Withdraw and Propose again for the
 * proposer. Also here: the page's banner, the route's hold of kind "proposal", the proposer's note in the writers' dialogs, and the
 * handling of a writer's {proposed: true} answer. Calls and words: lib/proposals.ts.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Check, GitPullRequest, Loader2, RotateCcw, Send, Undo2, X } from 'lucide-react';
import { governanceApi } from '@/lib/api';
import { problemOf } from '@/lib/studio/api';
import { dateTime, day } from '@/lib/documentLifecycle';
import type { RouteHold } from '@/lib/approvalRoutes';
import {
  STATUS_LABEL, acceptLine, compareTitles, deciderName, fieldRows, goesToLine, holdLine, isMine, mayProposeAgain, messageLabel, pageBanner,
  pick, proposalHref, proposalsApi, proposalsKey, proposedOf, proposedToast, rejectLine, staleLine, staleOf, whatLine,
  type DocumentCompare, type Proposal, type ProposalStatus,
} from '@/lib/proposals';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useToast } from '@/components/ui/ToastProvider';
import WordView from '@/components/governance/WordView';
import { useMyUserId } from '@/components/governance/DocumentTaskActions';
import RedlineView, { StatsLine } from '../studio/_components/RedlineView';
import { InitialsAvatar } from '../_workspace/lib';
import { useSignoff } from '../_SignoffControl';
import { retryUnlessRefused } from '../_view/docRoute';

const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const DANGER = 'inline-flex items-center gap-1.5 rounded-lg bg-[#b42318] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#912018] disabled:opacity-50';
const REJECT = 'inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-[#9b1c1c] hover:bg-rose-50 disabled:opacity-50';
const FIELD = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:border-[#0f766e] focus:outline-none focus:ring-1 focus:ring-[#0f766e]';
const MUTED = 'text-[#586472]';
const NONE: Proposal[] = [];

const PILL: Record<ProposalStatus, string> = {
  pending: 'border-amber-300 bg-amber-50 text-amber-900', accepted: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  rejected: 'border-rose-300 bg-rose-50 text-rose-800', withdrawn: 'border-[#c3ccd5] bg-[#eef1f4] text-[#3f4b58]',
};
// after an Accept, a Reject or a Withdraw: the document, its versions, statements, review and tasks may all have moved
const AFTER_DECISION = ['document-proposals', 'document-proposal-compare', 'governance-document', 'document-access', 'doc-signoff', 'document-lifecycle',
  'document-chain', 'document-chain-redline', 'document-versions', 'document-view-html', 'governance-documents', 'document-policy-statements',
  'my-document-requests', 'document-sync', 'document-file-blob'];
// after a change became a proposal: the document is as it was; the list, the hold, the requests and the Change log are not
const AFTER_PROPOSING = ['document-proposals', 'doc-signoff', 'document-lifecycle', 'my-document-requests', 'document-chain'];

// ── reading ──────────────────────────────────────────────────────────────────
/** The document's proposals (`['document-proposals', id]`). A server without them answers 404: nothing is shown, nothing changes. */
export function useProposals(documentId: number | null | undefined) {
  return useQuery({ queryKey: proposalsKey(documentId), queryFn: () => proposalsApi.list(documentId as number), enabled: !!documentId,
    staleTime: 15_000, retry: retryUnlessRefused });
}

/** The document (the same query as the document page and the studio's Details). */
function useDocument(documentId: number | null | undefined) {
  return useQuery({ queryKey: ['governance-document', documentId], queryFn: async () => (await governanceApi.getDocument(documentId as number)).data as any,
    enabled: !!documentId, retry: retryUnlessRefused });
}

/** Whether this person's changes go to the document's owner first (they may edit it but do not decide), and who decides. While the
 *  list is unknown (loading, or a server from before proposals) nothing is proposed: the screens behave as before. */
export function useProposalRole(documentId: number | null | undefined) {
  const list = useProposals(documentId);
  const doc = useDocument(documentId);
  return { proposes: list.data?.can_decide === false, decider: deciderName(doc.data), list: list.data };
}

/** Handles a writer's answer: a proposal is told (the server's sentence) and the lists that show it are read again. Returns whether it
 *  was one; anything else is the writer's usual answer. */
export function useProposedAnswer() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return (data: unknown, decider?: string): boolean => {
    const answer = proposedOf(data);
    if (!answer) return false;
    toast({ type: 'success', ...proposedToast(answer, decider) });
    for (const key of AFTER_PROPOSING) qc.invalidateQueries({ queryKey: [key] });
    return true;
  };
}

// ── the proposer's note in a writer's dialog ─────────────────────────────────
/** "This goes to <owner> to accept or reject…" and the required message the owner reads. */
export function ProposeNote({ id, decider, value, onChange, placeholder, autoFocus }: {
  id: string; decider: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <p className="flex gap-1.5 rounded-lg border border-[#99d5cc] bg-[#effaf8] px-2.5 py-2 text-xs text-[#0b3f38]">
        <Send className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0b4f46]" aria-hidden /> {goesToLine(decider)}
      </p>
      <label htmlFor={id} className="block text-xs font-semibold text-[#26323d]">
        {messageLabel(decider)} <span className="font-normal text-[#586472]">(required)</span>
      </label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={2000} required aria-required="true" autoFocus={autoFocus}
        placeholder={placeholder ?? 'e.g. Section 2 now names who approves exceptions, as Legal asked'} className={FIELD} />
    </div>
  );
}

// ── small parts ──────────────────────────────────────────────────────────────
function StatusPill({ status, stale }: { status: ProposalStatus; stale?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${PILL[status] ?? PILL.withdrawn}`}>
      {STATUS_LABEL[status] ?? status}{stale && status === 'pending' ? ' · out of date' : ''}
    </span>
  );
}

function Layout({ value, onChange }: { value: 'sides' | 'redline'; onChange: (v: 'sides' | 'redline') => void }) {
  return (
    <div className="inline-flex rounded-lg bg-[#eef1f4] p-0.5" role="group" aria-label="Show the change">
      {(['sides', 'redline'] as const).map((k) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${value === k ? 'bg-white text-[#0b4f46] shadow-card' : 'text-[#3f4b58] hover:text-[#1f2933]'}`}>
          {k === 'sides' ? 'Side by side' : 'One column'}
        </button>
      ))}
    </div>
  );
}

// ── deciding ─────────────────────────────────────────────────────────────────
type Decision = 'accept' | 'reject' | 'withdraw';

/** Accept (what it makes, an optional note), Reject (a note, required) or Withdraw (the proposer), asked first. */
function DecisionDialog({ documentId, p, mode, onClose }: { documentId: number; p: Proposal; mode: Decision; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const doc = useDocument(documentId).data;
  const route = useSignoff(documentId).data?.route;
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const proposer = p.proposed_by?.name || 'The proposer';
  const decider = deciderName(doc);
  const at = route?.hold?.stage_position ?? route?.current;
  const stage = route?.stages.find((s) => s.position === at)?.name ?? null;
  const run = useMutation({
    mutationFn: async () => (mode === 'accept' ? proposalsApi.accept(documentId, p.id, note)
      : mode === 'reject' ? proposalsApi.reject(documentId, p.id, note) : proposalsApi.withdraw(documentId, p.id)),
    onSuccess: (r) => {
      const version = mode === 'accept' ? (r as { version?: { number: string } | null }).version : null;
      toast(mode === 'accept' ? { type: 'success', title: 'Change accepted', message: `${version ? `It is version ${version.number} now. ` : ''}${proposer} is told.` }
        : mode === 'reject' ? { type: 'success', title: 'Change not accepted', message: `${proposer} is told, with your note.` }
        : { type: 'success', title: 'Change withdrawn', message: 'It no longer waits for a decision; the document stays as it is.' });
      for (const key of AFTER_DECISION) qc.invalidateQueries({ queryKey: [key] });
      onClose();
    },
    onError: (e) => {
      const stale = staleOf(e);
      setProblem(stale ?? problemOf(e));
      if (stale) qc.invalidateQueries({ queryKey: proposalsKey(documentId) });        // it now says so, and offers only Reject
    },
  });
  const noteId = `proposal-note-${p.id}`;
  const needsNote = mode === 'reject';
  const title = mode === 'accept' ? `Accept ${proposer}'s change?` : mode === 'reject' ? `Reject ${proposer}'s change?` : 'Withdraw your change?';
  return (
    <AnimatedModal isOpen onClose={onClose} size="md" title={title} subtitle={whatLine(p)}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="button" onClick={() => { setProblem(null); run.mutate(); }} disabled={run.isPending || (needsNote && !note.trim()) || (mode === 'accept' && !!staleOf(run.error))}
            className={mode === 'accept' ? PRIMARY : DANGER}>
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : mode === 'accept' ? <Check className="h-4 w-4" aria-hidden />
              : mode === 'reject' ? <X className="h-4 w-4" aria-hidden /> : <Undo2 className="h-4 w-4" aria-hidden />}
            {mode === 'accept' ? 'Accept' : mode === 'reject' ? 'Reject' : 'Withdraw'}
          </button>
        </div>
      )}>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm text-[#26323d]">
          {mode === 'accept' ? acceptLine(p, { status: doc?.status ?? '', current: doc?.current_version, inForce: doc?.version_in_force }, stage)
            : mode === 'reject' ? rejectLine(proposer, doc?.status ?? '')
            : `It no longer waits for ${decider}'s decision, and the document stays as it is.`}
        </p>
        {mode !== 'withdraw' && (
          <label htmlFor={noteId} className="block">
            <span className="text-xs font-semibold text-[#26323d]">
              {mode === 'reject' ? `Why — ${proposer} reads this` : `A note for ${proposer}`}{' '}
              <span className="font-normal text-[#586472]">({mode === 'reject' ? 'required' : 'optional'})</span>
            </span>
            <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} autoFocus
              required={needsNote} aria-required={needsNote} className={`${FIELD} mt-1`}
              placeholder={mode === 'reject' ? 'e.g. Keep the current wording of section 2: Legal agreed it last year.' : ''} />
          </label>
        )}
        {problem && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[#7a1616]" role="alert">{problem}</p>}
      </div>
    </AnimatedModal>
  );
}

/** The buttons a proposal offers this person: Accept and Reject (who decides; a stale one only Reject), Propose again and Withdraw (the
 *  proposer). Nothing for anyone else. */
export function ProposalActions({ documentId, p, onProposeAgain, small = false }: {
  documentId: number; p: Proposal; onProposeAgain?: (p: Proposal) => void; small?: boolean;
}) {
  const meId = useMyUserId();
  const [mode, setMode] = useState<Decision | null>(null);
  const accept = p.status === 'pending' && p.may_accept && !p.stale;
  const reject = p.status === 'pending' && p.may_reject;
  const again = !!onProposeAgain && mayProposeAgain(p, meId);
  const withdraw = p.may_withdraw && (p.status === 'pending' || p.status === 'rejected');
  if (!accept && !reject && !again && !withdraw) return null;
  const size = small ? ' !px-2.5 !py-1 !text-xs' : '';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {accept && <button type="button" onClick={() => setMode('accept')} className={PRIMARY + size}><Check className="h-4 w-4" aria-hidden /> Accept</button>}
      {reject && <button type="button" onClick={() => setMode('reject')} className={REJECT + size}><X className="h-4 w-4" aria-hidden /> Reject</button>}
      {again && <button type="button" onClick={() => onProposeAgain?.(p)} className={(accept || reject ? BTN : PRIMARY) + size}><RotateCcw className="h-4 w-4" aria-hidden /> Propose again</button>}
      {withdraw && <button type="button" onClick={() => setMode('withdraw')} className={BTN + size}><Undo2 className="h-4 w-4" aria-hidden /> Withdraw</button>}
      {mode && <DecisionDialog documentId={documentId} p={p} mode={mode} onClose={() => setMode(null)} />}
    </div>
  );
}

// ── the banner on the document page and the route's hold ─────────────────────
/** "2 changes are waiting for your decision · Review them" for the owner or author; "Your change is waiting for Olivia's decision"
 *  (or "Olivia did not accept your change") for the proposer. */
export function ProposalsBanner({ documentId, doc, onOpen }: { documentId: number; doc: any; onOpen: (pid: number) => void }) {
  const list = useProposals(documentId).data;
  const meId = useMyUserId();
  const b = pageBanner(list, meId, deciderName(doc));
  if (!b) return null;
  const rose = b.kind === 'rejected';
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 ${rose ? 'border-rose-300 bg-rose-50' : 'border-amber-300 bg-amber-50'}`} role="status">
      <GitPullRequest className={`h-4 w-4 shrink-0 ${rose ? 'text-[#9b1c1c]' : 'text-amber-700'}`} aria-hidden />
      <span className={`min-w-0 flex-1 text-sm font-medium ${rose ? 'text-[#7a1616]' : 'text-amber-950'}`}>{b.text}</span>
      <button type="button" onClick={() => onOpen(b.proposalId)} className={b.kind === 'decide' ? PRIMARY : BTN}>{b.action}</button>
    </div>
  );
}

/** The route on hold for a proposed change: who proposed it and who decides; the decider reviews it; after a rejection the proposer
 *  signs the document as it is (their own step, `my_step.may_sign_as_is`) or proposes again. */
export function ProposalHold({ documentId, hold, stage, onProposeAgain }: {
  documentId: number; hold: RouteHold; stage?: string | null; onProposeAgain?: (p: Proposal) => void;
}) {
  const signoff = useSignoff(documentId).data;
  const list = useProposals(documentId).data;
  const doc = useDocument(documentId).data;
  const meId = useMyUserId();
  const p = list?.items.find((x) => x.id === hold.proposal_id) ?? null;
  const decider = deciderName(doc);
  const proposer = p?.proposed_by?.name || hold.requested_by || 'Someone';
  const me: 'decider' | 'proposer' | 'other' = list?.can_decide ? 'decider'
    : (p ? isMine(p, meId) : meId != null && hold.requested_by_id === meId) ? 'proposer' : 'other';
  const status = hold.proposal_status ?? p?.status ?? 'pending';
  const href = proposalHref(documentId, hold.proposal_id);
  const rejected = status === 'rejected';
  const message = p?.message || hold.comment;
  return (
    <section className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3" role="status">
      <GitPullRequest className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
      <div className="min-w-[14rem] flex-1 text-sm text-amber-950">
        <p><span className="font-semibold">{holdLine({ proposer, decider, status, me })}</span>{stage ? ` (at ${stage})` : ''}.</p>
        {rejected && p?.decision_note ? (
          <p className="mt-0.5">{me === 'decider' ? 'Your note' : `${p.decided_by?.name || decider} wrote`}: “{p.decision_note}”</p>
        ) : message ? <p className="mt-0.5 italic">“{message}”</p> : null}
        <p className="mt-0.5 text-xs text-amber-900">
          {rejected ? `Nobody signs until ${me === 'proposer' ? 'you sign it as it is or propose another change' : `${proposer} signs it as it is or proposes another change`}.`
            : `Nobody signs until ${me === 'decider' ? 'you decide' : `${decider} decides`}. Accepted, it becomes the next version and everyone at this stage reviews again; a major change starts again from the first stage.`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {me === 'decider' && !rejected && <Link href={href} className={PRIMARY}>Review it</Link>}
        {me === 'proposer' && rejected && signoff?.my_step?.may_sign_as_is && <Link href={`/governance/documents/${documentId}?act=sign`} className={PRIMARY}>Sign it as it is</Link>}
        {me === 'proposer' && rejected && (onProposeAgain && p
          ? <button type="button" onClick={() => onProposeAgain(p)} className={BTN}><RotateCcw className="h-4 w-4" aria-hidden /> Propose again</button>
          : <Link href={href} className={BTN}>Propose again</Link>)}
        {me !== 'decider' && !rejected && <Link href={href} className={BTN}>See it</Link>}
      </div>
    </section>
  );
}

// ── the comparison ───────────────────────────────────────────────────────────
function StatementChange({ p }: { p: Proposal }) {
  const rows = fieldRows(p.statement?.before, p.statement?.after);
  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-white p-3 sm:p-4" aria-label="The statement before and after">
      <h4 className="text-sm font-semibold text-[#1f2933]">
        {p.statement?.code ? `Statement ${p.statement.code}` : 'A new statement'}{p.source === 'statement_delete' ? ': removed' : ''}
      </h4>
      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-[#d5dbe1]">
            <th scope="col" className="w-24 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#586472] sm:w-32">Field</th>
            <th scope="col" className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#586472]">Now</th>
            <th scope="col" className="px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#586472]">Proposed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b border-[#eef1f4] ${r.changed ? 'bg-[#fffbeb]' : ''}`}>
              <th scope="row" className="px-2 py-1.5 text-left align-top text-[12px] font-semibold text-[#3f4b58]">
                {r.label}{r.changed && <span className="block text-[10px] font-medium text-[#8a6100]">changed</span>}
              </th>
              <td className="break-words px-2 py-1.5 align-top text-[13px] leading-relaxed text-[#26323d]">{r.before}</td>
              <td className={`break-words px-2 py-1.5 align-top text-[13px] leading-relaxed ${r.changed ? 'font-medium text-[#1f2933]' : 'text-[#26323d]'}`}>{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const CHANGE_KIND: Record<string, string> = { inserted: 'Added', deleted: 'Removed', modified: 'Changed' };

/** The changes between the two files, as words (beside the two panes). */
function ChangeList({ q, className = '' }: { q: UseQueryResult<DocumentCompare, unknown>; className?: string }) {
  const changes = q.data?.changes ?? [];
  return (
    <section className={`min-w-0 rounded-xl border border-[#d5dbe1] bg-white p-3 ${className}`} aria-label="What changed">
      <h4 className="text-sm font-semibold text-[#1f2933]">What changed</h4>
      {q.data && <p className={`text-xs ${MUTED}`}><StatsLine stats={q.data.stats} /></p>}
      {q.isLoading && <p className={`mt-2 text-sm ${MUTED}`} role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden /> Comparing…</p>}
      {q.isError && <p className="mt-2 text-sm text-[#7a1616]" role="alert">{problemOf(q.error, 'The two files could not be compared as text.')}</p>}
      {q.data && !changes.length && <p className={`mt-2 text-sm ${MUTED}`}>No words changed: only the file did.</p>}
      {changes.length > 0 && (
        <ol className="mt-2 space-y-2 2xl:max-h-[70vh] 2xl:overflow-y-auto">
          {changes.map((h) => (
            <li key={h.id} className="rounded-lg border border-[#e3e8ec] p-2">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[#26323d]">
                <span className="min-w-0 break-words">{h.section || 'Top of the document'}</span>
                <span className="rounded-full bg-[#eef1f4] px-1.5 py-px text-[10px] text-[#3f4b58]">{CHANGE_KIND[h.status] ?? 'Changed'}</span>
              </p>
              {h.status !== 'inserted' && h.before_text && (
                <div className="mt-1 rounded border-l-[3px] border-l-rose-500 bg-rose-50/60 px-2 py-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#7a1616]">Now</p>
                  <p className="whitespace-pre-wrap break-words text-[12px] text-rose-950">{h.before_text}</p>
                </div>
              )}
              {h.status !== 'deleted' && h.after_text && (
                <div className="mt-1 rounded border-l-[3px] border-l-emerald-500 bg-emerald-50/60 px-2 py-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Proposed</p>
                  <p className="whitespace-pre-wrap break-words text-[12px] text-emerald-950">{h.after_text}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** One file of the comparison: a Word file as Word draws it, a PDF in the browser's own viewer. */
function FilePane({ label, q, name }: { label: string; q: UseQueryResult<Blob, unknown>; name?: string | null }) {
  const blob = q.data ?? null;
  const pdf = !!blob && (/pdf/i.test(blob.type) || (!/word|officedocument/i.test(blob.type) && /\.pdf$/i.test(name ?? '')));
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || !pdf) { setUrl(null); return; }
    const u = URL.createObjectURL(blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, pdf]);
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#d5dbe1] bg-white" aria-label={label}>
      <h4 className="border-b border-[#e3e8ec] px-3 py-2 text-xs font-semibold text-[#1f2933]">{label}</h4>
      <div className="h-[70vh] min-h-[320px] overflow-y-auto bg-[#e8ecf0]">
        {q.isError ? <p className="p-4 text-sm text-[#7a1616]" role="alert">This file could not be read. Try again later, or download it from the document.</p>
          : pdf ? (url ? <iframe src={url} title={label} className="h-full w-full" /> : null)
          : <WordView file={blob} label={label} />}
        {q.isLoading && <p className={`p-4 text-sm ${MUTED}`} role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden /> Reading the file…</p>}
      </div>
    </section>
  );
}

function DocumentChange({ documentId, doc, p }: { documentId: number; doc: any; p: Proposal }) {
  const [layout, setLayout] = useState<'sides' | 'redline'>('sides');
  const compareQ = useQuery({ queryKey: ['document-proposal-compare', documentId, p.id], queryFn: () => proposalsApi.compare(documentId, p.id),
    staleTime: 60_000, retry: retryUnlessRefused });
  // the document's own file, and the proposed file (fetched only for a proposal that carries one)
  const nowQ = useQuery({ queryKey: ['document-file-blob', documentId, doc?.current_version], enabled: p.has_file, staleTime: 60_000, retry: retryUnlessRefused,
    queryFn: async () => { const r = await governanceApi.downloadDocumentFile(documentId); return r.data instanceof Blob ? r.data : new Blob([r.data as BlobPart]); } });
  const fileQ = useQuery({ queryKey: ['document-proposal-file', documentId, p.id], queryFn: () => proposalsApi.file(documentId, p.id), enabled: p.has_file,
    staleTime: Infinity, retry: retryUnlessRefused });
  const titles = compareTitles(p, doc?.current_version, day);
  if (p.has_file) {
    return (
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <FilePane label={titles.before} q={nowQ} name={doc?.file_name} />
        <FilePane label={titles.after} q={fileQ} name={doc?.file_name} />
        <ChangeList q={compareQ} className="order-first lg:col-span-2 2xl:order-none 2xl:col-span-1" />
      </div>
    );
  }
  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-white p-3 sm:p-4" aria-label="The library's text and the proposed text">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs ${MUTED}`}>{compareQ.data ? <StatsLine stats={compareQ.data.stats} /> : null}{compareQ.data ? ' · ' : ''}Green is added, red is removed.</p>
        <Layout value={layout} onChange={setLayout} />
      </div>
      {compareQ.isLoading && <p className={`text-sm ${MUTED}`} role="status"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-hidden /> Comparing…</p>}
      {compareQ.isError && <p className="text-sm text-[#7a1616]" role="alert">{problemOf(compareQ.error, 'The change could not be compared with the library.')}</p>}
      {compareQ.data && (
        <RedlineView rows={compareQ.data.rows} empty="The proposed text is the same as the library's." sides={layout === 'sides' ? titles : undefined} />
      )}
    </section>
  );
}

// ── the view ─────────────────────────────────────────────────────────────────
function ProposalCard({ p, on, onPick, mine }: { p: Proposal; on: boolean; onPick: () => void; mine: boolean }) {
  return (
    <button type="button" onClick={onPick} aria-current={on ? 'true' : undefined}
      className={`w-full rounded-xl border px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] ${on ? 'border-[#0f766e] bg-[#effaf8] ring-1 ring-[#0f766e]' : 'border-[#d5dbe1] bg-white hover:bg-[#f7f9fa]'}`}>
      <span className="flex items-center gap-2">
        <InitialsAvatar name={p.proposed_by?.name} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#1f2933]">{p.proposed_by?.name}{mine ? ' (you)' : ''}</span>
        {on && <Check className="h-4 w-4 shrink-0 text-[#0f766e]" aria-hidden />}
      </span>
      <span className="mt-1 block text-xs text-[#26323d]">{whatLine(p)}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#586472]"><StatusPill status={p.status} stale={p.stale} /> {dateTime(p.proposed_at)}</span>
      {p.message && <span className="mt-1 line-clamp-2 block text-xs italic text-[#3f4b58]">“{p.message}”</span>}
    </button>
  );
}

function ProposalDetail({ documentId, doc, p, meId, canDecide, onProposeAgain }: {
  documentId: number; doc: any; p: Proposal; meId: number | null; canDecide: boolean; onProposeAgain: (p: Proposal) => void;
}) {
  const decider = deciderName(doc);
  const mine = isMine(p, meId);
  const clause = p.finding ? [p.finding.clause_reference, p.finding.clause_title].filter(Boolean).join(' ') : '';
  return (
    <article className="min-w-0 space-y-3" aria-labelledby={`proposal-${p.id}`}>
      <header className="rounded-xl border border-[#d5dbe1] bg-white p-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <h3 id={`proposal-${p.id}`} className="break-words text-base font-semibold text-[#1f2933]">{whatLine(p)}</h3>
            <p className={`mt-0.5 text-xs ${MUTED}`}>
              Proposed by {p.proposed_by?.name}{mine ? ' (you)' : ''} · {dateTime(p.proposed_at)}{p.base?.number ? ` · on v${p.base.number}` : ''}
            </p>
          </div>
          <StatusPill status={p.status} stale={p.stale} />
        </div>
        <blockquote className="mt-3 rounded-lg border-l-4 border-[#0f766e] bg-[#f3fbf9] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0b4f46]">
            {p.kind === 'statement' ? 'Justification for this change' : mine ? 'Your message' : `${p.proposed_by?.name}'s message`}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-[#1f2933]">{p.message || 'No message was given.'}</p>
        </blockquote>
        {clause && <p className="mt-2 text-xs text-[#26323d]">Closes the gap in <span className="font-semibold">{clause}</span>.</p>}
        {p.status === 'pending' && p.stale && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="note">{staleLine(p, doc?.current_version, mine)}</p>
        )}
        {p.status === 'accepted' && (
          <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            Accepted by {p.decided_by?.name || decider}{p.decided_at ? ` on ${day(p.decided_at)}` : ''}{p.applied_version ? `: it is version ${p.applied_version.number}` : ''}.
            {p.decision_note ? ` “${p.decision_note}”` : ''}
          </p>
        )}
        {p.status === 'rejected' && (
          <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[#7a1616]">
            <span className="font-semibold">Not accepted by {p.decided_by?.name || decider}{p.decided_at ? ` on ${day(p.decided_at)}` : ''}</span>
            {p.decision_note ? `: “${p.decision_note}”` : '.'}
          </p>
        )}
        {p.status === 'withdrawn' && <p className={`mt-2 text-sm ${MUTED}`}>Withdrawn{p.decided_at ? ` on ${day(p.decided_at)}` : ''}; the document stayed as it was.</p>}
        {p.status === 'pending' && !canDecide && !mine && <p className={`mt-2 text-sm ${MUTED}`}>Waiting for {decider}&apos;s decision.</p>}
        <div className="mt-3"><ProposalActions documentId={documentId} p={p} onProposeAgain={onProposeAgain} /></div>
      </header>
      {p.kind === 'statement' ? <StatementChange p={p} /> : <DocumentChange documentId={documentId} doc={doc} p={p} />}
    </article>
  );
}

export default function ProposalsView({ documentId, doc, asked, onPick, onProposeAgain }: {
  documentId: number; doc: any;
  /** the proposal the link asked for (?proposal=<id>) */
  asked: number | null;
  onPick: (pid: number) => void;
  /** the proposer sends a change that was not accepted again: the AI Studio for the document, the statement's form for a statement */
  onProposeAgain: (p: Proposal) => void;
}) {
  const listQ = useProposals(documentId);
  const meId = useMyUserId();
  const items = listQ.data?.items ?? NONE;
  const chosen = pick(items, asked);
  const decider = deciderName(doc);
  if (listQ.isLoading) return <div className="flex h-40 items-center justify-center" role="status" aria-label="Reading the proposed changes"><Loader2 className="h-6 w-6 animate-spin text-[#0f766e]" /></div>;
  if (listQ.isError) return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[#7a1616]" role="alert">{problemOf(listQ.error, 'The proposed changes could not be read.')}</p>;
  const canDecide = !!listQ.data?.can_decide;
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <section className="min-w-0 space-y-2 lg:sticky lg:top-0 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto lg:pr-1" aria-labelledby="proposals-title">
        <h2 id="proposals-title" className="text-sm font-semibold text-[#1f2933]">Proposed changes</h2>
        <p className={`text-xs ${MUTED}`}>
          {canDecide ? 'Changes others made to this document wait here for your decision: accepted, a change becomes the next version, credited to them; rejected, they are told your note.'
            : `Changes by people who are not its owner or author wait here for ${decider}'s decision.`}
        </p>
        {items.length === 0 ? (
          <p className={`rounded-xl border border-dashed border-[#b8c4c8] bg-white p-4 text-sm ${MUTED}`}>No changes have been proposed for this document.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((p) => <li key={p.id}><ProposalCard p={p} on={p.id === chosen?.id} mine={isMine(p, meId)} onPick={() => onPick(p.id)} /></li>)}
          </ul>
        )}
      </section>
      {chosen && <ProposalDetail key={chosen.id} documentId={documentId} doc={doc} p={chosen} meId={meId} canDecide={canDecide} onProposeAgain={onProposeAgain} />}
    </div>
  );
}
