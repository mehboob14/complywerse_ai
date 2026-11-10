'use client';

// The observation's timeline: what happened to it, newest first, in words (a move between two statuses names both, an edit names what changed, a link names the record), who did it and
// when. The server keeps the latest 50 changes of a record and says how many there are; when there are more, so does this tab.
import { ArrowRightLeft, FilePlus2, Link2, Link2Off, Pencil, Plus } from 'lucide-react';
import { Notice } from '@/components/ui/ds';
import { formatCount, formatDateTime } from '@/lib/format';
import { activityKind } from '@/lib/statuses/statutory';
import { activityWords, type HistoryRow, type Level } from '../../_register/observationModel';

const ICON: Record<string, typeof Plus> = { created: FilePlus2, update: Pencil, status_change: ArrowRightLeft, link: Link2, unlink: Link2Off };

export function TimelineTab({ history, total, levels }: { history: readonly HistoryRow[]; total: number; levels: readonly Level[] }) {
  if (history.length === 0) {
    return <p className="rounded-ds-card border border-ds-border bg-ds-surface px-[16px] py-[24px] text-center text-ds-body text-ds-fg-muted">Nothing has happened to this observation yet.</p>;
  }
  return (
    <div className="flex flex-col gap-[12px]">
      {total > history.length && (
        <Notice tone="info" title={`The latest ${formatCount(history.length)} of ${formatCount(total)} changes`}>Older changes are not shown here.</Notice>
      )}
      <ol aria-label="Timeline" className="m-0 flex list-none flex-col rounded-ds-card border border-ds-border bg-ds-surface p-0">
        {history.map((h, i) => {
          const Icon = ICON[h.activity_type] ?? Plus;
          const words = activityWords(h, levels);
          return (
            <li key={h.id} className={`flex gap-[12px] px-[16px] py-[12px] ${i > 0 ? 'border-t border-ds-border' : ''}`}>
              <span aria-hidden className="mt-[2px] grid h-[24px] w-[24px] shrink-0 place-items-center rounded-full bg-ds-primary-soft text-ds-primary-text"><Icon className="h-[14px] w-[14px]" strokeWidth={1.75} /></span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]"><span className="sr-only">{activityKind.label(h.activity_type)}: </span>{words.text}</p>
                {words.note && <p className="mt-[2px] break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">“{words.note}”</p>}
                <p className="mt-[2px] text-ds-label text-ds-fg-muted">{h.user_name || 'The platform'} · {formatDateTime(h.created_at)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
