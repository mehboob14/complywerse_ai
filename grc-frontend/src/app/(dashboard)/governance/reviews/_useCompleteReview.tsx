'use client';

// Complete Review: ask first (the kit's confirm dialog, not window.confirm), then send it, and say what happened only after the server has answered: a
// confirmation with the next review date it set, or the server's own words with a Retry. The request, its (empty) payload and the refreshed queries are the
// ones the page always had; the calendar's month is refreshed too now that the calendar is a view of this page and a completed review moves to another day.
import { useCallback } from 'react';
import { governanceApi } from '@/lib/api';
import { formatDate, truncate } from '@/lib/format';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { dayOf } from './calendarModel';
import type { ReviewDoc } from './reviewsModel';

export function useCompleteReview() {
  const { confirm, confirmDialog } = useConfirm();
  const complete = useReportedMutation({
    mutationFn: (doc: Pick<ReviewDoc, 'id' | 'title'>) => governanceApi.completeReview(doc.id),
    success: (response, doc) => {
      const next = dayOf(response?.data?.next_review_date);
      return { title: 'Review completed', message: `“${truncate(doc.title, 80).text}”${next ? ` is next due ${formatDate(next)}.` : '.'}` };
    },
    failure: "Couldn't complete the review",
    invalidate: [['governance-review-statistics'], ['governance-reviews-overdue'], ['governance-reviews-upcoming'], ['governance-review-calendar']],
  });

  const request = useCallback(async (doc: Pick<ReviewDoc, 'id' | 'title'>) => {
    const yes = await confirm({
      title: 'Mark this review as complete?',
      message: `“${truncate(doc.title, 120).text}”: this resets its review cycle and its next review date.`,
      confirmLabel: 'Complete review',
    });
    if (yes) complete.mutate(doc);
  }, [confirm, complete]);

  return { request, pendingId: complete.isPending ? complete.variables?.id ?? null : null, confirmDialog };
}
