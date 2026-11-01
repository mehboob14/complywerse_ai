// What a source's query says, as the state buildInbox needs: loading, ready, stale (the last refresh failed, the answer before it is kept), unavailable (it never answered) or off. Pure, so
// `node --test src/lib/inbox/sourceState.test.ts` pins it; inboxApi.ts only feeds it the query's fields.
import { errorMessage, statusOf } from '../../components/ui/ds/reportOutcome.ts';
import type { SourceState } from './buildInbox.ts';

/** The fields of a TanStack Query result this reads. */
export interface QueryFacts {
  data: unknown;
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

export interface StateOptions {
  /** a 404 means this server has no such endpoint (an older server): the source is off, not failed */
  missingMeansOff?: boolean;
  /** the words of the failure before a retry began: while the retry runs the query has no error of its own (it is pending again), but the source is still the one that could not be loaded, so its
   *  notice stays, with a busy Retry, instead of flickering away */
  lastError?: string;
}

export function stateOf(q: QueryFacts, { missingMeansOff = false, lastError }: StateOptions = {}): SourceState {
  if (q.data === undefined) {
    if (q.isError) return missingMeansOff && statusOf(q.error) === 404 ? { state: 'off' } : { state: 'unavailable', error: errorMessage(q.error) };
    return q.errorUpdatedAt > 0 && q.fetchStatus === 'fetching' && lastError ? { state: 'unavailable', error: lastError } : { state: 'loading' };
  }
  return q.isError ? { state: 'stale', at: q.dataUpdatedAt, error: errorMessage(q.error) } : { state: 'ready', at: q.dataUpdatedAt };
}
