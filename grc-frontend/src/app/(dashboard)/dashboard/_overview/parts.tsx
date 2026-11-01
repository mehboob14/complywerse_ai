'use client';

// What the Performance Overview's sections share: the card frame, a request's error row, the loading box (which says so when a request is slow), and the
// small headings. Only the --ds tokens and arbitrary values are used (the platform CSS repaints the named utilities inside the shell; see ds/kitRules.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { ErrorState } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { SLOW_MS } from './overviewModel';

/** The frame of a tile or a card: a box with the kit's border and radius. */
export const BOX = 'min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
export const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';

/** True once `active` has been true for `ms` (a request that has not answered by then is slow: the page says so, it does not fail it). */
export function useSlow(active: boolean, ms: number = SLOW_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return undefined; }
    const timer = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return slow;
}

/** A section that is waiting for its request: announced once (`label`), marked busy, and after a while it says it is taking longer than usual. */
export function Loading({ label, slow = false, children }: { label: string; slow?: boolean; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
      {slow && <p className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">Still loading. This is taking longer than usual.</p>}
    </div>
  );
}

/** A request failed: what failed, the server's own words (cleaned), and Retry unless asking again cannot help (a refusal). */
export function FailedRow({ title, error, onRetry, className }: { title: string; error: unknown; onRetry?: () => void; className?: string }) {
  return <ErrorState compact title={title} message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} className={`[&>div]:min-w-[10rem] ${className ?? ''}`} />;
}

/** A section's heading: the platform CSS remaps a bare h2, so the kit's own `!` modifiers (PageHeading, SectionCard do the same). */
export function SectionHead({ id, title, meta, actions }: { id: string; title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-[12px] flex flex-wrap items-center gap-x-[8px] gap-y-[8px]">
      <h2 id={id} className="min-w-0 break-words !text-ds-section !text-ds-fg">{title}</h2>
      {meta && <span className="text-ds-body text-ds-fg-muted">{meta}</span>}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-[8px]">{actions}</div>}
    </div>
  );
}
