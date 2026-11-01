'use client';

/**
 * PipelineView: the "Status Pipeline". Five columns follow the evidence approval lifecycle (draft, pending review, approved, expired, rejected); each holds the
 * files in that status. There is no drag and drop: the step a card can take is a button on the card (Submit for review on a draft, Approve on a pending file for
 * a person who may review), which IS the keyboard way to move a file. It used to be labelled "Review" while it approved.
 *
 * A column counts every file in its status but draws its first cards only (a board of a thousand cards is not a board; "Show all cards" draws the rest). Below
 * 768px the columns are stacked, one under the other, so nothing scrolls sideways; from 768px they are a board in a scroll region that a keyboard can scroll.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Button, Notice, PersonChip, StatusPill } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { statusPill, TONE } from '@/lib/status';
import { evidenceStatus } from '@/lib/statuses/evidence';
import { advanceStep, boardColumns, offBoard, ownerOf, typeLabel, type EvidenceItem } from './evidenceModel';
import { ExpiryText, LetterTile } from './lib';
import { useMinWidth } from './useMinWidth';

const CARDS_SHOWN = 12;

function Card({ item, canReview, pending, onAdvance }: {
  item: EvidenceItem;
  canReview: boolean;
  /** this card's request is running */
  pending: boolean;
  onAdvance: (id: number, action: 'submit' | 'approve') => void;
}) {
  const step = advanceStep(item.status, canReview);
  return (
    <li className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <div className="flex items-start gap-[8px]">
        <LetterTile name={item.name} size={24} />
        <span className="min-w-0 flex-1 text-ds-label text-ds-fg-muted">{typeLabel(item.evidence_type)}</span>
        {item.is_stale && <StatusPill size="sm" {...statusPill(evidenceStatus, 'stale')} />}
      </div>
      <Link
        href={`/evidence/${item.id}`}
        title={item.name}
        dir="auto"
        className="line-clamp-3 break-words rounded-ds-control text-ds-body font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring"
      >
        {item.name}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[4px]">
        <PersonChip name={ownerOf(item)} size={20} className="max-w-[60%]" />
        <ExpiryText expiry={item.expiry_date} />
      </div>
      {step && (
        <Button size="sm" aria-label={`${step.label}: ${item.name.length > 70 ? `${item.name.slice(0, 70)}…` : item.name}`} loading={pending} onClick={() => onAdvance(item.id, step.action)}>
          {step.label}
        </Button>
      )}
    </li>
  );
}

export function PipelineView({ items, canReview, pendingId, onAdvance }: {
  items: EvidenceItem[];
  canReview: boolean;
  pendingId: number | null;
  onAdvance: (id: number, action: 'submit' | 'approve') => void;
}) {
  const [all, setAll] = useState(false);
  const board = useMinWidth(768, false);
  const columns = boardColumns(items, all ? Number.MAX_SAFE_INTEGER : CARDS_SHOWN);
  const hidden = columns.reduce((n, c) => n + c.hidden, 0);
  const off = offBoard(items);

  return (
    <div className="flex flex-col gap-[12px]">
      {(hidden > 0 || all) && (
        <Notice
          tone="info"
          title={all ? 'Showing every card' : `Showing the first ${CARDS_SHOWN} cards of each column`}
          action={<Button size="sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${formatCount(hidden)} more`}</Button>}
        >
          Each column counts every file in its status.
        </Notice>
      )}
      <div
        role={board ? 'region' : undefined}
        aria-label={board ? 'Evidence pipeline' : undefined}
        tabIndex={board ? 0 : undefined}
        className="flex flex-col gap-[16px] focus-visible:outline-none focus-visible:shadow-ds-ring md:flex-row md:gap-[12px] md:overflow-x-auto md:pb-[8px]"
      >
        {columns.map((col) => (
          <section key={col.status} aria-labelledby={`pipeline-${col.status}`} className="min-w-0 md:w-[232px] md:shrink-0">
            <div className="mb-[8px] flex items-center gap-[8px]">
              <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: TONE[evidenceStatus.tone(col.status)].dot }} />
              <h3 id={`pipeline-${col.status}`} className="!text-ds-body !font-[600] !text-ds-fg">{evidenceStatus.label(col.status)}</h3>
              <span className="ml-auto rounded-full bg-ds-border px-[8px] text-ds-label tabular-nums text-ds-fg-body">{formatCount(col.count)}</span>
            </div>
            {col.count === 0 ? (
              <p className="rounded-ds-card border border-dashed border-ds-border-strong px-[12px] py-[16px] text-center text-ds-label text-ds-fg-muted">None</p>
            ) : (
              <ul className="flex flex-col gap-[8px]">
                {col.shown.map((item) => <Card key={item.id} item={item} canReview={canReview} pending={pendingId === item.id} onAdvance={onAdvance} />)}
              </ul>
            )}
          </section>
        ))}
      </div>
      {off > 0 && <p className="text-ds-label text-ds-fg-muted">{formatCount(off)} archived {off === 1 ? 'item is' : 'items are'} not on the board.</p>}
    </div>
  );
}
