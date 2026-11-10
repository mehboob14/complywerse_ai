'use client';

// One finding over the register's list: THE finding card (the one the vendor's Findings tab and the lifecycle's stage draw) with every action in place: an owner, Start remediation, Close,
// Accept risk, Reopen, Share with the vendor, Promote to risk, its remediation tasks, acceptances and evidence. It asks for the whole finding when it opens (the register holds a row, not the
// description or the fix history), then keeps the register and the Overview true after each change. Previous and next walk the list as it is shown; "Open the vendor" leaves for the lifecycle.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, ErrorState, IconButton, Notice, SidePanel, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { usePeople } from '../../_lib/actions/shared';
import type { FindingRow } from '../../_lib/findingsApi';
import { recordHref, vendorHref, type RegisterFinding } from '../../_lib/findingsModel';
import FindingCard, { useFindingRights } from '../../vendors/[id]/_tpra/FindingCard';
import { useSharedFindings } from '../../vendors/[id]/_tpra/FindingList';
import type { FindingDetail } from '../../vendors/[id]/_tpra/types';

export default function FindingDrawer({ row, openId, onClose, onStep, hasPrev, hasNext, restoreFocus }: {
  /** the register's row for the open finding (null: it is not in the register) */
  row: RegisterFinding | null;
  openId: number | null;
  onClose: () => void;
  onStep: (dir: 1 | -1) => void;
  hasPrev: boolean;
  hasNext: boolean;
  restoreFocus?: () => HTMLElement | null;
}) {
  const { rights } = useFindingRights();
  const people = usePeople();
  const [details, setDetails] = useState(true);
  const shared = useSharedFindings(row?.vendor_id);
  const q = useQuery({
    queryKey: ['tpra-finding', openId],
    queryFn: async () => (await tpraApi.getFinding(openId as number)).data as FindingDetail,
    enabled: openId != null && !!row,
  });
  const full = (q.data?.finding ?? null) as FindingRow | null;
  return (
    <SidePanel
      open={openId != null && !!row}
      onClose={onClose}
      title={<span dir="auto" className="line-clamp-3 break-words" title={row?.title || undefined}>{row?.title || 'Untitled finding'}</span>}
      subtitle={row?.vendor_name || undefined}
      dockFrom={Infinity}
      width="lg"
      restoreFocus={restoreFocus}
      actions={row && (
        <>
          <IconButton label="Previous finding" aria-disabled={!hasPrev || undefined} onClick={() => { if (hasPrev) onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next finding" aria-disabled={!hasNext || undefined} onClick={() => { if (hasNext) onStep(1); }}><ChevronDown aria-hidden /></IconButton>
        </>
      )}
      footer={row && (
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button href={vendorHref(row)}>Open the vendor</Button>
          <Button href={recordHref(row)} variant="primary">Open on the vendor’s page</Button>
        </div>
      )}
    >
      {q.isPending && <div aria-busy="true"><span className="sr-only">Loading the finding</span><Skeleton className="h-[20px] w-[60%]" /><Skeleton className="mt-[8px] h-[64px] w-full" /></div>}
      {q.isError && (
        statusOf(q.error) === 404
          ? <Notice tone="warning" title="That finding is not there any more">It may have been removed. Close this to see the register without it.</Notice>
          : <ErrorState compact title="Couldn't load the finding" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      )}
      {full && (
        <FindingCard
          as="div" finding={full} people={people} rights={rights} shared={shared.get(full.id)}
          expanded={details} onToggle={() => setDetails((d) => !d)}
        />
      )}
    </SidePanel>
  );
}
