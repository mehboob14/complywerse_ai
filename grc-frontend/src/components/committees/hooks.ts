'use client';

// Two small hooks the Committees screens needed that the kit does not have yet (kit gaps: a debounced search field, a media query). Page-local on purpose.
import { useEffect, useState } from 'react';

/** `value` as it was `ms` milliseconds ago: a search box types at once, the address and the requests follow when the typing pauses. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setHeld(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return held;
}

/** Whether a media query matches now and as the window changes (false until the browser has said: the server renders the wide layout). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
