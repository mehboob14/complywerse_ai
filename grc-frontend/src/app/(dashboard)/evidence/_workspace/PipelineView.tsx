'use client';

/**
 * PipelineView — L4 "Status Pipeline" kanban for the Evidence workspace.
 * Five columns follow the evidence approval lifecycle; each holds the items currently
 * sitting in that status. Presentational only (no real drag-and-drop, no data fetching).
 * When `onTransition` is supplied, cards in advanceable statuses get a small "advance"
 * affordance mapping draft→submit and pending_review→review.
 *
 * Charter: single teal brand, category tints only as status markers, no gradients,
 * hairline borders, dense.
 */

import { ChevronRight } from 'lucide-react';
import {
  type EvidenceItem,
  statusLabel,
  statusTone,
  type StatusTone,
  EvidenceLetterTile,
  typeLabel,
  InitialsAvatar,
  ExpiryStatus,
  ownerOf,
} from './lib';

export interface PipelineViewProps {
  items: EvidenceItem[];
  onOpenFull: (id: number) => void;
  onTransition?: (id: number, action: 'submit' | 'review') => void;
  canReview?: boolean;
}

const PIPELINE_STATUSES = ['draft', 'pending_review', 'approved', 'expired', 'rejected'] as const;

const COLUMN_DOT: Record<StatusTone, string> = {
  draft: 'bg-slate-400',
  pending: 'bg-amber-500',
  approved: 'bg-emerald-500',
  rejected: 'bg-rose-500',
  expired: 'bg-orange-500',
  archived: 'bg-slate-400',
};

/** Which advance action (if any) applies to a card in a given status. */
function advanceAction(status: string): 'submit' | 'review' | null {
  if (status === 'draft') return 'submit';
  if (status === 'pending_review') return 'review';
  return null;
}
const ADVANCE_LABEL: Record<'submit' | 'review', string> = {
  submit: 'Submit',
  review: 'Review',
};

function PipelineCard({
  item,
  onOpenFull,
  onTransition,
  canReview,
}: {
  item: EvidenceItem;
  onOpenFull: (id: number) => void;
  onTransition?: (id: number, action: 'submit' | 'review') => void;
  canReview?: boolean;
}) {
  const owner = ownerOf(item);
  const meta = item.department || owner;
  const action = advanceAction(item.status);
  // Only surface the review affordance when the caller can review; submit is always allowed.
  const showAdvance = !!onTransition && !!action && (action === 'submit' || canReview);

  return (
    <div className="card p-3 hover:border-primary-300">
      <button type="button" onClick={() => onOpenFull(item.id)} className="w-full text-left">
        <div className="flex items-start justify-between gap-2">
          <EvidenceLetterTile name={item.name} evidenceType={item.evidence_type} size="sm" />
          <span className="truncate text-[11px] text-slate-400">{typeLabel(item.evidence_type)}</span>
        </div>

        <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-900">{item.name}</p>

        {meta && <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{meta}</p>}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <InitialsAvatar name={owner} size="sm" />
          <ExpiryStatus expiry={item.expiry_date} />
        </div>
      </button>

      {showAdvance && action && (
        <button
          type="button"
          onClick={() => onTransition?.(item.id, action)}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          {ADVANCE_LABEL[action]}
        </button>
      )}
    </div>
  );
}

export function PipelineView({ items, onOpenFull, onTransition, canReview }: PipelineViewProps) {
  const list = items ?? [];

  const byStatus = PIPELINE_STATUSES.map((status) => ({
    status,
    items: list.filter((it) => it.status === status),
  }));

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {byStatus.map(({ status, items: colItems }) => (
        <div key={status} className="w-72 shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_DOT[statusTone(status)]}`} />
            <span className="text-sm font-semibold text-slate-900">{statusLabel(status)}</span>
            <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
              {colItems.length}
            </span>
          </div>

          <div className="space-y-2">
            {colItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-300">
                None
              </div>
            ) : (
              colItems.map((item) => (
                <PipelineCard
                  key={item.id}
                  item={item}
                  onOpenFull={onOpenFull}
                  onTransition={onTransition}
                  canReview={canReview}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
