'use client';

// Sign-off & Document Control tab — production approval flow.
// Assign Prepared-by / Reviewers / Approvers by user, role, or team; send for
// review; each assignee signs (routed to their Pending Approvals); status
// advances automatically. Backend: /governance/documents/{id}/signoff/*.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi, adminApi, teamsApi } from '@/lib/api';
import { MultiSelectDropdown } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import {
  Loader2, Send, CheckCircle, XCircle, User, Clock, Users as UsersIcon,
  UserCheck, PenLine, ShieldCheck,
} from 'lucide-react';

type Participant = { target_type: string; target_id: number; display?: string };
type Option = { value: string; label: string; subLabel?: string };

function useAssigneeOptions(tenantId?: number): Option[] {
  const usersQ = useQuery({
    queryKey: ['signoff-users', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      try {
        const r = await governanceApi.getTenantUsers(tenantId as number);
        const d: any = r.data;
        return (Array.isArray(d) ? d : d?.users || []) as any[];
      } catch { return []; }
    },
  });
  const rolesQ = useQuery({
    queryKey: ['signoff-roles'],
    queryFn: async () => { try { return ((await adminApi.getRoles()).data || []) as any[]; } catch { return []; } },
  });
  const teamsQ = useQuery({
    queryKey: ['signoff-teams'],
    queryFn: async () => { try { return ((await teamsApi.list()).data || []) as any[]; } catch { return []; } },
  });
  return useMemo(() => {
    const out: Option[] = [];
    for (const u of usersQ.data || []) {
      out.push({ value: `user:${u.id}`, label: u.display_name || u.username || u.email || `User ${u.id}`, subLabel: u.email || undefined });
    }
    for (const r of rolesQ.data || []) {
      out.push({ value: `role:${r.id}`, label: `Role · ${r.name}`, subLabel: r.user_count != null ? `${r.user_count} users` : undefined });
    }
    for (const t of teamsQ.data || []) {
      out.push({ value: `team:${t.id}`, label: `Team · ${t.name}`, subLabel: t.member_count != null ? `${t.member_count} members` : undefined });
    }
    return out;
  }, [usersQ.data, rolesQ.data, teamsQ.data]);
}

function AssigneeMultiSelect({
  label, hint, value, onChange, options,
}: { label: string; hint?: string; value: Participant[]; onChange: (p: Participant[]) => void; options: Option[] }) {
  const selectedValues = value.map((p) => `${p.target_type}:${p.target_id}`);
  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1">
        {label}{hint && <span className="ml-1 font-normal text-gray-400">— {hint}</span>}
      </label>
      <MultiSelectDropdown
        title={label}
        items={options}
        selectedValues={selectedValues}
        onApply={(vals: string[]) => onChange(vals.map((v) => {
          const [t, id] = v.split(':');
          return { target_type: t, target_id: Number(id) };
        }))}
        multiSelect
        triggerVariant="input"
        placeholder="Add users, roles, or teams…"
        size="md"
        forceSearch
      />
    </div>
  );
}

const ROLE_ICON: Record<string, any> = { prepared_by: PenLine, reviewer: UserCheck, approver: ShieldCheck };

