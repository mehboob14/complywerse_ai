'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Tab state that survives navigation.
 *
 * Plain `useState` loses the active tab whenever the user leaves the page and
 * comes back — browser Back, or returning from a detail/wizard route — so they
 * land on the default tab instead of where they were. That is the root cause of
 * "I opened an asset's vulnerability, pressed Back, and it dumped me on Overview
 * instead of the Vulnerabilities tab."
 *
 * This hook keeps the active tab in the URL query (`?tab=`):
 *   • on mount it reads `?tab=` and restores it (covers Back, refresh and shared
 *     deep-links) — Next 14's history integration means the replaced URL is what
 *     a Back navigation returns to;
 *   • changing tab rewrites the query shallowly via `history.replaceState`, so
 *     there is no reload, no scroll jump and no extra history entry.
 *
 * Drop-in replacement for `const [tab, setTab] = useState<T>(def)` — pass the
 * list of valid tab ids so a stale or hand-edited `?tab=` can never select a
 * tab that doesn't exist (which would render a blank panel).
 */
export function useTabParam<T extends string>(
  defaultTab: T,
  valid: readonly T[],
  key: string = 'tab',
): [T, (t: T) => void] {
  const [tab, setTab] = useState<T>(defaultTab);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get(key);
    if (t && (valid as readonly string[]).includes(t)) setTab(t as T);
    // Read once on mount; this also covers the remount after a Back navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = useCallback(
    (t: T) => {
      setTab(t);
      const params = new URLSearchParams(window.location.search);
      params.set(key, t);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    },
    [key],
  );

  return [tab, select];
}
