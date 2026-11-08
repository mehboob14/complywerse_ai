'use client';

// What happened to the unit, newest first: who submitted it, who approved, sent it back or rejected it, when, and the words they wrote. The assessor reads the reviewer's comment here
// when the unit comes back (the old pages never showed one). Time is the server's naive UTC (formatDateTime reads it).
import { StatusPill } from '@/components/ui/ds';
import { formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { approvalAction } from '@/lib/statuses/rcsa';

export interface Step { action: string; tier_number: number; performer_name?: string | null; delegate_name?: string | null; comments?: string | null; performed_at?: string | null }

export function ReviewTrail({ steps, totalTiers }: { steps: Step[]; totalTiers: number }) {
  if (steps.length === 0) return <p className="text-ds-body text-ds-fg-muted">Nothing has happened yet.</p>;
  const ordered = steps.slice().reverse();
  return (
    <ol aria-label="Review history" className="m-0 flex list-none flex-col gap-[12px] p-0">
      {ordered.map((s, i) => {
        const pill = statusPill(approvalAction, s.action);
        const when = s.performed_at ? formatDateTime(s.performed_at) : '';
        return (
          <li key={`${s.action}-${s.performed_at}-${i}`} className="flex flex-col gap-[4px] border-l-2 border-ds-border pl-[12px]">
            <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label text-ds-fg-muted">
              <StatusPill size="sm" tone={pill.tone} label={pill.label} />
              <span className="text-ds-body text-ds-fg">{s.performer_name || 'Someone'}</span>
              {totalTiers > 1 && s.tier_number > 0 && <span>{`Step ${s.tier_number} of ${totalTiers}`}</span>}
              {when && <span>{when}</span>}
            </div>
            {s.comments && s.comments.trim() && <p className="whitespace-pre-line break-words text-ds-body text-ds-fg [overflow-wrap:anywhere]">{s.comments}</p>}
          </li>
        );
      })}
    </ol>
  );
}
