'use client';

// Planned actions across every supplier: what is coming, what is due now, and what could not happen. Each is planned on its supplier's action plan (Findings tab of the vendor record).
// The Overview's "My work" lists the person's own that are due now; this page is all of them. The state (Due now, All planned, Could not happen, Done) and whose (Everyone's, Mine) are in the
// address. Who may change an action is what the server allows: the module's own right, or the risk right that accepts every write of the module.
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { ErrorState, SegmentedControl, SkeletonRows, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { oneOf } from '@/lib/addressState';
import { vendorActionsApi } from '@/lib/api';
import { titleFor } from '@/lib/navRegistry';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { EMPTY, stateOptions, type ActionItem } from '../_lib/actions/actionsModel';
import { ActionRow } from '../_lib/actions/shared';

const SCHEMA = { state: oneOf(['due', 'open', 'failed', 'done'] as const, 'due'), scope: oneOf(['all', 'mine'] as const, 'all') };
const WHOSE = [{ value: 'all', label: 'Everyone’s' }, { value: 'mine', label: 'Mine' }] as const;

export default function PlannedActionsPage() {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [{ state, scope }, set] = useAddressState(SCHEMA);
  const q = useQuery({
    queryKey: ['tprm-actions-all', state, scope],
    queryFn: async () => (await vendorActionsApi.all({ state, scope })).data as { items: ActionItem[]; counts: { due: number; failed: number } },
    ...TPRM_QUERY_OPTS,
  });
  const items = q.data?.items ?? [];

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={titleFor('/vendor-risk/actions') ?? 'Planned actions'}
        info="Every supplier's action plan in one place. To-dos wait for a person to mark them done; questionnaires, check-ins and reassessments happen on their date. Plan one from a supplier's Findings tab."
        back={{ href: '/vendor-risk', label: 'Back to the Overview' }}
        actions={<SegmentedControl label="Whose actions" name="actions-scope" options={WHOSE} value={scope} onChange={(value) => set({ scope: value })} />}
      />
      <SegmentedControl label="Which actions" name="actions-state" className="self-start" options={stateOptions(q.data?.counts)} value={state} onChange={(value) => set({ state: value })} />
      <section aria-label="Planned actions" className="rounded-ds-card border border-ds-border bg-ds-surface p-[8px]">
        {q.isPending && <SkeletonRows rows={5} columns={3} label="Loading the planned actions" />}
        {q.isError && <ErrorState title="Couldn't load the planned actions" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
        {q.isSuccess && items.length === 0 && (
          <p className="m-0 flex items-center gap-[8px] px-[8px] py-[16px] text-ds-body text-ds-fg-muted"><CheckCircle2 aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-success" strokeWidth={1.75} />{EMPTY[state]}</p>
        )}
        {items.length > 0 && <ul className="m-0 list-none p-0">{items.map((i) => <ActionRow key={i.id} item={i} canEdit={canEdit} showVendor />)}</ul>}
      </section>
    </div>
  );
}
