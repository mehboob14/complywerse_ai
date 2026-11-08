'use client';

// The small marks of an evidence file in the drawer: where its review stands, and how mature the library rates it (a file the evidence library holds is rated there; this chip shows
// the rating, or that the AI is still reading, and opens the file in Evidence Management where what is missing is spelled out). Kit pills with words, never a colour alone.
import Link from 'next/link';
import { StatusPill } from '@/components/ui/ds';
import { reviewActive, useEvidenceReview } from '@/app/(dashboard)/evidence/_review';
import { statusPill } from '@/lib/status';
import { fileRating, fileReview } from '@/lib/statuses/frameworkRequirements';

export function ReviewPill({ status }: { status?: string | null }) {
  return <StatusPill size="sm" {...statusPill(fileReview, status || 'pending')} />;
}

export function RatingPill({ status }: { status?: string | null }) {
  return <StatusPill size="sm" {...statusPill(fileRating, status || 'pending')} />;
}

/** Maturity of a file the evidence library holds: the rating once there is one (bands as the library draws them: 80 and 60), else where the AI is. */
export function MaturityPill({ evidenceId }: { evidenceId?: number | null }) {
  const { review } = useEvidenceReview(evidenceId, { also: ['certification-controls'] });
  if (!review) return null;
  const score = review.quality_score;
  if (typeof score === 'number') {
    const tone = score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger';
    return (
      <Link href={`/evidence/${evidenceId}`} title="How mature this file is as audit evidence. Open it to see what is missing and how to close it." className="rounded-ds-control focus-visible:outline-none focus-visible:shadow-ds-ring">
        <StatusPill size="sm" tone={tone} label={`Maturity ${Math.round(score)}%`} />
      </Link>
    );
  }
  if (reviewActive(review.status)) return <StatusPill size="sm" tone="progress" label="AI is rating it" />;
  if (review.status === 'failed' || review.status === 'unavailable') return <StatusPill size="sm" tone="warning" label="Not rated" />;
  return <StatusPill size="sm" tone="neutral" label="Not rated yet" />;
}
