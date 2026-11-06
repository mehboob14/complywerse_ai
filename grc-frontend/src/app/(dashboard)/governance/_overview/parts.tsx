'use client';

// What the Overview's sections share: the feed of one request (its state, its answer, how to ask again), a tile with its three states, and the
// error row a card shows. Every section loads and fails on its own: a failed request is said where its numbers would be and never reads as 0.
// Only the --ds tokens and arbitrary values are used (the platform CSS repaints the named utilities inside the shell; see ds/kitRules.ts).
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { loadOf, type Source } from './overviewModel';

export interface Feed<T> extends Source<T> {
  error: unknown;
  retry: () => void;
}

export function toFeed<T>(query: UseQueryResult<T, unknown>): Feed<T> {
  return { load: loadOf(query), data: query.data ?? undefined, error: query.error, retry: () => { void query.refetch(); } };
}

/** A section's request failed: what failed, the server's own words (cleaned; `quiet` leaves them to a wider card), and Retry unless asking again cannot help
 *  (a refusal). The text keeps room of its own (`[&>div]:min-w-[10rem]`), so in a narrow tile Retry drops under it instead of squeezing it a word to a line. */
export function FeedError({ title, feed, className, quiet = false }: { title: string; feed: Feed<unknown>; className?: string; quiet?: boolean }) {
  return (
    <ErrorState compact title={title} message={quiet ? undefined : errorMessage(feed.error)} onRetry={canRetry(feed.error) ? feed.retry : undefined} className={`[&>div]:min-w-[10rem] ${className ?? ''}`} />
  );
}

export const TILE = 'flex min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
export const TILE_LABEL = 'text-ds-label text-ds-fg-muted';
/** the number of a tile: the kit has no size between its 20px title and the page, and a figure wants to be read first */
export const TILE_NUMBER = 'text-[24px] leading-[32px] font-[600] tabular-nums text-ds-fg';
export const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

export function TileSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="mt-[8px] space-y-[8px]">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-[28px] w-[96px]" />
      <Skeleton className="h-[12px] w-[70%]" />
    </div>
  );
}

/** A tile: its label, then its figures once the request answered; a skeleton while it loads, an error row when it failed. */
export function Tile({ label, feed, failTitle, children }: { label: string; feed: Feed<unknown>; failTitle: string; children: ReactNode }) {
  return (
    <div className={TILE}>
      <p className={TILE_LABEL}>{label}</p>
      {feed.load === 'loading' ? <TileSkeleton label={`Loading ${label.toLowerCase()}`} /> : feed.load === 'error' ? <FeedError title={failTitle} feed={feed} quiet className="mt-[4px]" /> : children}
    </div>
  );
}
