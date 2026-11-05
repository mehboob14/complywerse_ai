'use client';

// Sign-off & Document Control — the approval flow: who prepares, reviews and approves (by user, role or department), sending for
// review, signing or rejecting with a drawn electronic signature, and the trail of signatures. Its parts share one query
// (['doc-signoff', id]) so they can be placed apart: the document's Sign-off tab shows them together, and for organisations
// with the document life cycle the Approvals & Acknowledgements tab (_LifecycleTab) puts the person's own action first.
// Backend: /governance/documents/{id}/signoff/*.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { Button, ErrorState, FormField, Select, SkeletonLines, StatusPill, Textarea, useNotify, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { day, dateTime } from './_view/docDates';
import { assigneeOptions, assigneePlaceholder, chosenFrom, sentToast, withChosen, type TargetOption } from '@/lib/signoffTargets';
import { SIGN_LABEL, STEP_NOUN, againLine, seeChangesHref, type MyStep, type RouteView } from '@/lib/approvalRoutes';
import { signRoleOf } from '@/lib/proposals';
import SignaturePad from '@/components/governance/SignaturePad';
import SignatureSeal from '@/components/governance/SignatureSeal';
import { retryUnlessRefused } from './_view/docRoute';
import { DOC_STATUS_WORDS, docStatusPill } from './_view/docStatus';
import {
  Send, CheckCircle, XCircle, Clock, UserCheck, PenLine, ShieldCheck, Pencil, MessageSquareWarning, UserRoundPlus, GitCompare,
} from 'lucide-react';

export type Participant = { target_type: string; target_id: number; display?: string; stage_position?: number | null; position?: number | null };
type Option = TargetOption;
export type SignoffSignature = {
  id: number; role_type: string; role_label: string; signer_user_id: number; signer_name: string | null; decision: string;
  signed_at: string | null; comment: string | null; esign?: { id: number; image_sha256: string } | null;
  /** signed by a delegate for this person (newer servers) */
  on_behalf_of_name?: string | null;
  /** its stage started again after changes: kept, it no longer counts (newer servers) */
  asked_again?: boolean;
};
export type Signoff = {
  status: string;
  /** the review round shown; sent back with a decision, a newer round means the document changed */
  round_at?: string | null;
  participants: { prepared_by?: Participant[]; reviewer?: Participant[]; approver?: Participant[] };
  signatures: SignoffSignature[];
  progress: { reviewer?: { signed: number; required: number }; approver?: { signed: number; required: number } };
  my_actionable_role: 'reviewer' | 'approver' | null;
  /** the version the sign-off is about (newer servers): sent back when signing, refused when it moved on */
  version?: string;
  /** its approval route: stages, each person's state, changes asked for (servers from before routes leave these out) */
  route?: RouteView;
  my_step?: MyStep | null;
  can_resubmit?: boolean;
  can_withdraw?: boolean;
};

/** The document's status as people say it (the words are _view/docStatus.ts's, with the library's tones in the pill). */
export const SIGNOFF_STATUS: Record<string, { label: string }> = Object.fromEntries(Object.entries(DOC_STATUS_WORDS).map(([key, label]) => [key, { label }]));

/** The status as a pill: the registry's tone, the page's word (the Approvals "Progress" card, the Sign-off tab and the document's top bar). */
export function StatusChip({ status }: { status: string }) {
  return <StatusPill {...docStatusPill(status)} />;
}

export function useSignoff(documentId: number) {
  return useQuery({
    queryKey: ['doc-signoff', documentId],
    queryFn: async () => (await governanceApi.getDocumentSignoff(documentId)).data as Signoff,
    retry: retryUnlessRefused,
  });
}

function useRefreshAll(documentId: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['doc-signoff', documentId] });
    qc.invalidateQueries({ queryKey: ['governance-document', documentId] });
    qc.invalidateQueries({ queryKey: ['document-lifecycle'] });
    qc.invalidateQueries({ queryKey: ['my-document-requests'] });     // the top bar's and My Approvals' "waiting for you"
  };
}

/** Who can be picked to review or approve: one read-only list anyone signed in may ask for (people of this platform by name, roles
 *  a connector did not make, departments), not the administrators' role list. `_tenantId`: kept for the callers; the server knows it. */
