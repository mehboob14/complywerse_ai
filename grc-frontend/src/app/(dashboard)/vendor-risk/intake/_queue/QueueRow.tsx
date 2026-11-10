'use client';

// One request in the queue: the name, who asked and when, how it stands, how urgent and how long it has waited. The whole row is one button that selects the request (its details are
// on the right, or in a sheet on a narrow screen); nothing in it is a second control, so it is one tab stop and one target.
import { clsx } from 'clsx';
import { StatusPill } from '@/components/ui/ds';
import type { RequestRow } from '../../_lib/intakeApi';
import { byline, decisionPill, screeningPill, urgencyPill, waited } from '../../_lib/intakeModel';

export default function QueueRow({ row, selected, now, onSelect }: { row: RequestRow; selected: boolean; now: Date; onSelect: () => void }) {
  const decision = decisionPill(row.intake_status);
  const screening = screeningPill(row.screening);
  const urgency = row.intake_status === 'submitted' || row.intake_status === 'draft' ? urgencyPill(row.urgency) : null;
  const wait = row.intake_status === 'submitted' ? waited(row, now) : null;
  return (
    <button
      type="button"
      data-queue-row={row.id}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={clsx(
        'flex w-full min-w-0 flex-col gap-[4px] border-b border-ds-border px-[12px] py-[8px] text-left last:border-b-0 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]',
        selected ? 'bg-ds-primary-soft' : 'bg-ds-surface hover:bg-ds-surface-hover',
      )}
    >
      <span className="flex min-w-0 items-start justify-between gap-[8px]">
        <span dir="auto" className="min-w-0 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.name}</span>
        {wait && <span className="shrink-0 text-ds-label text-ds-fg-muted">{wait}</span>}
      </span>
      <span dir="auto" className="min-w-0 break-words text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{byline(row)}</span>
      <span className="flex flex-wrap items-center gap-[4px]">
        <StatusPill size="sm" tone={decision.tone} label={decision.label} />
        {urgency && <StatusPill size="sm" tone={urgency.tone} label={urgency.label} />}
        {screening && screening.tone === 'warning' && <StatusPill size="sm" tone={screening.tone} label={screening.label} />}
      </span>
    </button>
  );
}
