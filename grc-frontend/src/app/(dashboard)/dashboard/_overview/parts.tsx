'use client';

// What the Performance Overview's sections share: the loading box (which says so when a request is slow). Only the --ds tokens and arbitrary values are used (the platform CSS
// repaints the named utilities inside the shell; see ds/kitRules.ts).
import { useEffect, useState, type ReactNode } from 'react';
import { SLOW_MS } from './overviewModel';

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