export function SignOffControlTab({ documentId, doc }: { documentId: number; doc: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const options = useAssigneeOptions(doc?.tenant_id);

  const { data: signoff, isLoading } = useQuery({
    queryKey: ['doc-signoff', documentId],
    queryFn: async () => (await governanceApi.getDocumentSignoff(documentId)).data as any,
  });

  const [prepared, setPrepared] = useState<Participant[]>([]);
  const [reviewers, setReviewers] = useState<Participant[]>([]);
  const [approvers, setApprovers] = useState<Participant[]>([]);
  const [dirty, setDirty] = useState(false);
  const [signComment, setSignComment] = useState('');
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  useEffect(() => {
    if (signoff?.participants) {
      setPrepared(signoff.participants.prepared_by || []);
      setReviewers(signoff.participants.reviewer || []);
      setApprovers(signoff.participants.approver || []);
      setDirty(false);
    }
  }, [signoff]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['doc-signoff', documentId] });
    qc.invalidateQueries({ queryKey: ['governance-document', documentId] });
  };

  const saveMut = useMutation({
    mutationFn: async () => governanceApi.setSignoffParticipants(documentId, { prepared_by: prepared, reviewers, approvers }),
    onSuccess: () => { toast({ type: 'success', title: 'Saved', message: 'Sign-off participants updated.' }); setDirty(false); invalidate(); },
    onError: (e: any) => toast({ type: 'error', title: 'Save failed', message: e?.response?.data?.detail || 'Could not save participants.' }),
  });
  const sendMut = useMutation({
    mutationFn: async () => governanceApi.sendDocumentForReview(documentId),
    onSuccess: () => { toast({ type: 'success', title: 'Sent', message: 'Document routed to reviewers/approvers.' }); invalidate(); },
    onError: (e: any) => toast({ type: 'error', title: 'Could not send', message: e?.response?.data?.detail || 'Assign reviewers/approvers first.' }),
  });
  const signMut = useMutation({
    mutationFn: async () => governanceApi.signDocumentOff(documentId, { comment: signComment || undefined }),
    onSuccess: () => { toast({ type: 'success', title: 'Signed', message: 'Your signature was recorded on the document.' }); setSignComment(''); invalidate(); },
    onError: (e: any) => toast({ type: 'error', title: 'Sign failed', message: e?.response?.data?.detail || 'Could not sign.' }),
  });
  const rejectMut = useMutation({
    mutationFn: async () => governanceApi.rejectDocumentSignoff(documentId, { comment: rejectComment }),
    onSuccess: () => { toast({ type: 'success', title: 'Rejected', message: 'Returned to draft.' }); setRejectMode(false); setRejectComment(''); invalidate(); },
    onError: (e: any) => toast({ type: 'error', title: 'Reject failed', message: e?.response?.data?.detail || 'Could not reject.' }),
  });

  if (isLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>;
  }

  const status = signoff?.status || doc?.status;
  const canEditParticipants = ['draft', 'pending_review', 'pending_approval'].includes(status);
  const canSend = status === 'draft' && (reviewers.length > 0 || approvers.length > 0);
  const myRole: string | null = signoff?.my_actionable_role || null;
  const progress = signoff?.progress || {};
  const signatures: any[] = signoff?.signatures || [];

  const STATUS_LABEL: Record<string, string> = {
    draft: 'Draft', pending_review: 'Pending Review', pending_approval: 'Pending Approval',
    approved: 'Approved', published: 'Published',
  };
  const STATUS_TONE: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700', pending_review: 'bg-amber-100 text-amber-700',
    pending_approval: 'bg-blue-100 text-blue-700', approved: 'bg-emerald-100 text-emerald-700',
    published: 'bg-violet-100 text-violet-700',
  };

  return (
    <div className="space-y-5">
      {/* Status + progress */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-black">Status</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status] || 'bg-gray-100 text-gray-700'}`}>
            {STATUS_LABEL[status] || status}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-600">
          {(['reviewer', 'approver'] as const).map((rt) => progress[rt]?.required > 0 && (
            <span key={rt} className="inline-flex items-center gap-1">
              {rt === 'reviewer' ? <UserCheck className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {rt === 'reviewer' ? 'Reviews' : 'Approvals'}: <span className="font-semibold text-black">{progress[rt].signed}/{progress[rt].required}</span>
            </span>
          ))}
        </div>
      </div>

      {/* My action (sign / reject) */}
      {myRole && (
        <div className="rounded-xl border-2 border-primary-200 bg-primary-50/40 p-4">
          <p className="text-sm font-semibold text-black mb-1">Awaiting your {myRole === 'reviewer' ? 'review' : 'approval'}</p>
          <p className="text-xs text-gray-600 mb-3">Signing stamps your name + date into the document&apos;s Approval Signoff table and advances the status.</p>
          <textarea
            value={signComment}
            onChange={(e) => setSignComment(e.target.value)}
            placeholder="Optional comment…"
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-2"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => signMut.mutate()}
              disabled={signMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {signMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Sign &amp; {myRole === 'reviewer' ? 'Approve Review' : 'Approve'}
            </button>
            {!rejectMode ? (
              <button onClick={() => setRejectMode(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
                <XCircle className="h-4 w-4" /> Reject
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <input value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} placeholder="Reason for rejection (required)…" className="flex-1 rounded-lg border border-rose-300 px-3 py-2 text-sm" />
                <button onClick={() => rejectMut.mutate()} disabled={rejectMut.isPending || !rejectComment.trim()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">Confirm</button>
                <button onClick={() => { setRejectMode(false); setRejectComment(''); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600">Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Participants */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
        <div className="flex items-center gap-2">
          <UsersIcon className="h-4 w-4 text-primary-500" />
          <h3 className="text-sm font-semibold text-black">Participants</h3>
          <span className="text-xs text-gray-400">assign by user, role, or team</span>
        </div>
        {canEditParticipants ? (
          <>
            <AssigneeMultiSelect label="Prepared by" hint="defaults to the creator" value={prepared} onChange={(p) => { setPrepared(p); setDirty(true); }} options={options} />
            <AssigneeMultiSelect label="Reviewers" value={reviewers} onChange={(p) => { setReviewers(p); setDirty(true); }} options={options} />
            <AssigneeMultiSelect label="Approvers" value={approvers} onChange={(p) => { setApprovers(p); setDirty(true); }} options={options} />
            {dirty && (
              <div className="flex justify-end">
                <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save participants
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2 text-sm">
            {(['prepared_by', 'reviewer', 'approver'] as const).map((rt) => {
              const Icon = ROLE_ICON[rt];
              const list = (signoff?.participants?.[rt] || []) as Participant[];
              return list.length > 0 && (
                <div key={rt} className="flex items-start gap-2">
                  <Icon className="h-4 w-4 text-gray-400 mt-0.5" />
                  <div>
                    <span className="text-xs uppercase tracking-wide text-gray-500">{rt.replace('_', ' ')}</span>
                    <p className="text-gray-800">{list.map((p) => p.display).join(', ')}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Send for review */}
      {status === 'draft' && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-black">Send for review / approval</p>
            <p className="text-xs text-gray-500">Routes the document to each assignee&apos;s Pending Approvals queue.</p>
          </div>
          <button onClick={() => sendMut.mutate()} disabled={!canSend || sendMut.isPending} title={canSend ? '' : 'Assign a reviewer or approver first'} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
          </button>
        </div>
      )}

      {/* Signature history */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-black mb-3">Sign-off Trail</h3>
        {signatures.length === 0 ? (
          <p className="text-sm text-gray-500">No signatures yet.</p>
        ) : (
          <div className="space-y-2">
            {signatures.map((s) => (
              <div key={s.id} className={`flex items-start gap-2 rounded-lg border p-2.5 ${s.decision === 'rejected' ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/40'}`}>
                {s.decision === 'rejected' ? <XCircle className="h-4 w-4 text-rose-500 mt-0.5" /> : <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-black">
                    <span className="font-medium">{s.signer_name}</span>
                    <span className="text-gray-500"> — {s.role_label} · {s.decision === 'rejected' ? 'Rejected' : 'Signed'}</span>
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <Clock className="h-3 w-3" />{s.signed_at ? new Date(s.signed_at).toLocaleString() : ''}
                  </div>
                  {s.comment && <p className="text-xs text-gray-600 mt-0.5 italic">“{s.comment}”</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
