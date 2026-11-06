'use client';

// The pieces every view of the Evidence workspace draws, on the design-system kit: the status pills (from the registries of lib/statuses/evidence.ts), the expiry
// reading (a dot AND words, never colour alone), the maturity meter and the AI-review chip, the file's letter tile. The rules they apply are evidenceModel.ts.
// `normPct` is exported from here as it always was: the item page's Audit readiness card imports it.
import { Loader2 } from 'lucide-react';
import { ProgressBar, StatusPill, type ProgressTone } from '@/components/ui/ds';
import { TONE, statusPill } from '@/lib/status';
import { safeDetail } from '@/lib/apiError';
import { evidenceStatus, expiryState, maturityLevel, reviewState } from '@/lib/statuses/evidence';
import { expiryReading, isActiveReview, maturityOf, normPct, reviewWord, type EvidenceItem, type MaturityWord } from './evidenceModel';
import type { ReviewBrief } from '../_review';

export { normPct } from './evidenceModel';
export type { EvidenceItem, EvidenceSummary } from './evidenceModel';

/** The first letter of the file's name in a teal square: a quiet marker that the row is a file (the name beside it is the text). */
export function LetterTile({ name, size = 32 }: { name: string; size?: 24 | 32 }) {
  const letter = (name?.trim()?.[0] || '?').toUpperCase();
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-ds-control bg-ds-primary-soft text-ds-body font-[600] text-ds-primary-text ${size === 24 ? 'h-[24px] w-[24px]' : 'h-[32px] w-[32px]'}`}>
      {letter}
    </span>
  );
}

/** The workflow status as a pill, and a second "Stale" pill when the file is past its validity (the flag is separate from the status). */
export function StatusBadges({ item }: { item: Pick<EvidenceItem, 'status' | 'is_stale'> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-[4px]">
      <StatusPill size="sm" {...statusPill(evidenceStatus, item.status)} />
      {item.is_stale && <StatusPill size="sm" {...statusPill(evidenceStatus, 'stale')} />}
    </span>
  );
}

/** "12 days left", "Expired 3 days ago", "No expiry": the words, led by a dot of the same tone. */
export function ExpiryText({ expiry, className = '' }: { expiry: string | null | undefined; className?: string }) {
  const r = expiryReading(expiry);
  const tone = expiryState.tone(r.word);
  return (
    <span className={`inline-flex items-center gap-[6px] whitespace-nowrap text-ds-label ${className}`} style={{ color: r.word === 'none' ? undefined : TONE[tone].text }}>
      <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: TONE[tone].dot }} />
      <span className={r.word === 'none' ? 'text-ds-fg-muted' : undefined}>{r.text}</span>
    </span>
  );
}

const BAR_TONE: Record<MaturityWord, ProgressTone> = { strong: 'success', fair: 'primary', weak: 'warning', poor: 'danger', unrated: 'primary' };

/** The AI review as one chip: a spinner while it runs, the plain failure when it did not, "Not rated yet" when it has not started. The server's own words
 *  (cleaned of any model name) are the tooltip of a failure. */
export function ReviewChip({ score, review, ocrStalled }: { score: number | null; review?: ReviewBrief | null; ocrStalled?: boolean }) {
  const word = reviewWord({ score, review, ocrStalled });
  const running = isActiveReview(review?.status) && word !== 'rated';
  const why = word === 'failed' || word === 'stopped' || word === 'unavailable' ? safeDetail(review?.error) : '';
  return (
    <span className="inline-flex items-center gap-[4px]" title={why || undefined}>
      {running && <Loader2 aria-hidden strokeWidth={1.75} className="h-[12px] w-[12px] shrink-0 animate-spin text-ds-primary-text motion-reduce:animate-none" />}
      <StatusPill size="sm" {...statusPill(reviewState, word)} />
    </span>
  );
}

/** How mature a file is as audit evidence: the score as a bar and number, with its band named for a screen reader; without a score, where the review stands. */
export function MaturityMeter({ score, review, ocrStalled, barWidth = 'w-[72px]' }: { score: number | null; review?: ReviewBrief | null; ocrStalled?: boolean; barWidth?: string }) {
  if (score == null) return <ReviewChip score={null} review={review} ocrStalled={ocrStalled} />;
  const level = maturityOf(score);
  return <ProgressBar value={score} label={`Maturity: ${maturityLevel.label(level)}`} tone={BAR_TONE[level]} className={barWidth} />;
}
