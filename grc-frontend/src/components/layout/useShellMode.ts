'use client';

// The shell's mode for the window as it is now (see shellMode.ts), kept current while the window is resized.
// useSyncExternalStore: the server (and a hydration pass) answers 'full', the browser answers from matchMedia before it paints, and a resize
// re-renders with the new answer. Without matchMedia (an old browser) the shell stays 'full'.
import { useSyncExternalStore } from 'react';
import { FULL_QUERY, RAIL_QUERY, shellModeFromMatches, type ShellMode } from './shellMode';

const queries = () => [window.matchMedia(FULL_QUERY), window.matchMedia(RAIL_QUERY)];
const canMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function subscribe(onChange: () => void): () => void {
  if (!canMatch()) return () => {};
  const list = queries();
  list.forEach((q) => q.addEventListener('change', onChange));
  return () => list.forEach((q) => q.removeEventListener('change', onChange));
}

function snapshot(): ShellMode {
  if (!canMatch()) return 'full';
  const [full, rail] = queries();
  return shellModeFromMatches(full.matches, rail.matches);
}

export function useShellMode(): ShellMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'full');
}
