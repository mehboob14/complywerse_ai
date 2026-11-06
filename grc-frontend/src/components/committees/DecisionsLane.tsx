'use client';

// The Decisions lane of the Committees home: what the committees decided, newest meeting first, across committees (GET /committees/decisions, read-only). The count is
// the server's true total; "Show more" asks for a longer page; the search finds every word in the item or its decision text, ignoring case and accents, on the server. The
// lane of the active committees leaves out a deactivated one's decisions (they stay on the record: choose that committee, or show the inactive ones).
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { listOf } from '@/lib/committees';
import { DECISIONS_SHOWN, type DecisionRow } from '@/lib/committeeHome';
import { DecisionRowItem, Lane, MoreRow } from './LaneParts';

const STEP = 16;
const CAP = 200;

export function DecisionsLane({ committeeId, search, isActive, hiddenOnPhone }: {
  committeeId: number | null;
  search: string;
  isActive: 'true' | 'false' | 'all';
  hiddenOnPhone: boolean;
}) {
  const [limit, setLimit] = useState(DECISIONS_SHOWN);
  const q = search.trim();
  const query = useQuery({
    queryKey: ['committee-decisions', committeeId ?? 0, q, isActive, limit],
    queryFn: async () => listOf<DecisionRow>((await committeeApi.listDecisions({ limit, is_active: isActive, ...(q ? { q } : {}), ...(committeeId ? { committee_id: committeeId } : {}) })).data),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const more = data ? data.total - data.items.length : 0;

  return (
    <Lane id="lane-decisions" title="Decisions" count={data ? formatCount(data.total) : undefined} hiddenOnPhone={hiddenOnPhone} className="sm:col-span-2 xl:col-span-1">
      {query.isError && !data ? (
        <ErrorState compact title="Couldn't load the decisions" message={errorMessage(query.error)} onRetry={() => { void query.refetch(); }} />
      ) : !data ? (
        <div className="space-y-[10px] p-[12px]" aria-busy="true"><Skeleton className="h-[48px]" /><Skeleton className="h-[48px]" /><Skeleton className="h-[48px]" /></div>
      ) : data.items.length === 0 ? (
        <EmptyState
          kind={q ? 'noMatches' : 'firstUse'}
          bare
          icon={MessageSquareText}
          title={q ? 'No decision matches' : 'No decisions recorded yet'}
          description={q ? 'No decided item mentions it.' : 'Decisions appear here once an agenda item has an outcome.'}
        />
      ) : (
        <div>
          <ul>{data.items.map((d) => <DecisionRowItem key={d.id} d={d} showCommittee={!committeeId} />)}</ul>
          {more > 0 && (
            <MoreRow>
              {limit < CAP
                ? <Button variant="link" size="sm" onClick={() => setLimit((l) => Math.min(CAP, l + STEP))}>{`Show ${formatCount(Math.min(STEP, more))} more decisions`}</Button>
                : <span className="text-ds-label font-normal text-ds-fg-muted">{`Showing the first ${formatCount(CAP)} of ${formatCount(data.total)}. Narrow it with the search or a committee.`}</span>}
            </MoreRow>
          )}
          {limit > DECISIONS_SHOWN && more <= 0 && (
            <MoreRow><Button variant="link" size="sm" onClick={() => setLimit(DECISIONS_SHOWN)}>Show fewer</Button></MoreRow>
          )}
        </div>
      )}
    </Lane>
  );
}
