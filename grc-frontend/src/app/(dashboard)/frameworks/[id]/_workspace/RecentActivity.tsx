'use client';

// The latest things that happened on the journey (scope requests and decisions, snapshots), from what the page already holds. A line opens the
// tab where it can be followed up.
import { SectionCard } from '@/components/ui/ds';
import { formatDateTime } from '@/lib/format';
import type { ActivityItem } from '@/lib/journeyModel';

export default function RecentActivity({ items, scopeFailed, goTab }: { items: ActivityItem[]; scopeFailed: boolean; goTab: (tab: string) => void }) {
  return (
    <SectionCard id="recent" title="Recent activity" info="Scope requests and decisions, and the snapshots taken, newest first.">
      {items.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">{scopeFailed ? "The scope decisions didn't load, so only snapshots can appear here." : 'Nothing has happened on this journey yet.'}</p>
      ) : (
        <ul className="divide-y divide-ds-border">
          {items.map((a, i) => (
            <li key={`${a.kind}-${a.at}-${i}`}>
              <button
                type="button"
                onClick={() => goTab(a.tab)}
                className="flex min-h-ds-control w-full flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[2px] py-[8px] text-left text-ds-body text-ds-fg-body hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring"
              >
                <span className="min-w-0 flex-1 basis-[14rem]">{a.text}</span>
                <span className="shrink-0 text-ds-label text-ds-fg-muted">{formatDateTime(a.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
