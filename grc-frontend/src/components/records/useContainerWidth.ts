'use client';

// The width of an element's own box, kept up to date as the room around it changes (a ResizeObserver; the window's width is not the room: the shell's rail and its docked panel
// take 408px of it, and a page cannot know that from a media query). `null` until it has been measured: the server and the first client render, so both draw the wide layout, and
// the real width replaces it before anything is painted (a layout effect, a plain effect on the server where layout effects only warn).
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useContainerWidth<E extends HTMLElement>(ref: RefObject<E>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useBeforePaint(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return width;
}