export function useAssigneeOptions(_tenantId?: number): Option[] {
  const targetsQ = useQuery({
    queryKey: ['signoff-targets'],
    queryFn: async () => { try { return (await governanceApi.getSignoffTargets()).data; } catch { return null; } },
  });
  return useMemo(() => assigneeOptions(targetsQ.data), [targetsQ.data]);
}

/** Who reviews or approves; one saved before that is not among the options (a connector's role, someone removed) still shows,
 *  under its saved name, and can be unticked. */
export function AssigneeMultiSelect({
  label, hint, value, onChange, options,
}: { label: string; hint?: string; value: Participant[]; onChange: (p: Participant[]) => void; options: Option[] }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label className="text-xs font-semibold text-[#26323d]">{label}</label>
        {/* the hint is a note beside the label, not a clause in it */}
        {hint && <InfoTip label={`About ${label}`} text={hint} />}
      </div>
      <MultiSelectDropdown
        title={label}
        items={withChosen(options, value)}
        selectedValues={value.map((p) => `${p.target_type}:${p.target_id}`)}
        onApply={(vals: string[]) => onChange(chosenFrom(vals, value))}
        multiSelect
        triggerVariant="input"
        placeholder={assigneePlaceholder(options)}
        size="md"
        forceSearch
        namesInTrigger
      />
    </div>
  );
}

export type SignoffChoice = { reviewers: Participant[]; approvers: Participant[] };
export const NO_SIGNOFF: SignoffChoice = { reviewers: [], approvers: [] };

/** Who reviews and who approves a document, chosen while it is uploaded or moved into the library. `note`: what the (i) says. */
export function ReviewerApproverFields({ value, onChange, tenantId, note = 'They are asked when you submit the document for review, not before.' }: {
  value: SignoffChoice; onChange: (v: SignoffChoice) => void; tenantId?: number; note?: string;
}) {
  const options = useAssigneeOptions(tenantId);
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-[#26323d]">
        <span className="inline-flex items-center gap-1">Sign-off{note && <InfoTip label="About sign-off" text={note} />}</span>
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <AssigneeMultiSelect label="Reviewers" value={value.reviewers} onChange={(reviewers) => onChange({ ...value, reviewers })} options={options} />
        <AssigneeMultiSelect label="Approvers" value={value.approvers} onChange={(approvers) => onChange({ ...value, approvers })} options={options} />
      </div>
    </fieldset>
  );
}

/** Saves the reviewers and approvers chosen for a new library document (nothing when none were chosen). */
export async function saveSignoffChoice(documentId: number, v: SignoffChoice): Promise<void> {
  if (!v.reviewers.length && !v.approvers.length) return;
  const ids = (l: Participant[]) => l.map(({ target_type, target_id }) => ({ target_type, target_id }));
  await governanceApi.setSignoffParticipants(documentId, { reviewers: ids(v.reviewers), approvers: ids(v.approvers) });
}

const ROLES = [
  { key: 'prepared_by', label: 'Prepared by', icon: PenLine },
  { key: 'reviewer', label: 'Reviewers', icon: UserCheck },
  { key: 'approver', label: 'Approvers', icon: ShieldCheck },
] as const;

/**
 * The signer's own step: shown only to someone who can sign now. Draw the signature, sign; or reject with a reason, which sends
 * the document back to draft. `due` is when the request is due (from the life cycle, when the organisation has it).
 */
