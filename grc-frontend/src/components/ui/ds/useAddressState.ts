'use client';

// A page's state kept in its address: several params at once (?q=policy&status=draft,approved&sort=title:asc), so a link, a reload and the Back button
// land where the person was. You give it a schema (a name, what its values mean and its default: lib/addressState.ts has the kinds), and it gives you
// the state and a setter:
//
//   const SCHEMA = { q: text(), status: listOf(STATUSES), sort: sortOf(SORT_KEYS, { key: 'updated', dir: 'desc' }) };   // outside the component
//   const [state, set] = useAddressState(SCHEMA);
//   set({ q: 'policy', status: ['draft'] });                  // what the person picked shows at once, and the address follows
//   set({ status: [] }, { push: true });                      // a step Back should undo gets its own history entry
//
// What the person picks is shown at once; the address follows with history.replaceState (no navigation, no history entry, no scroll; with `null` as
// its state Next folds the new address into useSearchParams): picking a filter does not fill Back with every key stroke. `{ push: true }` asks for
// pushState instead. A name the schema does not list is left alone, and so is the hash; a value in the address that is not usable for its name is the
// default, so a link can never put the page in a state it cannot be in. Two changes in one event compose (the second starts from the first).
// When the address changes (a link, Back) it is the truth again, unless it already says what the page holds: "policy " in a search box and the
// trimmed "policy" the address keeps are one state, and typing a space must not be undone by the address catching up.
// Define the schema outside the component (a new one on every render would read the address again every time). The rules are lib/addressState.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { readAddress, sameAddressState, writeAddress, type AddressState, type Schema } from '@/lib/addressState';

export interface AddressStateOptions {
  /** add a history entry instead of replacing the current one, for a change that Back should undo */
  push?: boolean;
}

export function useAddressState<S extends Schema>(schema: S): [AddressState<S>, (patch: Partial<AddressState<S>>, options?: AddressStateOptions) => void] {
  const search = useSearchParams()?.toString() ?? '';
  const fromAddress = useMemo(() => readAddress(schema, search), [schema, search]);
  const [state, setState] = useState<AddressState<S>>(fromAddress);
  const latest = useRef(fromAddress);                              // two changes in one event compose, whatever React has rendered so far

  useEffect(() => {
    if (sameAddressState(schema, fromAddress, latest.current)) return;       // the address already says what the page holds: nothing to take
    latest.current = fromAddress;
    setState(fromAddress);
  }, [schema, fromAddress]);

  const set = useCallback((patch: Partial<AddressState<S>>, options?: AddressStateOptions) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setState(next);
    const query = writeAddress(schema, window.location.search, next);
    const url = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    if (url === window.location.pathname + window.location.search + window.location.hash) return;
    if (options?.push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, [schema]);

  return [state, set];
}
