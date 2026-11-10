'use client';

// A supplier's activity trail in words (who did what, from what to what, when): the Overview's "Latest activity" and the Lifecycle's Activity drawer draw the same list from the same read
// (`tpra-vendor-audit`), so a person never meets "Finding #12" or "User 5" (Rule U1) and the server's time is shown as the viewer's own day and clock.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, SkeletonLines } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDateTime } from '@/lib/format';
import { tpraApi } from '@/lib/api';
import { activityLine, type ActivityEntry } from '../../../_lib/activityModel';
import { TPRM_QUERY_OPTS } from '../../../_lib/tprmQuery';
import RecordPanel from './RecordPanel';

export function useVendorActivity(vendorId: number, enabled = true) {
  return useQuery({
    queryKey: ['tpra-vendor-audit', vendorId],
    queryFn: async () => (await tpraApi.getVendorAudit(vendorId)).data as { items: ActivityEntry[] },
    enabled,
    ...TPRM_QUERY_OPTS,
  });
}

export function ActivityList({ items }: { items: ActivityEntry[] }) {
  return (
    <ol className="flex flex-col gap-[12px] border-l border-ds-border pl-[16px]">
      {items.map((a) => {
        const line = activityLine(a);
        return (
          <li key={a.id} className="relative">
            <span aria-hidden className="absolute -left-[21px] top-[6px] h-[8px] w-[8px] rounded-full bg-ds-primary ring-2 ring-ds-surface" />
            <p className="text-ds-body text-ds-fg"><span className="font-[600]">{line.who}</span> {line.what}</p>
            {line.detail && <p className="break-words text-ds-body text-ds-fg-muted">{line.detail}</p>}
            <p className="text-ds-label text-ds-fg-muted">{formatDateTime(line.at)}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** The read and its three states, drawn bare (for a drawer) or inside the Overview's card. */
export function ActivityBody({ vendorId, limit }: { vendorId: number; limit?: number }) {
  const q = useVendorActivity(vendorId);
  const [all, setAll] = useState(false);
  if (q.isPending) return <SkeletonLines lines={4} label="Loading the activity" />;
  if (q.isError || !q.data) return <ErrorState compact title="Couldn’t load the activity" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />;
  const rows = q.data.items;
  if (rows.length === 0) return <EmptyState kind="firstUse" bare title="No activity recorded yet" description="Changes to this supplier appear here as they are made." />;
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  return (
    <div className="flex flex-col gap-[12px]">
      <ActivityList items={shown} />
      {limit && rows.length > limit && !all && <div><Button size="sm" onClick={() => setAll(true)}>Show all {rows.length}</Button></div>}
    </div>
  );
}

export default function ActivityPanel({ vendorId }: { vendorId: number }) {
  return (
    <RecordPanel title="Latest activity" info="Who changed what on this supplier, newest first.">
      <ActivityBody vendorId={vendorId} limit={6} />
    </RecordPanel>
  );
}
