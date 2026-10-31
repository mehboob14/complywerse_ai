'use client';

// The requests of Governance > Reviews, each with the query key the page has always used (other keys are not invented: an invalidation by key still
// reaches them). The endpoints and the answers are the server's, unchanged; the lists ask for more rows than the server's default of 100 (REVIEW_FETCH_LIMIT).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { REVIEW_FETCH_LIMIT, type ReviewDoc } from './reviewsModel';

// The default of three tries, except for a request the server has refused (a person without the right, a bad request): trying again cannot change that, so the
// page says so at once instead of after seven seconds of skeleton.
const retry = (failures: number, error: unknown): boolean => failures < 3 && canRetry(error);

export interface ReviewList { items: ReviewDoc[]; total: number; skip: number; limit: number }

export interface ReviewStatistics {
  total_documents: number;
  total_with_review_date: number;
  overdue: number;
  due_this_week: number;
  due_this_month: number;
  due_next_30_days: number;
  by_doc_type: Record<string, { total: number; overdue: number; due_soon: number }>;
  by_status: { overdue: number; due_soon: number; on_track: number };
  never_reviewed: number;
}

/** GET /governance/reviews/statistics: the server's counts (the tiles, the by-type strip, the page's facts line). */
export function useReviewStatistics() {
  return useQuery({
    queryKey: ['governance-review-statistics'],
    queryFn: async () => (await governanceApi.getReviewStatistics()).data as ReviewStatistics,
    retry,
  });
}

/** GET /governance/reviews/overdue, for one document type or all (`type` ''). */
export function useOverdueReviews(type: string, enabled = true) {
  return useQuery({
    queryKey: ['governance-reviews-overdue', type],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: REVIEW_FETCH_LIMIT };
      if (type) params.doc_type = type;
      return (await governanceApi.getOverdueReviews(params)).data as ReviewList;
    },
    placeholderData: keepPreviousData,
    enabled,
    retry,
  });
}

/** GET /governance/reviews/upcoming for the next 90 days. */
export function useUpcomingReviews(type: string, enabled = true) {
  return useQuery({
    queryKey: ['governance-reviews-upcoming', type],
    queryFn: async () => {
      const params: Record<string, string | number> = { days: 90, limit: REVIEW_FETCH_LIMIT };
      if (type) params.doc_type = type;
      return (await governanceApi.getUpcomingReviews(params)).data as ReviewList;
    },
    placeholderData: keepPreviousData,
    enabled,
    retry,
  });
}

/** One month of the calendar: the reviews due in it, as GET /governance/reviews/calendar groups them. */
export interface CalendarDoc { id: number; title: string; doc_type: string; next_review_date: string; owner_name: string | null }
interface CalendarAnswer { calendar: Array<{ period: string; label: string; documents: CalendarDoc[]; count: number }> }

export function useReviewCalendar(year: number, month: number) {
  return useQuery({
    queryKey: ['governance-review-calendar', year, month],
    queryFn: async () => {
      const answer = (await governanceApi.getReviewCalendar({ year, month })).data as CalendarAnswer;
      return (answer.calendar ?? []).flatMap((period) => period.documents);
    },
    retry,
  });
}

// ── the governance actions log (the Actions section) ─────────────────────────
export interface GovernanceAction {
  id: number;
  action_type: string;
  action_description: string;
  entity_type: string;
  review_status: string;
  action_user_name: string | null;
  action_date: string;
}
export interface ActionList { items: GovernanceAction[]; total: number; skip: number; limit: number }

/** The log for one status filter. "All actions" and "Pending review" both ask for the person's own pending actions (my-pending-reviews), as the page always has;
 *  the others ask for the organisation's actions in that status. The server allows at most 500 rows a request. */
export function useGovernanceActions(filter: string, enabled = true) {
  return useQuery({
    queryKey: ['my-pending-reviews', filter],
    queryFn: async () => {
      if (filter === 'pending_review' || filter === 'all') return (await governanceApi.getMyPendingReviews({ limit: 500 })).data as ActionList;
      return (await governanceApi.getAllGovernanceActions({ status_filter: filter, limit: 500 })).data as ActionList;
    },
    placeholderData: keepPreviousData,
    enabled,
    retry,
  });
}
