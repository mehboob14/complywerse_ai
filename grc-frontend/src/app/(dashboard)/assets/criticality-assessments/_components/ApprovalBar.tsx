'use client';

// ApprovalBar
// ─────────────────────────────────────────────────────────────────────────
// Three-tier sequential approval UI for a criticality assessment row.
// Mirrors the workflow described in the Phase 2 plan: Assessor → Business
// Owner / Custodian → CISO. Renders the right action button(s) based on
// the row's `approval_status` + the current user identity / permissions.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, Send, RotateCcw, ShieldCheck, Clock, FileText,
} from 'lucide-react';
import {
  criticalityApi,
  type CriticalityKind,
  type IscaItem,
  type IacaItem,
} from '@/lib/api';

export type ApprovalCapableItem = (IscaItem | IacaItem) & { id: number };

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  business_owner_review: 'Pending Business Owner',
  ciso_review: 'Pending CISO',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned',
};

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  business_owner_review: 'bg-amber-50 text-amber-700 border-amber-200',
  ciso_review: 'bg-violet-50 text-violet-700 border-violet-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  returned: 'bg-orange-50 text-orange-700 border-orange-200',
};

export function StatusPill({ status }: { status?: string | null }) {
  const s = status || 'draft';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${STATUS_TONE[s] ?? STATUS_TONE.draft}`}>
      {STATUS_LABEL[s] ?? s}
    </span>
  );
}

export function ApprovalBar({
  kind,
  item,
  currentUserId,
  canCisoApprove,
}: {
  kind: CriticalityKind;
  item: ApprovalCapableItem;
  /** The caller's user id — used to enforce tier-1 / tier-2 author match
   *  client-side (the server still re-checks). */
  currentUserId: number | null;
  /** True when the caller holds `assets:criticality_assessments:approve_ciso`. */
  canCisoApprove: boolean;
}) {
  const qc = useQueryClient();
  const [actionPending, setActionPending] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['criticality.isca.list'] });
    qc.invalidateQueries({ queryKey: ['criticality.iaca.list'] });
    qc.invalidateQueries({ queryKey: ['criticality.activity', kind, item.id] });
  };

  const submitM = useMutation({
    mutationFn: () => criticalityApi.approval.submit(kind, item.id),
    onSuccess: invalidate,
  });
  const approveBoM = useMutation({
    mutationFn: (notes: string | undefined) =>
      criticalityApi.approval.approveBusinessOwner(kind, item.id, notes),
    onSuccess: invalidate,
  });
  const approveCisoM = useMutation({
    mutationFn: (notes: string | undefined) =>
      criticalityApi.approval.approveCiso(kind, item.id, notes),
    onSuccess: invalidate,
  });
  const rejectM = useMutation({
    mutationFn: (reason: string) => criticalityApi.approval.reject(kind, item.id, reason),
    onSuccess: invalidate,
  });
  const returnM = useMutation({
    mutationFn: (reason: string) => criticalityApi.approval.return(kind, item.id, reason),
    onSuccess: invalidate,
  });

  const status = item.approval_status || 'draft';
  // Tier-1 actor: explicit assessor → fallback to creator. Server keeps
  // the same fallback, so this matches.
  const tier1ActorId = item.assessor_user_id ?? null;
  // Tier-2 actor: Business Owner on ISCA, Custodian on IACA.
  const tier2ActorId =
    kind === 'isca'
      ? (item as IscaItem).business_owner_user_id ?? null
      : (item as IacaItem).custodian_user_id ?? null;

  const isAssessor = currentUserId !== null && (tier1ActorId === null || tier1ActorId === currentUserId);
  const isBusinessOwner = currentUserId !== null && (tier2ActorId === null || tier2ActorId === currentUserId);

  const canSubmit = (status === 'draft' || status === 'returned') && isAssessor;
  const canApproveBo = status === 'business_owner_review' && isBusinessOwner;
  const canActCiso = status === 'ciso_review' && canCisoApprove;

  const handle = async (label: string, fn: () => Promise<unknown>) => {
    setActionPending(label);
    try {
      await fn();
    } finally {
      setActionPending(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Status</span>
          <StatusPill status={status} />
          {item.current_approval_tier ? (
            <span className="text-[10px] text-slate-500">Tier {item.current_approval_tier}/3</span>
          ) : null}
        </div>
        {item.approved_at && item.approved_by_name && (
          <div className="text-[10px] text-emerald-700 inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            Signed by {item.approved_by_name} on {new Date(item.approved_at).toLocaleDateString()}
          </div>
        )}
      </div>

      {status === 'rejected' && item.rejection_reason && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
          <span className="font-semibold">Rejected:</span> {item.rejection_reason}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canSubmit && (
          <button
            type="button"
            disabled={!!actionPending}
            onClick={() => handle('submit', () => submitM.mutateAsync())}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Submit for review
          </button>
        )}

        {canApproveBo && (
          <>
            <button
              type="button"
              disabled={!!actionPending}
              onClick={() => handle('approve-bo', () => approveBoM.mutateAsync(undefined))}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Approve (Business Owner)
            </button>
            <ReasonButton
              label="Return"
              icon={RotateCcw}
              tone="amber"
              disabled={!!actionPending}
              onSubmit={(reason) => handle('return', () => returnM.mutateAsync(reason))}
            />
          </>
        )}

        {canActCiso && (
          <>
            <button
              type="button"
              disabled={!!actionPending}
              onClick={() => handle('approve-ciso', () => approveCisoM.mutateAsync(undefined))}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Final approval (CISO)
            </button>
            <ReasonButton
              label="Reject"
              icon={XCircle}
              tone="rose"
              disabled={!!actionPending}
              onSubmit={(reason) => handle('reject', () => rejectM.mutateAsync(reason))}
            />
            <ReasonButton
              label="Return"
              icon={RotateCcw}
              tone="amber"
              disabled={!!actionPending}
              onSubmit={(reason) => handle('return', () => returnM.mutateAsync(reason))}
            />
          </>
        )}

        {status === 'submitted' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <Clock className="h-3 w-3" />
            Awaiting Business Owner review
          </span>
        )}
        {!canSubmit && !canApproveBo && !canActCiso && status !== 'submitted' && status !== 'approved' && status !== 'rejected' && (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
            <FileText className="h-3 w-3" />
            No action available at this tier for the current user.
          </span>
        )}
      </div>
    </div>
  );
}

function ReasonButton({
  label,
  icon: Icon,
  tone,
  disabled,
  onSubmit,
}: {
  label: string;
  icon: typeof CheckCircle2;
  tone: 'amber' | 'rose';
  disabled: boolean;
  onSubmit: (reason: string) => void;
}) {
  const colors =
    tone === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
      : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        const reason = window.prompt(`Reason for ${label.toLowerCase()}:`);
        if (reason && reason.trim()) onSubmit(reason.trim());
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium ${colors} disabled:opacity-50`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
