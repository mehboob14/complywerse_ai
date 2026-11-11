// The state of one chart card of the front door, from the request that feeds it: loading while it runs, "No access" when the server refused it (403), a failure said with
// Retry (never an empty chart, never a chart of zeros), "nothing to show" when the answer is there and holds nothing, else the chart. Each card has its own request, so one
// failing says so on its own card and the rest stay.
import type { UseQueryResult } from '@tanstack/react-query';
import type { ChartCardProps } from '@/components/overview/charts';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';

type Feed = Pick<UseQueryResult<unknown, Error>, 'isPending' | 'isError' | 'data' | 'error' | 'refetch'>;

export function cardState(feed: Feed, empty: boolean, denied = 'Your role cannot see this.'): Pick<ChartCardProps, 'state' | 'error' | 'deniedText'> {
  if (feed.isPending) return { state: 'loading' };
  if (feed.isError && !feed.data) {
    if (statusOf(feed.error) === 403) return { state: 'denied', deniedText: denied };
    return { state: 'error', error: { message: errorMessage(feed.error), onRetry: canRetry(feed.error) ? () => { void feed.refetch(); } : undefined } };
  }
  return { state: empty ? 'empty' : 'ready' };
}

/** The same for a tile: a failed request is said on it with Retry, a refusal is "No access". */
export function tileFeed(feed: Feed, title: string): { loading: boolean; denied: boolean; error: { title: string; message: string; onRetry?: () => void } | null } {
  const failed = feed.isError && !feed.data;
  const denied = failed && statusOf(feed.error) === 403;
  return {
    loading: feed.isPending,
    denied,
    error: failed && !denied ? { title, message: errorMessage(feed.error), onRetry: canRetry(feed.error) ? () => { void feed.refetch(); } : undefined } : null,
  };
}
