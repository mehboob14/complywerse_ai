'use client';

// One document of a group, as a compact line: the title, who owns it, the step it is at, the BLOCKER in words ("Waiting on Sara and 1 more", "Stuck: nobody can be asked", "3 proposed changes
// wait for the owner") and how long it has waited. The whole line is a disclosure button (aria-expanded): opening it draws the document's detail (TrackerDetail), which asks the server for the
// workflow at that moment. The words are lineModel.ts (tested). Wide, the line is a row of columns; in a narrow box it is three lines (title and age, owner and step, the blocker).
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Skeleton, StatusPill } from '@/components/ui/ds';
import type { TrackerLine } from '@/lib/documentTrackerApi';
import type { GovDoc } from '../lib';
import type { Lookups } from '../libraryModel';
import { OwnerAvatar } from '../libraryRows';
import type { TrackerContext } from '../libraryTracker';
import { TrackerDetail } from './TrackerDetail';
import { ageOf, blockerOf, stepWord, youOf } from './lineModel';

export interface RowEnv {
  lookups: Lookups;
  ctx: TrackerContext;
  /** the box is narrow: the line is three lines instead of columns */
  narrow: boolean;
  activeId: number | null;
  onOpen: (doc: GovDoc) => void;
  hrefOf: (id: number) => string;
}

const TEXT: Record<string, string> = { danger: 'font-[600] text-ds-danger', warning: 'font-[600] text-ds-warning', success: 'text-ds-success', progress: 'text-ds-fg-body', neutral: 'text-ds-fg-muted', pending: 'text-ds-fg-body' };

/** A document waits on a line from the server for its blocker's words: one in review or approval, one sent back, one with a proposed change. */
export function needsLine(doc: Pick<GovDoc, 'id' | 'status'>, ctx: Pick<TrackerContext, 'sets'>): boolean {
  return doc.status === 'pending_review' || doc.status === 'pending_approval' || !!ctx.sets?.changes_requested.has(doc.id) || !!ctx.sets?.proposals_waiting.has(doc.id);
}

export interface TrackerRowProps {
  doc: GovDoc;
  /** the server's line for it; undefined: not here (yet) */
  line: TrackerLine | undefined;
  /** its page of lines is being asked / could not be read */
  lineState: 'loading' | 'ready' | 'failed';
  env: RowEnv;
  open: boolean;
  onToggle: (id: number) => void;
}

export function TrackerRow({ doc, line, lineState, env, open, onToggle }: TrackerRowProps) {
  const { ctx, narrow } = env;
  const blocker = blockerOf(doc, line, ctx);
  const age = ageOf(blocker, ctx.now);
  const you = youOf(doc, ctx);
  const waiting = lineState === 'loading' && !line && needsLine(doc, ctx);
  const active = env.activeId === doc.id;
  const panel = `tracker-detail-${doc.id}`;

  const title = <span dir="auto" title={doc.title} className={clsx('block min-w-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]', narrow ? 'line-clamp-2' : 'truncate')}>{doc.title}</span>;
  const blockerText = waiting
    ? <Skeleton className="h-[12px] w-[60%]" />
    : <span title={blocker.text} className={clsx('block min-w-0 text-ds-body [overflow-wrap:anywhere]', narrow ? '' : 'truncate', TEXT[blocker.tone] ?? 'text-ds-fg-body')}>{blocker.text}</span>;
  const pills = (
    <span className="flex shrink-0 items-center gap-[4px]">
      {you && <StatusPill size="sm" tone={you.word === 'Needs you' ? 'pending' : 'danger'} label={you.word} />}
      {age && <StatusPill size="sm" tone={age.tone} label={age.label} />}
      {age && <span className="sr-only">{age.title}</span>}
    </span>
  );

  return (
    <li data-record-row={doc.id} className={clsx('list-none border-b border-ds-border last:border-b-0', active && 'bg-ds-primary-soft')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panel : undefined}
        onClick={() => onToggle(doc.id)}
        className={clsx(
          'w-full min-w-0 text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]',
          narrow ? 'grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-[6px] gap-y-[2px] px-[8px] py-[8px]' : 'grid grid-cols-[20px_minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,2.6fr)_minmax(5rem,auto)] items-center gap-x-[12px] px-[8px] py-[6px]',
        )}
      >
        <ChevronRight aria-hidden className={clsx('mt-[2px] h-[14px] w-[14px] shrink-0 text-ds-fg-muted transition-transform', open && 'rotate-90', narrow && 'row-span-3')} strokeWidth={2} />
        {narrow ? (
          <>
            <span className="flex min-w-0 items-start justify-between gap-[8px]">{title}{pills}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] text-ds-label text-ds-fg-muted"><OwnerAvatar doc={doc} withName /><span>{stepWord(doc, line)}</span></span>
            {blockerText}
          </>
        ) : (
          <>
            {title}
            <span className="min-w-0"><OwnerAvatar doc={doc} withName /></span>
            <span className="min-w-0 truncate text-ds-body text-ds-fg-body" title={stepWord(doc, line)}>{stepWord(doc, line)}</span>
            {blockerText}
            <span className="flex justify-end">{pills}</span>
          </>
        )}
      </button>
      {open && (
        <div id={panel}>
          <TrackerDetail doc={doc} line={line} ctx={ctx} lookups={env.lookups} href={env.hrefOf(doc.id)} onOpen={env.onOpen} />
        </div>
      )}
    </li>
  );
}
