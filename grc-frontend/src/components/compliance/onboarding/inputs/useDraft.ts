'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * What a person is typing, held here, apart from the value the page keeps. An entry that is not yet a value the server would take (a number half typed, a
 * person with an email and no name, a row nobody has filled) stays on the screen instead of being sent or thrown away. When the page's value changes to
 * something the draft does not already say (a read from the server), the draft follows it. `says(draft, value)` is "this draft is that value".
 */
export function useDraft<D, V>(value: V, fromValue: (v: V) => D, says: (draft: D, value: V) => boolean): [D, (next: D) => void] {
  const [draft, setDraft] = useState<D>(() => fromValue(value));
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (!says(latest.current, value)) setDraft(fromValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the page's value moves the draft
  }, [value]);
  return [draft, (next) => { latest.current = next; setDraft(next); }];
}
