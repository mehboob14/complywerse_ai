'use client';

// The Overview's one new request: GET /governance/dashboard/posture, per framework or per department (backend modules/governance/posture.py: true totals over
// every document the person may read, weakest group first). Ten groups to begin with; "Show all" asks for the next pages of the most the server gives. The
// other grouping is asked only when the person turns to it. A refusal (403) is final and said at once, anything else is tried once more (retryOverview).
import { useInfiniteQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { retryOverview } from './overviewModel';
import { FIRST_PAGE, NEXT_PAGE, nextOffset, type GroupBy, type PostureResponse } from './postureModel';

interface Page { by: GroupBy; limit: number; offset: number }

export function usePosture(by: GroupBy) {
  return useInfiniteQuery({
    queryKey: ['governance-posture', by],
    queryFn: async ({ pageParam }) => (await apiClient.get('/governance/dashboard/posture', { params: pageParam })).data as PostureResponse,
    initialPageParam: { by, limit: FIRST_PAGE, offset: 0 } as Page,
    getNextPageParam: (last, pages): Page | undefined => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      const offset = nextOffset(loaded, last.total);
      return offset === null ? undefined : { by, limit: NEXT_PAGE, offset };
    },
    retry: retryOverview,
  });
}

export type PostureQuery = ReturnType<typeof usePosture>;
