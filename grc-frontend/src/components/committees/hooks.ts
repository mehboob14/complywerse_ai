'use client';

// Three small hooks the Committees screens needed that the kit and the shell do not have yet (kit gaps: a debounced search field, a media query; the shell's `withFrom` is
// pure and wants the page's own address). Page-local on purpose.
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { cleanQuery } from '@/components/shell/currentPage';

/** The page these screens are drawn on, as the shell's `withFrom(href, here)` wants it ("/governance/committees?committee=3"): what the page shows, without the parameters
 * that only say how it was opened (a `from` of its own would nest). A link that opens a meeting carries it, and the meeting's trail and lit menu entry know where it came from. */
export function useHere(): string {
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  return `${pathname}${cleanQuery(search)}`;
}

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