export function SignoffAction({ documentId, due, version: shown, onDirty }: {
  documentId: number; due?: string | null;
  /** the version the person is reading: sent with the decision, refused by the server if the document moved on */
  version?: string;
  /** told whether something was typed or drawn (a signature, a comment, a reason): a popup around this asks before it throws that away */
  onDirty?: (dirty: boolean) => void;
}) {
  const refresh = useRefreshAll(documentId);
  const { data } = useSignoff(documentId);
  const [comment, setComment] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [mode, setMode] = useState<'sign' | 'changes' | 'reject' | 'delegate'>('sign');
  const [reason, setReason] = useState('');
  const [delegateTo, setDelegateTo] = useState<string>('');
  const options = useAssigneeOptions();
  const dirty = !!signature || comment.trim() !== '' || reason.trim() !== '' || delegateTo !== '';
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps -- told when it changes
  useEffect(() => () => onDirty?.(false), []);     // eslint-disable-line react-hooks/exhaustive-deps -- and that it is gone
  // a person, not one already asked at this stage (the person themselves among them): the server refuses those
  const onStage = new Set((data?.route?.stages.find((s) => s.position === data?.my_step?.stage_position)?.people ?? [])
    .filter((p) => p.target_type === 'user').map((p) => `user:${p.target_id}`));
  const people = options.filter((o) => o.value.startsWith('user:') && !onStage.has(o.value));
  const back = () => { setMode('sign'); setReason(''); setDelegateTo(''); };

  // each of these is a decision on the document (an e-signature, a rejection, a request for changes, a delegation): reported after the server answered, with the
  // server's words when it refuses; no Retry, because a second try could decide twice (the form stays as it is to press again on purpose)
  const sign = useReportedMutation({
    mutationFn: async () => governanceApi.signDocumentOff(documentId, { comment: comment || undefined, signature_image: signature || undefined, version: shown ?? data?.version, round_at: data?.round_at }),
    success: { title: 'Signed', message: 'Your electronic signature was recorded on the document.' },
    failure: 'Not signed',
    fallback: 'Could not sign.',
    retryable: false,
    onSuccess: () => { setComment(''); setSignature(null); refresh(); },
  });
  const reject = useReportedMutation({
    mutationFn: async () => governanceApi.rejectDocumentSignoff(documentId, { comment: reason, version: shown ?? data?.version, round_at: data?.round_at }),
    success: { title: 'Rejected', message: 'The document went back to draft with your reason.' },
    failure: 'Not rejected',
    fallback: 'Could not reject.',
    retryable: false,
    onSuccess: () => { back(); refresh(); },
  });
  const askChanges = useReportedMutation({
    mutationFn: async () => governanceApi.requestSignoffChanges(documentId, { comment: reason.trim(), version: shown ?? data?.version, round_at: data?.round_at }),
    success: { title: 'Changes asked for', message: 'The author is asked to make them; it comes back to you when it is resubmitted.' },
    failure: 'Not sent',
    fallback: 'Could not ask for changes.',
    retryable: false,
    onSuccess: () => { back(); refresh(); },
  });
  const delegate = useReportedMutation({
    mutationFn: async () => governanceApi.delegateSignoff(documentId, { user_id: Number(delegateTo.split(':')[1]), note: reason.trim() || undefined }),
    success: { title: 'Delegated', message: 'They are asked in your place, and told.' },
    failure: 'Not delegated',
    fallback: 'Could not delegate.',
    retryable: false,
    onSuccess: () => { back(); refresh(); },
  });

  // the proposer whose change the owner did not accept signs it as it is with their own step (lib/proposals.ts)
  const role = signRoleOf(data);
  if (!role) return null;
  const review = role === 'reviewer';
  const step = data?.my_step;
  const asIs = !data?.my_actionable_role && !!step?.may_sign_as_is;
  // a route's own stage names what is asked ("concurrence"); an older server: review or approval
  const kind = step?.kind ?? (review ? 'review' : 'approval');
  const canReject = step ? step.can_reject : true;
  const canDelegate = step ? step.can_delegate : false;
  const dueText = due ? day(due) : null;
  // asked again after changes: what they did before and what changed since (servers from before leave it out)
  const again = step?.again ?? null;
  const changesHref = seeChangesHref(documentId, again);

  // what the step is, in one line: its stage (a route's own), whether it is in turn, whom it is for (a delegate)
  const meta = [
    step && data?.route?.custom ? `${step.stage_name}${step.in_turn ? ' · in turn' : ''}` : '',
    step?.on_behalf_of ? `For ${step.on_behalf_of} (delegated)` : '',
  ].filter(Boolean).join(' · ');
  const howItWorks = asIs
    ? 'Your change was not accepted. Your signature counts and the others stand, as nothing changed. Or propose another change from Proposed changes.'
    : `Read the document, then draw your signature and sign it. Or ask for changes: the author makes them and it comes back to you${canReject ? '; reject it with a reason to send it back to draft' : ''}.`;

  return (
    <section className="rounded-xl border-2 border-primary-300 bg-[#fff] p-4 shadow-sm" aria-label={`Your ${STEP_NOUN[kind]}`}>
      {again && (
        <div className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2" role="note">
          <p className="min-w-[14rem] flex-1 text-[13px] text-amber-950">
            {againLine(again, day)}
            {again.note && <span className="mt-0.5 block text-xs text-amber-900">{again.by || 'The author'} wrote: “{again.note}”</span>}
          </p>
          {changesHref && <Button href={changesHref} leftIcon={<GitCompare aria-hidden />}>See what changed</Button>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-full bg-primary-50 p-1.5">{review ? <UserCheck className="h-4 w-4 text-primary-700" /> : <ShieldCheck className="h-4 w-4 text-primary-700" />}</span>
        <h3 className="text-sm font-semibold text-gray-900">{asIs ? 'Sign as it is' : <>Your {STEP_NOUN[kind]}{again ? ' again' : ''}</>}</h3>
        <InfoTip label="About this step" text={howItWorks} />
        {meta && <span className="text-xs text-[#586472]">{meta}</span>}
        {dueText && !asIs && <span className="ml-auto text-xs font-medium text-[#26323d]">Due {dueText}</span>}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-[#26323d]">
            Signature
            <InfoTip label="What signing records" text="Your drawn signature is kept with this sign-off, with your name, the time and your IP address, and added to the audit trail. Signing stamps your name, date and signature into the document's Approval Signoff table and moves the document to its next stage." />
          </p>
          <SignaturePad onChange={setSignature} height={120} />
        </div>
        <div className="flex flex-col gap-2">
          {mode === 'sign' && (
            <>
              <Textarea aria-label="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" rows={3} />
              <Button variant="primary" fullWidth leftIcon={<CheckCircle aria-hidden />} loading={sign.isPending} disabled={!signature} title={signature ? '' : 'Draw your signature first'}
                onClick={() => sign.mutate()}>
                {SIGN_LABEL[kind]}
              </Button>
              {!asIs && (
                <Button fullWidth leftIcon={<MessageSquareWarning aria-hidden />} onClick={() => setMode('changes')}>Ask for changes</Button>
              )}
              {canReject && !asIs && (
                <Button variant="dangerOutline" fullWidth leftIcon={<XCircle aria-hidden />} title="Send it back to draft with a reason" onClick={() => setMode('reject')}>Reject</Button>
              )}
              {canDelegate && !asIs && (
                <Button variant="link" fullWidth leftIcon={<UserRoundPlus aria-hidden />} title="Delegate to someone else" onClick={() => setMode('delegate')}>Delegate</Button>
              )}
            </>
          )}
          {mode === 'changes' && (
            <>
              <Textarea aria-label="What should change? (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What should change? (required)" rows={4} autoFocus />
              <p className="text-xs text-[#586472]">The review pauses until the author resubmits.</p>
              <Button variant="primary" fullWidth leftIcon={<MessageSquareWarning aria-hidden />} loading={askChanges.isPending} disabled={!reason.trim()} onClick={() => askChanges.mutate()}>
                Ask for changes
              </Button>
              <Button variant="ghost" fullWidth onClick={back}>Cancel</Button>
            </>
          )}
          {mode === 'reject' && (
            <>
              <Textarea aria-label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" rows={4} autoFocus />
              <Button variant="danger" fullWidth leftIcon={<XCircle aria-hidden />} loading={reject.isPending} disabled={!reason.trim()} onClick={() => reject.mutate()}>
                Reject and send back
              </Button>
              <Button variant="ghost" fullWidth onClick={back}>Cancel</Button>
            </>
          )}
          {mode === 'delegate' && (
            <>
              <FormField label="Delegate to" id={`delegate-${documentId}`}>
                <Select value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)}>
                  <option value="">Choose a person…</option>
                  {people.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              </FormField>
              <Textarea aria-label="Note (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note (optional)" rows={2} />
              <Button variant="primary" fullWidth leftIcon={<UserRoundPlus aria-hidden />} loading={delegate.isPending} disabled={!delegateTo} onClick={() => delegate.mutate()}>Delegate</Button>
              <Button variant="ghost" fullWidth onClick={back}>Cancel</Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Who prepares, reviews and approves: a summary, changed with "Change" while the document is not yet approved; a draft is sent
 * for review from here. `open` starts with the editor open (a draft with nobody assigned yet).
 */
export function SignoffParticipants({ documentId, doc, readOnly = false }: { documentId: number; doc: any; readOnly?: boolean }) {
  const { toast } = useToast();
  const notify = useNotify();
  const refresh = useRefreshAll(documentId);
  const options = useAssigneeOptions(doc?.tenant_id);
  const { data, isError, error, refetch } = useSignoff(documentId);
  const [prepared, setPrepared] = useState<Participant[]>([]);
  const [reviewers, setReviewers] = useState<Participant[]>([]);
  const [approvers, setApprovers] = useState<Participant[]>([]);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (data?.participants) {
      setPrepared(data.participants.prepared_by || []);
      setReviewers(data.participants.reviewer || []);
      setApprovers(data.participants.approver || []);
    }
  }, [data]);

  const save = useReportedMutation({
    mutationFn: async () => governanceApi.setSignoffParticipants(documentId, { prepared_by: prepared, reviewers, approvers }),
    success: { title: 'Saved', message: 'Who reviews and approves was updated.' },
    failure: 'Not saved',
    fallback: 'Could not save who reviews and approves.',
    onSuccess: () => { setEditing(false); refresh(); },
  });
  // sending asks people (their tasks and e-mails): the words depend on what the server answered, and a second try could ask them twice, so no Retry
  const send = useMutation({
    mutationFn: async () => governanceApi.sendDocumentForReview(documentId),
    onSuccess: (r: any) => { toast(sentToast(r?.data, 'The reviewers and approvers were asked, in order.')); refresh(); },
    onError: (e: any) => { notify.error(e, { title: 'Not sent', fallback: 'Add a reviewer or an approver first.' }); },
  });

  // a failed read is not "nobody": it says so (nothing shows while it is still loading, as before)
  if (!data) return isError ? <ErrorState compact title="Couldn't load who reviews and approves" message={errorMessage(error)} onRetry={() => { void refetch(); }} /> : null;
  const status = data.status || doc?.status;
  if (data.route?.custom) return <RouteSummaryCard data={data} />;
  const editable = !readOnly && ['draft', 'pending_review', 'pending_approval'].includes(status);
  const nobody = !(data.participants?.reviewer?.length || data.participants?.approver?.length);
  const open = !readOnly && (editing || (status === 'draft' && nobody));
  const canSend = status === 'draft' && !nobody;

  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-900">Participants</h3>
        <InfoTip label="About participants" text="Choose people, a role or a department. With a role or a department, the first member to sign signs for all of them." />
        {editable && !open && (
          <Button variant="link" size="sm" className="ml-auto" leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Change</Button>
        )}
      </div>
      {!open ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-3">
          {ROLES.map(({ key, label, icon: Icon }) => {
            const list = (data.participants?.[key] || []) as Participant[];
            return (
              <div key={key} className="rounded-lg border border-[#e1e6eb] px-3 py-2">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-[#586472]"><Icon className="h-3.5 w-3.5" /> {label}</dt>
                <dd className="mt-1 text-sm text-gray-900">{list.length ? list.map((p) => p.display).join(', ') : <span className="text-[#586472]">Nobody yet</span>}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <AssigneeMultiSelect label="Prepared by" hint="The author, when left empty." value={prepared} onChange={setPrepared} options={options} />
            <AssigneeMultiSelect label="Reviewers" value={reviewers} onChange={setReviewers} options={options} />
            <AssigneeMultiSelect label="Approvers" value={approvers} onChange={setApprovers} options={options} />
          </div>
          <div className="flex justify-end gap-2">
            {editing && <Button onClick={() => setEditing(false)}>Cancel</Button>}
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
          </div>
        </div>
      )}
      {status === 'draft' && !open && !readOnly && (
        <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-[#e1e6eb] pt-3">
          <InfoTip align="end" label="About sending for review" text="The reviewers are asked first, then the approvers. Each gets it in their Task Management." />
          <Button variant="primary" leftIcon={<Send aria-hidden />} loading={send.isPending} disabled={!canSend} title={canSend ? '' : 'Add a reviewer or an approver first'} onClick={() => send.mutate()}>
            Send for review
          </Button>
        </div>
      )}
    </section>
  );
}

const RULE_WORDS = (s: { rule: string; min_count: number | null }) => (s.rule === 'any' ? 'any one signs' : s.rule === 'at_least' ? `at least ${s.min_count} sign` : 'everyone signs');
const CHIP = 'rounded-full border border-[#d5dbe1] bg-[#f3f6f8] px-2 py-px text-xs text-[#3f4b58]';

/** A route of its own: its stages and their people, in order (changed in Submit for review while it is a draft). */
function RouteSummaryCard({ data }: { data: Signoff }) {
  const prepared = (data.participants?.prepared_by || []).map((p) => p.display).join(', ');
  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-900">Approval route</h3>
        {data.status === 'draft' && <InfoTip label="About the route" text="Change it in Submit for review." />}
        {prepared && <span className="text-xs text-[#586472]">prepared by {prepared}</span>}
      </div>
      <ol className="mt-3 space-y-1.5">
        {data.route!.stages.map((s) => {
          // one person: nothing to say about how they sign; in turn: everyone signs, one after another
          const rule = s.people.length > 1 ? (s.order === 'in_turn' ? 'one after another' : RULE_WORDS(s)) : '';
          return (
            <li key={s.position} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-medium text-gray-900">{s.position}. {s.name}</span>
              <span className="text-[#26323d]">{s.people.map((p) => p.display).join(s.order === 'in_turn' ? ', then ' : ', ')}</span>
              {s.kind !== 'information' && (!!rule || !!s.due_days) && (
                <span className="inline-flex items-center gap-1.5">
                  {rule && <span className={CHIP}>{rule}</span>}
                  {s.due_days ? <span className="text-xs text-[#586472]" title={`${s.due_days} days to act`}>{s.due_days} d</span> : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Every signature and rejection, newest last, each with its drawn signature and a Verify. */
export function SignoffTrail({ documentId }: { documentId: number }) {
  const { data } = useSignoff(documentId);
  const signatures = data?.signatures || [];
  return (
    <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Signatures</h3>
      {signatures.length === 0 ? (
        <p className="text-sm text-[#586472]">No signatures yet</p>
      ) : (
        <ol className="space-y-2">
          {signatures.map((s) => (
            <li key={s.id} className={`flex items-start gap-2 rounded-lg border p-2.5 ${s.decision === 'rejected' ? 'border-rose-200' : 'border-emerald-200'}`}>
              {s.decision === 'rejected' ? <XCircle className="mt-0.5 h-4 w-4 text-rose-600" /> : <CheckCircle className="mt-0.5 h-4 w-4 text-emerald-600" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">
                  <span className="font-medium">{s.signer_name}</span>
                  {s.on_behalf_of_name && <span className="text-gray-600"> for {s.on_behalf_of_name}</span>}
                  <span className="text-gray-600"> · {s.role_label} · {s.decision === 'rejected' ? 'rejected' : 'signed'}{s.asked_again ? ' · asked again after changes' : ''}</span>
                </p>
                <p className="flex items-center gap-1 text-xs text-gray-500">
                  <Clock className="h-3 w-3" aria-hidden />{s.signed_at ? dateTime(s.signed_at) : ''}
                </p>
                {s.comment && <p className="mt-0.5 text-xs italic text-gray-600">“{s.comment}”</p>}
                {s.esign && <SignatureSeal id={s.esign.id} fingerprint={s.esign.image_sha256} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The document's own Sign-off tab (organisations without the life cycle): where it stands, your step, who signs, the signatures. */
export function SignOffControlTab({ documentId, doc, canEdit = true, version }: { documentId: number; doc: any; canEdit?: boolean; version?: string }) {
  const { data, isLoading, isError, error, refetch } = useSignoff(documentId);
  if (isLoading) return <SkeletonLines lines={6} label="Loading the sign-off" />;
  // a failed read is not an empty sign-off
  if (isError && !data) return <ErrorState title="Couldn't load the sign-off" message={errorMessage(error)} onRetry={() => { void refetch(); }} />;
  const status = data?.status || doc?.status;
  const progress = data?.progress || {};
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Status</span>
          <StatusChip status={status} />
        </div>
        <div className="flex items-center gap-4 text-xs text-[#586472]">
          {(['reviewer', 'approver'] as const).map((rt) => (progress[rt]?.required ?? 0) > 0 && (
            <span key={rt} className="inline-flex items-center gap-1">
              {rt === 'reviewer' ? <UserCheck className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {rt === 'reviewer' ? 'Reviews' : 'Approvals'} <span className="font-semibold text-gray-900">{progress[rt]!.signed}/{progress[rt]!.required}</span>
            </span>
          ))}
        </div>
      </section>
      <SignoffAction documentId={documentId} version={version} />
      <SignoffParticipants documentId={documentId} doc={doc} readOnly={!canEdit} />
      <SignoffTrail documentId={documentId} />
    </div>
  );
}
