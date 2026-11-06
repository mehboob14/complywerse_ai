'use client';

// Is this element's text cut off by a line clamp (its content is taller than its box)? The twin of useClipped, which measures a `truncate` label's width:
// a two-line title or a ClampedText puts its whole text in a tooltip, or draws "Show more", only when it really is cut at this width. Measured after each
// render (a new text) and whenever the element changes size (a window resize, a panel docking), so a text that fits a wider box loses its toggle.
// `clamped` is false while the clamp is lifted (a ClampedText that is open): its content is not cut then, so the last measurement is KEPT instead of being
// read as "it fits" (which would unmount "Show less" for a render and drop the keyboard focus that is on it). The element must stay mounted while the
// component does (it is a ref taken once).
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { isCut } from './clampModel';

export function useLineClamped<T extends HTMLElement>(clamped: boolean = true): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const live = useRef(clamped);
  live.current = clamped;
  const [cut, setCut] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (el && live.current) setCut(isCut({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  }, []);
  useEffect(measure);                                                              // after every render: the text may have changed
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [measure]);
  return [ref, cut];
}
