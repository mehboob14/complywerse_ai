'use client';

// One questionnaire sent for an engagement, as a card: which review cycle, how much is answered, where it stands, and the
// cycle's grade with how the residual moved against the cycle before (down is good). It opens the questionnaire.
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { GradePill, StatusPill } from '../_record/recordUi';
import { TONE } from '@/lib/status';
import { fmt } from '../../../_ui/fmt';
import type { AssessmentCard as Card } from '../../../_lib/assessmentsApi';
import { kindLabel, statusPill } from '../../../_lib/assessmentsLogic';

export default function AssessmentCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const pill = statusPill(card.status, card.expired);
  const change = card.scored && card.previous ? card.residual_change : null;
  const facts = [
    card.name,
    `${card.answered} of ${card.questions} answered`,
    card.due_date ? `due ${fmt.date(card.due_date)}` : '',
    card.submitted_at ? `submitted ${fmt.date(card.submitted_at)}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-ds-card border border-ds-border bg-ds-surface p-3.5 text-left transition-colors hover:bg-ds-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary"
    >
      <span className="min-w-0 flex-1 basis-56">
        <span className="block text-[14px] font-[600] leading-5 text-ds-fg">{kindLabel(card.kind, card.cycle)}</span>
        <span className="mt-0.5 block text-[12px] leading-4 text-ds-fg-muted">{facts}</span>
      </span>
      {change ? (
        <span className="inline-flex items-center gap-1 text-[13px] font-medium tabular-nums" style={{ color: change < 0 ? TONE.success.text : TONE.danger.text }}>
          {change < 0 ? <ArrowDown aria-hidden className="h-3.5 w-3.5" /> : <ArrowUp aria-hidden className="h-3.5 w-3.5" />}
          {Math.abs(change)} vs cycle {card.previous?.cycle}
        </span>
      ) : null}
      <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      {card.grade ? <GradePill grade={card.grade} score={card.residual_score} prefix="Grade" /> : null}
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ds-fg-muted" />
    </button>
  );
}
