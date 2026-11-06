'use client';

// Whether the window is at least `px` wide, kept up to date as it is resized (a media query, read through useSyncExternalStore). The server and the first client render
// say `server` (the wide layout, which is what the page was written for), then the real answer replaces it before anything is painted.
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

function subscribeToResize(notify: () => void): () => void {
  window.addEventListener('resize', notify);
  return () => window.removeEventListener('resize', notify);
}

/** Something worked out from the window's width (`select`), kept up to date as it is resized. The component re-renders only when the answer changes (a number or a
 *  string compares by value), not at every pixel of the resize. `server` is the answer for the first render, before the real width is known. */
export function useViewport<T extends string | number | boolean>(select: (width: number) => T, server: T): T {
  return useSyncExternalStore(subscribeToResize, () => select(window.innerWidth), () => server);
}
