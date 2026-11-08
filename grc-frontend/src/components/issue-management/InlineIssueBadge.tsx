'use client';

// "N open": the number of OPEN issues linked to a record, as a pill that opens the register filtered to that record. It drops into a table row or a list without moving anything: hidden
// when there are none (unless asked), hidden when the person may not read issues or the read failed (a badge never says "0" for a read that did not happen). A table of 50 rows asks
// for 50 records; the asks of one render leave as ONE call (embedApi `askCounts`). The props are the old badge's.
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusPill } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { askCounts } from './embedApi';
import { badgeView, viewAllHref } from './embedModel';
import { VIEW_ISSUES } from './RelatedIssuesPanel';

interface Props {
  sourceType: string;
  sourceId: number;
  /** When true the badge takes no space until at least one open issue exists. */
  hideWhenZero?: boolean;
  /** `xs` is the dense pill (table cells), `sm` the normal one. */
  size?: 'xs' | 'sm';
}

export function InlineIssueBadge({ sourceType, sourceId, hideWhenZero = true, size = 'xs' }: Props) {
  const { hasPermission } = usePermissions();
  const counts = useQuery({
    queryKey: ['issues-by-source-counts', sourceType, sourceId],
    queryFn: () => askCounts(sourceType, sourceId),
    staleTime: 30_000,
    enabled: !!sourceId && hasPermission(VIEW_ISSUES),
    retry: false,
  });
  const view = counts.data ? badgeView(counts.data, hideWhenZero) : null;
  if (!view) return null;
  return (
    <Link href={viewAllHref(sourceType, sourceId)} onClick={(e) => e.stopPropagation()} aria-label={`${view.name}. Open them in the register`} className="inline-flex items-center">
      <StatusPill size={size === 'xs' ? 'sm' : 'md'} tone={view.tone} label={view.label} />
    </Link>
  );
}
