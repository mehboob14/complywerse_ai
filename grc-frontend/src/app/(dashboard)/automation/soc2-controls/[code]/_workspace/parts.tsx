'use client';

// The small pieces every part of the control workspace shares: the code chip, one request's three states, and a label over a value.
import type { ReactNode } from 'react';
import { ErrorState, SkeletonRows } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';

export function CodeChip({ code }: { code: string }) {
  return <span className="inline-flex shrink-0 rounded-ds-control bg-ds-primary-soft px-[6px] py-[1px] font-mono text-ds-label font-[600] text-ds-primary-text">{code}</span>;
}

interface QueryLike<T> { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }

/** One request, three states: a skeleton while it loads, an error with Retry when it fails (never an empty list), the content when it has an answer. `what` is "the test plan". */
export function Loaded<T>({ q, what, rows = 3, children }: { q: QueryLike<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  if (q.data === undefined) {
    if (q.isError) return <ErrorState compact title={`Couldn’t load ${what}`} message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />;
    return <div aria-busy="true"><SkeletonRows rows={rows} columns={3} label={`Loading ${what}`} /></div>;
  }
  return <>{children(q.data)}</>;
}

/** A line of small print under a heading: sized and coloured on purpose (a bare <p> gets the platform's 11.5px). */
export function Small({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-ds-label text-ds-fg-muted ${className}`}>{children}</p>;
}

/** Body text in a card. */
export function Body({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`whitespace-pre-line break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere] ${className}`}>{children}</p>;
}

/** A label over a value, for a tight pair inside a card. */
export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-ds-label text-ds-fg-muted">{label}</p>
      <div className="mt-[2px] min-w-0 break-words text-ds-body text-ds-fg">{children}</div>
    </div>
  );
}
