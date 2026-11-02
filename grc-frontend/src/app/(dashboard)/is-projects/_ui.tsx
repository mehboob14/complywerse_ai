'use client';

// The small parts the Projects pages share: the wait before a typed search is asked for, the rule for trying a read again, the error row of a failed
// read, a progress bar that says its number, and the stat tile. Only the --ds tokens and arbitrary values (kit rules), so they look the same on a page
// and in a dialog. The kit has no stat tile yet (Phase 1 "kit gaps": the Governance Overview has its own too).
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorState, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatPercent } from '@/lib/format';
import { clampPercent } from './_model';

/** `value` once it has stopped changing for `ms` (a search asks the server after the typing pauses, not on every key). */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Tries a read again twice, but never a refusal (a 403 is said at once instead of after React Query's three tries with back-off, about 7 seconds). */
export const retryRead = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

/** A read failed: what, the server's own words (cleaned), and Retry unless asking again cannot help. For the inside of a card. */
export function QueryError({ title, error, onRetry, className }: { title: string; error: unknown; onRetry: () => void; className?: string }) {
  return <ErrorState compact title={title} message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} className={`[&>div]:min-w-[10rem] ${className ?? ''}`} />;
}

/** A bar and its number: a whole percent in words beside it, and the bar itself named for a screen reader. A stored value outside 0-100 fills the track, no more. */
export function ProgressBar({ value, label, width = 'w-[72px]' }: { value: number | null | undefined; label: string; width?: string }) {
  const v = clampPercent(value);
  return (
    <span className="inline-flex items-center gap-[8px]">
      <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} className={`block h-[6px] shrink-0 overflow-hidden rounded-full bg-ds-border ${width}`}>
        <span className="block h-full rounded-full bg-ds-primary" style={{ width: `${v}%` }} />
      </span>
      <span className="whitespace-nowrap tabular-nums text-ds-label text-ds-fg-body">{formatPercent(value ?? 0)}</span>
    </span>
  );
}

export const TILE = 'flex min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
export const TILE_LABEL = 'flex items-center gap-[6px] text-ds-label text-ds-fg-muted';
/** the figure of a tile: the kit has no size between its 20px title and the page, and a figure is read first */
export const TILE_NUMBER = 'text-[24px] leading-[32px] font-[600] tabular-nums text-ds-fg';

/** A tile: its label (with a dot of its tone), then its figure; a skeleton in the figure's place while the request loads (a failure is the section's, not the tile's). */
export function Stat({ label, dot, loading = false, children }: { label: string; dot?: string; loading?: boolean; children?: ReactNode }) {
  return (
    <div className={TILE}>
      <p className={TILE_LABEL}>
        {dot && <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: dot }} />}
        <span className="min-w-0 break-words">{label}</span>
      </p>
      {loading ? (
        <div role="status" aria-busy="true" className="mt-[8px]">
          <span className="sr-only">{`Loading ${label.toLowerCase()}`}</span>
          <Skeleton className="h-[28px] w-[72px]" />
        </div>
      ) : children}
    </div>
  );
}
