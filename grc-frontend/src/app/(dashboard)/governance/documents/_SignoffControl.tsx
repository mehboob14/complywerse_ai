'use client';

// Sign-off & Document Control — the approval flow: who prepares, reviews and approves (by user, role or team), sending for
// review, signing or rejecting with a drawn electronic signature, and the trail of signatures. Its parts share one query
// (['doc-signoff', id]) so they can be placed apart: the document's Sign-off tab shows them together, and for organisations
// with the document life cycle the Approvals & Acknowledgements tab (_LifecycleTab) puts the person's own action first.
// Backend: /governance/documents/{id}/signoff/*.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { parseUtc } from '@/lib/serverTime';
import { assigneeOptions, assigneePlaceholder, sentToast, type TargetOption } from '@/lib/signoffTargets';
import SignaturePad from '@/components/governance/SignaturePad';
import SignatureSeal from '@/components/governance/SignatureSeal';
import {
  Loader2, Send, CheckCircle, XCircle, Clock, Users as UsersIcon, UserCheck, PenLine, ShieldCheck, Pencil,
} from 'lucide-react';

export type Participant = { target_type: string; target_id: number; display?: string };
type Option = TargetOption;
export type SignoffSignature = {
  id: number; role_type: string; role_label: string; signer_user_id: number; signer_name: string | null; decision: string;
  signed_at: string | null; comment: string | null; esign?: { id: number; image_sha256: string } | null;
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
};

/** The document's status as people say it, and its colour. */
export const SIGNOFF_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'border-gray-300 bg-white text-gray-700' },
  pending_review: { label: 'In review', tone: 'border-amber-300 bg-amber-50 text-amber-800' },
  pending_approval: { label: 'Awaiting approval', tone: 'border-amber-300 bg-amber-50 text-amber-800' },
  approved: { label: 'Approved', tone: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  published: { label: 'Published', tone: 'border-primary-300 bg-primary-50 text-primary-800' },
  expired: { label: 'Expired', tone: 'border-rose-300 bg-rose-50 text-rose-800' },
  archived: { label: 'Archived', tone: 'border-gray-300 bg-white text-gray-600' },
};

export function StatusChip({ status }: { status: string }) {
  const s = SIGNOFF_STATUS[status] || { label: status.replace(/_/g, ' '), tone: 'border-gray-300 bg-white text-gray-700' };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>;
}

