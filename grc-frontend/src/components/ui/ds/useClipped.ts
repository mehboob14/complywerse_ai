'use client';

// Is this element's text cut off by its width (a `truncate` label)? A pill or a name puts its full text in a `title` only when it is,
// so a short word never carries a tooltip that repeats it.
import { useEffect, useRef, useState, type RefObject } from 'react';

// ponytail: measured after each render, not on a window resize; a resize that re-renders nothing leaves `title` as it was.
export function useClipped<T extends HTMLElement>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    setClipped(Boolean(el) && el!.scrollWidth > el!.clientWidth);
  });
  return [ref, clipped];
}
