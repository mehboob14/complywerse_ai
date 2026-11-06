'use client';

// Whether the window is phone-sized (under the kit's 640px "sm" step, where a WorkRow stacks): the cockpit folds its band and its lower cards on a phone.
// Drawn wide on the server and corrected on the client, so the first paint of a desktop is never a phone.
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 639.98px)';

const subscribe = (onChange: () => void) => {
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
};

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