export function useSignoff(documentId: number) {
  return useQuery({
    queryKey: ['doc-signoff', documentId],
    queryFn: async () => (await governanceApi.getDocumentSignoff(documentId)).data as Signoff,
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
 *  a connector did not make, teams), not the administrators' role list. `_tenantId`: kept for the callers; the server knows it. */
export function useAssigneeOptions(_tenantId?: number): Option[] {
  const targetsQ = useQuery({
    queryKey: ['signoff-targets'],
    queryFn: async () => { try { return (await governanceApi.getSignoffTargets()).data; } catch { return null; } },
  });
  return useMemo(() => assigneeOptions(targetsQ.data), [targetsQ.data]);
}

export function AssigneeMultiSelect({
  label, hint, value, onChange, options,
}: { label: string; hint?: string; value: Participant[]; onChange: (p: Participant[]) => void; options: Option[] }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-800">
        {label}{hint && <span className="ml-1 font-normal text-gray-500">— {hint}</span>}
      </label>
      <MultiSelectDropdown
        title={label}
        items={options}
        selectedValues={value.map((p) => `${p.target_type}:${p.target_id}`)}
        onApply={(vals: string[]) => onChange(vals.map((v) => {
          const [t, id] = v.split(':');
          return { target_type: t, target_id: Number(id) };
        }))}
        multiSelect
        triggerVariant="input"
        placeholder={assigneePlaceholder(options)}
        size="md"
        forceSearch
      />
    </div>
  );
}

export type SignoffChoice = { reviewers: Participant[]; approvers: Participant[] };
export const NO_SIGNOFF: SignoffChoice = { reviewers: [], approvers: [] };

/** Who reviews and who approves a document, chosen while it is uploaded or moved into the library. */
export function ReviewerApproverFields({ value, onChange, tenantId, note = 'They are asked when the document is sent for review (Submit for review), not before.' }: {
  value: SignoffChoice; onChange: (v: SignoffChoice) => void; tenantId?: number; note?: string;
}) {
  const options = useAssigneeOptions(tenantId);
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-[#26323d]">Who reviews and approves it</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <AssigneeMultiSelect label="Reviewers" value={value.reviewers} onChange={(reviewers) => onChange({ ...value, reviewers })} options={options} />
        <AssigneeMultiSelect label="Approvers" value={value.approvers} onChange={(approvers) => onChange({ ...value, approvers })} options={options} />
      </div>
      <p className="text-[11px] text-[#586472]">{note}</p>
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
export function SignoffAction({ documentId, due, version: shown }: {
  documentId: number; due?: string | null;
  /** the version the person is reading: sent with the decision, refused by the server if the document moved on */
  version?: string;
}) {
  const { toast } = useToast();
  const refresh = useRefreshAll(documentId);
  const { data } = useSignoff(documentId);
  const [comment, setComment] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState('');

  const sign = useMutation({
    mutationFn: async () => governanceApi.signDocumentOff(documentId, { comment: comment || undefined, signature_image: signature || undefined, version: shown ?? data?.version, round_at: data?.round_at }),
    onSuccess: () => { toast({ type: 'success', title: 'Signed', message: 'Your electronic signature was recorded on the document.' }); setComment(''); setSignature(null); refresh(); },
    onError: (e: any) => toast({ type: 'error', title: 'Not signed', message: e?.response?.data?.detail || 'Could not sign.' }),
  });
  const reject = useMutation({
    mutationFn: async () => governanceApi.rejectDocumentSignoff(documentId, { comment: reason, version: shown ?? data?.version, round_at: data?.round_at }),
    onSuccess: () => { toast({ type: 'success', title: 'Rejected', message: 'The document went back to draft with your reason.' }); setRejectMode(false); setReason(''); refresh(); },
    onError: (e: any) => toast({ type: 'error', title: 'Not rejected', message: e?.response?.data?.detail || 'Could not reject.' }),
  });

  const role = data?.my_actionable_role;
  if (!role) return null;
  const review = role === 'reviewer';
  const dueText = due ? parseUtc(due)?.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(due) ? 'UTC' : undefined }) : null;

  return (
    <section className="rounded-xl border-2 border-primary-300 bg-white p-4 shadow-sm" aria-label={review ? 'Your review' : 'Your approval'}>
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-primary-50 p-2">{review ? <UserCheck className="h-5 w-5 text-primary-700" /> : <ShieldCheck className="h-5 w-5 text-primary-700" />}</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Your {review ? 'review' : 'approval'} is needed{dueText ? ` by ${dueText}` : ''}</h3>
          <p className="text-xs text-gray-600">
            Read the document, then draw your signature and {review ? 'sign it as reviewed' : 'approve it'}. Reject it with a reason to send it back to draft.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <SignaturePad onChange={setSignature} height={120} />
        <div className="flex flex-col gap-2">
          {!rejectMode ? (
            <>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              <button type="button" onClick={() => sign.mutate()} disabled={sign.isPending || !signature} title={signature ? '' : 'Draw your signature first'}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {sign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} {review ? 'Sign as reviewed' : 'Sign and approve'}
              </button>
              <button type="button" onClick={() => setRejectMode(true)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
                <XCircle className="h-4 w-4" /> Reject
              </button>
            </>
          ) : (
            <>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it rejected? (required — the author sees it)" rows={4} autoFocus
                className="w-full rounded-lg border border-rose-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none" />
              <button type="button" onClick={() => reject.mutate()} disabled={reject.isPending || !reason.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject and send back
              </button>
              <button type="button" onClick={() => { setRejectMode(false); setReason(''); }} className="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>
            </>
          )}
        </div>
      </div>
      <details className="mt-2 text-[11px] text-gray-500">
        <summary className="cursor-pointer select-none hover:text-gray-700">What signing records</summary>
        <p className="mt-1">
          Your drawn signature is kept with this sign-off together with your name, the time, your IP address and a fingerprint (hash) of the document,
          and added to the audit trail. Signing stamps your name, date and the signature fingerprint into the document&apos;s Approval Signoff table and
          moves the document to its next stage.
        </p>
      </details>
    </section>
  );
}

/**
 * Who prepares, reviews and approves: a summary, changed with "Change" while the document is not yet approved; a draft is sent
 * for review from here. `open` starts with the editor open (a draft with nobody assigned yet).
 */
export function SignoffParticipants({ documentId, doc, readOnly = false }: { documentId: number; doc: any; readOnly?: boolean }) {
  const { toast } = useToast();
  const refresh = useRefreshAll(documentId);
  const options = useAssigneeOptions(doc?.tenant_id);
  const { data } = useSignoff(documentId);
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

  const save = useMutation({
    mutationFn: async () => governanceApi.setSignoffParticipants(documentId, { prepared_by: prepared, reviewers, approvers }),
    onSuccess: () => { toast({ type: 'success', title: 'Saved', message: 'Who reviews and approves was updated.' }); setEditing(false); refresh(); },
    onError: (e: any) => toast({ type: 'error', title: 'Not saved', message: e?.response?.data?.detail || 'Could not save who reviews and approves.' }),
  });
  const send = useMutation({
    mutationFn: async () => governanceApi.sendDocumentForReview(documentId),
    onSuccess: (r: any) => { toast(sentToast(r?.data, 'The reviewers and approvers were asked, in order.')); refresh(); },
    onError: (e: any) => toast({ type: 'error', title: 'Not sent', message: e?.response?.data?.detail || 'Add a reviewer or an approver first.' }),
  });

  if (!data) return null;
  const status = data.status || doc?.status;
  const editable = !readOnly && ['draft', 'pending_review', 'pending_approval'].includes(status);
  const nobody = !(data.participants?.reviewer?.length || data.participants?.approver?.length);
  const open = !readOnly && (editing || (status === 'draft' && nobody));
  const canSend = status === 'draft' && !nobody;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <UsersIcon className="h-4 w-4 text-primary-600" />
        <h3 className="text-sm font-semibold text-gray-900">Who reviews and approves</h3>
        {editable && !open && (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
            <Pencil className="h-3.5 w-3.5" /> Change
          </button>
        )}
      </div>
      {!open ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-3">
          {ROLES.map(({ key, label, icon: Icon }) => {
            const list = (data.participants?.[key] || []) as Participant[];
            return (
              <div key={key} className="rounded-lg border border-gray-200 px-3 py-2">
                <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500"><Icon className="h-3.5 w-3.5" /> {label}</dt>
                <dd className="mt-1 text-sm text-gray-900">{list.length ? list.map((p) => p.display).join(', ') : <span className="text-gray-500">Nobody yet</span>}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-600">Choose people, a role or a team. With a role or a team, the first member to sign signs for all of them.</p>
          <div className="grid gap-3 md:grid-cols-3">
            <AssigneeMultiSelect label="Prepared by" hint="the author when left empty" value={prepared} onChange={setPrepared} options={options} />
            <AssigneeMultiSelect label="Reviewers" value={reviewers} onChange={setReviewers} options={options} />
            <AssigneeMultiSelect label="Approvers" value={approvers} onChange={setApprovers} options={options} />
          </div>
          <div className="flex justify-end gap-2">
            {editing && <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">Cancel</button>}
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}
      {status === 'draft' && !open && !readOnly && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-primary-50 px-3 py-2">
          <p className="text-xs text-primary-900">Ready? The reviewers are asked first, then the approvers. Each gets it in their Task Management.</p>
          <button type="button" onClick={() => send.mutate()} disabled={!canSend || send.isPending} title={canSend ? '' : 'Add a reviewer or an approver first'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send for review
          </button>
        </div>
      )}
    </section>
  );
}

/** Every signature and rejection, newest last, each with its drawn signature and a Verify. */
export function SignoffTrail({ documentId }: { documentId: number }) {
  const { data } = useSignoff(documentId);
  const signatures = data?.signatures || [];
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Signatures</h3>
      {signatures.length === 0 ? (
        <p className="text-sm text-gray-500">Nobody has signed yet.</p>
      ) : (
        <ol className="space-y-2">
          {signatures.map((s) => (
            <li key={s.id} className={`flex items-start gap-2 rounded-lg border p-2.5 ${s.decision === 'rejected' ? 'border-rose-200' : 'border-emerald-200'}`}>
              {s.decision === 'rejected' ? <XCircle className="mt-0.5 h-4 w-4 text-rose-600" /> : <CheckCircle className="mt-0.5 h-4 w-4 text-emerald-600" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900">
                  <span className="font-medium">{s.signer_name}</span>
                  <span className="text-gray-600"> · {s.role_label} · {s.decision === 'rejected' ? 'rejected' : 'signed'}</span>
                </p>
                <p className="flex items-center gap-1 text-[11px] text-gray-500">
                  <Clock className="h-3 w-3" />{s.signed_at ? (parseUtc(s.signed_at)?.toLocaleString() ?? '') : ''}
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
  const { data, isLoading } = useSignoff(documentId);
  if (isLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>;
  }
  const status = data?.status || doc?.status;
  const progress = data?.progress || {};
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Status</span>
          <StatusChip status={status} />
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-600">
          {(['reviewer', 'approver'] as const).map((rt) => (progress[rt]?.required ?? 0) > 0 && (
            <span key={rt} className="inline-flex items-center gap-1">
              {rt === 'reviewer' ? <UserCheck className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {rt === 'reviewer' ? 'Reviews' : 'Approvals'}: <span className="font-semibold text-gray-900">{progress[rt]!.signed}/{progress[rt]!.required}</span>
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
