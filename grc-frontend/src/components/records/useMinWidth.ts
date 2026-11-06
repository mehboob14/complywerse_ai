'use client';

// Whether the window is at least `px` wide, kept up to date as it is resized (a media query, read through useSyncExternalStore). The server and the first client render say
// `server` (the wide layout), then the real answer replaces it before anything is painted. The list draws the table OR the cards for the width, not both: a library of thousands
// of rows is two lists of React work otherwise.
import { useSyncExternalStore } from 'react';

export function useMinWidth(px: number, server = true): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(`(min-width: ${px}px)`);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => server,
  );
}
