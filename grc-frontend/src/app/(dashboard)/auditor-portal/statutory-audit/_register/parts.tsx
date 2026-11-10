'use client';

// The small pieces Statutory Audit's register, drawer and record share: the status, priority, type and SLA pills (every one with its word: colour never says it alone), the due
// date, and the notice on a copy of a register finding.
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Notice, StatusPill } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { levelPill, observationPriority, observationType, slaState } from '@/lib/statuses/statutory';
import { slaText, type Level, type Sla } from './observationModel';

export const MUTED = 'text-ds-fg-muted';

export const StatusTag = ({ levels, status }: { levels: readonly Level[]; status: string }) => <StatusPill size="sm" {...levelPill(levels, status)} />;
export const PriorityTag = ({ priority }: { priority: string }) => <StatusPill size="sm" {...statusPill(observationPriority, priority)} />;
export const TypeTag = ({ type }: { type: string }) => <StatusPill size="sm" {...statusPill(observationType, type)} />;

/** Where the observation stands against its SLA, in words; nothing for a closed one. */
export function SlaTag({ sla }: { sla: Sla | null | undefined }) {
  const text = slaText(sla, { escalated: false });          // a pill is one short line: "escalated" is said in the due column and on the record
  if (!sla || !text) return null;
  return <StatusPill size="sm" tone={slaState.tone(sla.state)} label={text} />;
}

/** The due date as a day, with the SLA in words under it (one line each, so a narrow column still reads). */
export function DueCell({ due, sla }: { due: string | null; sla: Sla | null }) {
  const text = slaText(sla);
  return (
    <span className="flex min-w-0 flex-col">
      <span className={`whitespace-nowrap text-ds-body ${due ? 'text-ds-fg-body' : MUTED}`}>{formatDate(due, { calendar: true })}</span>
      {text && <span className={`break-words text-ds-label ${sla?.state === 'breached' ? 'font-[600] text-ds-danger' : MUTED}`}>{text}</span>}
    </span>
  );
}

/** Said wherever a copy of a regulator finding of the Issue Register can be edited: what is the register's, and where to change it. */
export function MirroredNote({ issueId, compact = false }: { issueId: number | null; compact?: boolean }) {
  return (
    <Notice
      tone="info"
      title="Kept in step with the Issue Register"
      action={issueId ? (
        <Link href={`/issues/${issueId}`} className="inline-flex min-h-ds-control items-center gap-[4px] text-ds-body font-[600] text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
          Open the finding<ArrowUpRight aria-hidden size={14} />
        </Link>
      ) : undefined}
    >
      {compact
        ? 'This is a copy of a regulator finding. Change its details in the register; they are overwritten from it.'
        : 'This is a copy of a regulator finding in the Issue Register. Its title, status, owner, dates, priority and response come from there and are overwritten on every update, so change them in the register. Notes, evidence and links are yours.'}
    </Notice>
  );
}
