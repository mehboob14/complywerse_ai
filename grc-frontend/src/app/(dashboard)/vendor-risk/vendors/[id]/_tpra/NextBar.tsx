'use client';

// "NEXT <stage> goes to <names> (<role>)", with Notify; or, for a role nobody holds, an amber "No <role> on the roster" and a way
// to the roster. Shown on the current stage when it can be completed. The people come from the workspace roster (backend
// tpra/roster.py); Notify tells them in the app and by email.
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { BTN } from '../_record/btn';
import { TONE } from '@/lib/status';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText, lifecycleApi, useNextStage, type NextRole } from '../../../_lib/lifecycleApi';

const names = (role: NextRole) => role.members.map((m) => m.name).join(', ');

export default function NextBar({ vendorId, engagementId, stage, ready, canNotify }: {
  vendorId: number;
  engagementId: number | null;
  /** the stage the work is at: the answer changes when it moves */
  stage: string | null;
  /** nothing blocks the stage and the person may move it */
  ready: boolean;
  canNotify: boolean;
}) {
  const { toast } = useToast();
  const { data } = useNextStage(vendorId, engagementId, stage, ready);
  const notify = useMutation({
    mutationFn: () => lifecycleApi.notify(vendorId, engagementId),
    onSuccess: (res) => toast({
      type: 'success',
      title: res.data.notified ? `Notified ${res.data.notified} ${res.data.notified === 1 ? 'person' : 'people'} in the app and by email` : 'Nobody to notify',
    }),
    onError: (e) => toast({ type: 'error', title: 'Not sent', message: apiErrorText(e, 'Try again.') }),
  });
  if (!ready || !data?.stage_key) return null;

  const held = data.roles.filter((r) => r.members.length > 0);
  const missing = data.roles.filter((r) => r.missing);
  const approvers = data.anyone_who_can_approve;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-ds-card border border-ds-border bg-ds-surface-subtle px-3.5 py-2.5">
      <div className="min-w-0 text-[13px] leading-5 text-ds-fg-body">
        <span className="mr-2 text-[12px] font-[700] tracking-wider text-ds-fg-muted">NEXT</span>
        <span className="font-[600]">{data.stage_label}</span>
        {held.length > 0 && <> goes to {held.map((r, i) => <span key={r.key}>{i > 0 && ', '}{names(r)} <span className="text-ds-fg-muted">({r.label})</span></span>)}</>}
        {held.length === 0 && approvers && ' goes to anyone who can approve vendors, other than the business owner and whoever submits it'}
        {missing.map((r) => (
          <span key={r.key} className="ml-2 font-medium" style={{ color: TONE.warning.text }}>No {r.label} on the roster</span>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {missing.length > 0 && <Link href="/vendor-risk/roster" className={`${BTN} !h-8 !px-2.5 !text-[13px]`}>Open roster</Link>}
        {canNotify && held.length > 0 && (
          <button type="button" className={`${BTN} !h-8 !px-2.5 !text-[13px]`} disabled={notify.isPending} onClick={() => notify.mutate()}>
            <Bell aria-hidden className="h-3.5 w-3.5" /> Notify
          </button>
        )}
      </div>
    </div>
  );
}
