'use client';

// InlineIssueBadge
// ─────────────────────────────────────────────────────────────────────────
// Tiny "🐛 N" chip showing the number of OPEN issues linked to a source
// entity, with click-through to a filtered /issues view. Drops inline into
// tables, lists, and control rows without disrupting existing layouts.

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bug, AlertCircle } from 'lucide-react';
import { issuesApi } from '@/lib/api';

interface Props {
  sourceType: string;
  sourceId: number;
  /** When true the badge takes no space until at least one open issue exists. */
  hideWhenZero?: boolean;
  /** Visual scale. */
  size?: 'xs' | 'sm';
}

interface BySourcePayload {
  total_open: number;
  critical_open: number;
}

export function InlineIssueBadge({ sourceType, sourceId, hideWhenZero = true, size = 'xs' }: Props) {
  const { data } = useQuery<BySourcePayload>({
    queryKey: ['issues-by-source', sourceType, sourceId],
    queryFn: async () => (await issuesApi.bySource(sourceType, sourceId)).data,
    staleTime: 30_000,
    enabled: !!sourceId,
  });

  const open = data?.total_open ?? 0;
  if (hideWhenZero && open === 0) return null;

  const critical = data?.critical_open ?? 0;
  const tone =
    critical > 0
      ? 'border-rose-300 bg-rose-50 text-rose-700'
      : open > 0
        ? 'border-amber-300 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-500';

  const Icon = critical > 0 ? AlertCircle : Bug;
  const padding = size === 'xs' ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[10px]';

  return (
    <Link
      href={`/issues?source_type=${sourceType}&source_id=${sourceId}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-0.5 rounded border ${tone} ${padding} font-semibold transition-colors hover:brightness-95`}
      title={
        critical > 0
          ? `${open} open issue${open === 1 ? '' : 's'} (${critical} critical) — click to view`
          : `${open} open issue${open === 1 ? '' : 's'} — click to view`
      }
    >
      <Icon className={size === 'xs' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {open}
    </Link>
  );
}
