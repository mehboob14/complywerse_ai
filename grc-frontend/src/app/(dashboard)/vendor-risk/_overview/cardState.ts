// The state of a chart card from the requests it rests on, apart from React so `node --test` pins it (cardState.test.ts): a failed or refused request is NEVER drawn as a chart of zeros.
//   a request still running, or showing the other scope's answer   loading
//   a request that failed                                          refused (403: "Your role cannot see ...") or failed, with Retry where asking again can help
//   nothing to draw                                                empty (the card says what fills it)
//   else                                                           ready
import { canRetry, errorMessage, statusOf } from '../../../../components/ui/ds/reportOutcome.ts';

/** What a card needs of a request: its state, and its answer to know it arrived. */
export interface CardFeed { isPending: boolean; isPlaceholderData?: boolean; isError: boolean; error: unknown; data: unknown; refetch: () => unknown }

export type CardState = 'loading' | 'error' | 'denied' | 'empty' | 'ready';
export interface CardOutcome { state: CardState; error?: { message: string; onRetry?: () => void }; deniedText?: string }

export function cardOutcome(feeds: readonly CardFeed[], empty: boolean, noun: string): CardOutcome {
  const failed = feeds.find((f) => f.isError);
  if (failed) {
    if (statusOf(failed.error) === 403) return { state: 'denied', deniedText: `Your role cannot see ${noun}.` };
    return { state: 'error', error: { message: errorMessage(failed.error), onRetry: canRetry(failed.error) ? () => { void failed.refetch(); } : undefined } };
  }
  if (feeds.some((f) => f.isPending || f.isPlaceholderData || f.data === undefined)) return { state: 'loading' };
  return { state: empty ? 'empty' : 'ready' };
}
