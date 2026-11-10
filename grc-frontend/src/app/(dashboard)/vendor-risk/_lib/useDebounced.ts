'use client';

import { useEffect, useState } from 'react';

/** `value`, but only once it has stopped changing for `ms`: the Emails preview asks the server once after typing, not for every letter. */
export function useDebounced<T>(value: T, ms = 400): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setHeld(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return held;
}
