'use client';

// What the Overview's cards share: the feed of one request (its state, its answer, how to ask again), the error row a card shows, and the line a card
// shows when the server refused the request. Every card loads, fails and has nothing on its own: a failed request is said where its numbers would be and
// never reads as 0, and a refusal (403) is "No access", not "Couldn't load".
// Only the --ds tokens and arbitrary values are used (the platform CSS repaints the named utilities inside the shell; see ds/kitRules.ts).
import type { UseQueryResult } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { ErrorState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { NO_ACCESS } from '@/components/ui/ds/statModel';
import { withFrom } from '@/components/shell/withFrom';
import { isRefused, loadOf, type Source } from './overviewModel';

/** The page the Overview's cards are on. Every link out of them remembers it (`?from=`), so the shell keeps the Overview lit in the rail and in the trail when
 *  the person arrives on a document or a list; a link to a view or a place of this page itself needs no memory of it. */
export const HERE = '/governance';
const ownPage = (href: string): boolean => href.startsWith('#') || href === HERE || href.startsWith(`${HERE}?`) || href.startsWith(`${HERE}#`);
export const link = (href: string): string => (ownPage(href) ? href : withFrom(href, HERE));

export interface Feed<T> extends Source<T> {
  error: unknown;
  retry: () => void;
}

export function toFeed<T>(query: UseQueryResult<T, unknown>): Feed<T> {
  return { load: loadOf(query), data: query.data ?? undefined, error: query.error, retry: () => { void query.refetch(); } };
}

/** A card's request failed: what failed, the server's own words (cleaned; `quiet` leaves them to a wider card), and Retry unless asking again cannot help
 *  (a refusal). The text keeps room of its own (`[&>div]:min-w-[10rem]`), so in a narrow card Retry drops under it instead of squeezing it a word to a line. */
export function FeedError({ title, feed, className, quiet = false }: { title: string; feed: Feed<unknown>; className?: string; quiet?: boolean }) {
  return (
    <ErrorState compact title={title} message={quiet ? undefined : errorMessage(feed.error)} onRetry={canRetry(feed.error) ? feed.retry : undefined} className={`[&>div]:min-w-[10rem] ${className ?? ''}`} />
  );
}

/** The server refused this request: the person may not read it. A line, not an alert: nothing went wrong. */
export function Denied({ what, className }: { what: string; className?: string }) {
  return (
    <p className={`flex items-center gap-[6px] text-ds-body text-ds-fg-muted ${className ?? ''}`}>
      <Lock aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />
      {`${NO_ACCESS} to ${what}`}
    </p>
  );
}

/** Whether a feed failed because the server refused it. */
export const refused = (feed: Pick<Feed<unknown>, 'load' | 'error'>): boolean => feed.load === 'error' && isRefused(feed.error);

export const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
