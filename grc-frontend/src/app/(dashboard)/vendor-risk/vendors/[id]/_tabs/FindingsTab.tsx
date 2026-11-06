'use client';

// Findings tab of the vendor record. Owner: B5a.
// Every finding of the vendor, all its engagements and General together, the open ones and the worst first, as Verity draws them:
// an owner, Start remediation, Close, Accept risk, Reopen. Then the action plan. `findingId` (a link from the register, an alert or
// the attention queue) opens that finding.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { BTN_PRIMARY, EmptyState, ErrorState, Panel, Skeleton } from '@/app/(dashboard)/vendor-risk/_ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { apiErrorText } from '@/lib/apiError';
import { usePeople } from '../../../_lib/actions/shared';
import { useEngagements } from '../../../_lib/engagementsApi';
import { findingsApi, refreshFindings, useVendorFindings, type RaiseInput } from '../../../_lib/findingsApi';
import { blockingLine } from '../../../_lib/findingCardModel';
import { requestsApi } from '../../../_lib/requestsApi';
import ActionPlanPanel from '../_tpra/ActionPlanPanel';
import FindingCard from '../_tpra/FindingCard';
import { RaiseFindingDialog } from '../_tpra/FindingDialogs';
import type { TabProps } from './tabProps';

export default function FindingsTab({ vendorId, engagementId, findingId, onChanged }: TabProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');          // the fallback every vendor-risk write accepts
  const rights = {
    edit: hasPermission('vendor_risk:findings:edit') || erm,
    accept: hasPermission('vendor_risk:findings:accept_risk'),          // no fallback: the approver's own right
    remove: hasPermission('vendor_risk:findings:delete') || erm,
  };
  const canRaise = hasPermission('vendor_risk:findings:create') || erm;

  const [removed, setRemoved] = useState(false);
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<number | null>(findingId ?? null);
  const deepLinkDone = useRef(false);

  const list = useVendorFindings(vendorId, removed);
  const people = usePeople();
  const { data: engaged } = useEngagements(vendorId);
  const { data: asked } = useQuery({
    queryKey: ['tprm-supplier-requests', vendorId],
    queryFn: async () => (await requestsApi.list(vendorId)).data,
  });

  const items = list.data?.items ?? [];
  // Findings shared with the vendor and not finished: one request each at a time.
  const sharedOf = new Map((asked?.items || [])
    .filter((r) => r.finding && ['open', 'submitted', 'returned'].includes(r.status))
    .map((r) => [r.finding!.id, r] as const));
  // The engagements a finding can be about, besides the vendor itself.
  const uses = (engaged?.items ?? []).filter((e) => !e.is_general && e.id && e.status !== 'ended').map((e) => ({ id: e.id as number, name: e.name }));

  const raise = useMutation({
    mutationFn: (input: RaiseInput) => findingsApi.raise(vendorId, input),
    onSuccess: () => { refreshFindings(qc); onChanged?.(); setRaising(false); toast({ type: 'success', title: 'Finding raised' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not raise the finding', message: apiErrorText(e, 'Try again.') }),
  });

  useEffect(() => {
    if (deepLinkDone.current || findingId == null) return;
    if (items.some((f) => f.id === findingId)) {
      setOpen(findingId);
      deepLinkDone.current = true;
      // After the card has drawn, bring it into view.
      setTimeout(() => document.getElementById(`tpra-finding-${findingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    }
  }, [items, findingId]);

  let body;
  if (list.isLoading) {
    body = <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  } else if (!list.data) {
    body = <ErrorState title="Couldn't load the findings" message={apiErrorText(list.error, 'Try again in a moment.')} onRetry={() => list.refetch()} />;
  } else if (items.length === 0) {
    body = <EmptyState bare title="No findings" hint="They come from questionnaires, reviews and service level misses." />;
  } else {
    body = (
      <ul className="divide-y divide-[#e1e6eb]">
        {items.map((f) => (
          <FindingCard
            key={f.id} finding={f} people={people} rights={rights} shared={sharedOf.get(f.id)}
            expanded={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)}
            highlight={findingId === f.id} onChanged={onChanged}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Findings"
        count={items.length || undefined}
        description={blockingLine(items, list.data?.blocking_total) ?? undefined}
        action={(
          <>
            {rights.remove && (
              <label className="flex items-center gap-1.5 text-[13px] text-[#586472]">
                <input type="checkbox" checked={removed} onChange={(e) => setRemoved(e.target.checked)} className="h-3.5 w-3.5 accent-[#0f766e]" />
                Show removed
              </label>
            )}
            {canRaise && (
              <button type="button" className={BTN_PRIMARY} onClick={() => setRaising(true)}>
                <Plus aria-hidden className="h-4 w-4" /> Raise finding
              </button>
            )}
          </>
        )}
      >
        {body}
      </Panel>

      <ActionPlanPanel vendorId={vendorId} />

      <RaiseFindingDialog
        open={raising} onClose={() => setRaising(false)} busy={raise.isPending} people={people}
        engagements={uses} defaultEngagementId={engagementId}
        onRaise={(input) => raise.mutate(input)}
      />
    </div>
  );
}
