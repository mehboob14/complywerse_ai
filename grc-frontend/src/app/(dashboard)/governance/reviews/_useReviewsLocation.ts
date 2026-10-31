'use client';

// The state of the Reviews page that belongs in its address (section, view, list tab, calendar month and day), read from the URL and written back to it.
// What the person picks is shown at once and the address follows: a change inside the page rewrites the address with history.replaceState (no navigation,
// no history entry, no scroll; Next folds the new address into useSearchParams), the way the library keeps its filters. The one change that is a
// navigation is leaving the calendar's door path (/governance/reviews/calendar) for the list: that is router.replace to /governance/reviews.
// The address, when it changes (a link, Back), is the truth again. The rules are reviewsModel.ts (tested).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseLocation, reviewsHref, type ReviewsLocation } from './reviewsModel';

export function useReviewsLocation(): { loc: ReviewsLocation; go: (patch: Partial<ReviewsLocation>) => void } {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const fromAddress = useMemo(() => parseLocation(pathname, search), [pathname, search]);
  const [loc, setLoc] = useState<ReviewsLocation>(fromAddress);
  const latest = useRef(fromAddress);                            // two changes in one event compose, whatever React has rendered so far

  useEffect(() => {
    latest.current = fromAddress;
    setLoc(fromAddress);
  }, [fromAddress]);

  const go = useCallback((patch: Partial<ReviewsLocation>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setLoc(next);
    const url = reviewsHref(next, window.location.pathname);
    if (url === window.location.pathname + window.location.search) return;
    if (url.split('?')[0] === window.location.pathname) window.history.replaceState(null, '', url);
    else router.replace(url, { scroll: false });
  }, [router]);

  return { loc, go };
}
